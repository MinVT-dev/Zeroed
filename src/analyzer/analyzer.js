// Hidden window: captures the chosen screen or window at low resolution, estimates camera pan, feeds the detector.
// Frames are analysed in memory and discarded; nothing is stored or sent anywhere.
const W = 128, H = 72;
const video = document.getElementById('v');
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let debugOn = false, debugTick = 0, fps = 0, fpsCount = 0, fpsFrom = 0;
let prev = null, lastGray = null, prevGray = null, stream = null;
let gen = 0, reader = null, fallbackTimer = null;
// The frame currently being processed (a VideoFrame, or the <video> element in fallback mode).
let cur = null, curW = 0, curH = 0;

const toGray = (px, n) => {
  const g = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) g[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
  return g;
};

function grayFrame() {
  ctx.drawImage(cur, 0, 0, W, H);
  return toGray(ctx.getImageData(0, 0, W, H).data, W * H);
}

// A snap that ends with something moving at screen centre counts fully; one that ends on empty
// scenery counts half. Uses a sharp crop of the centre taken when the camera stops and again when
// the settle window ends, so it only costs anything around candidate snaps.
const CW = 192, CH = 144;
const crop = document.createElement('canvas'); crop.width = CW; crop.height = CH;
const cctx = crop.getContext('2d', { willReadFrequently: true });
let settleCrop = null, wasSettling = false;
function centreCrop() {
  cctx.drawImage(cur, curW * 0.35, curH * 0.25, curW * 0.3, curH * 0.4, 0, 0, CW, CH);
  return toGray(cctx.getImageData(0, 0, CW, CH).data, CW * CH);
}
function weighSnap() {
  if (!settleCrop) return 1;
  const f = Motion.changedFraction(settleCrop, centreCrop());
  settleCrop = null;
  if (f >= 0.004 && f <= 0.45) return 1;
  return { full: 1, ignore: 0 }[detector.cfg.centre] ?? 0.5; // nothing moving at centre
}

// Match statistics, reported to the main process every few seconds and when capture stops.
let stats = null;
const newStats = () => ({ run: gen, frames: 0, moving: 0, cuts: 0, strong: 0, firstT: 0, lastT: 0 });
function reportStats() {
  if (!stats || !stats.frames) return;
  window.zeroed.analyzerStats({ run: stats.run, frames: stats.frames, moving: stats.moving, cuts: stats.cuts, strong: stats.strong, seconds: Math.max(0, (stats.lastT - stats.firstT) / 1000) });
}
setInterval(reportStats, 5000);
const detector = new Detector.Detector({
  onAlert: (a) => window.zeroed.reportAlert(a),
  weigh: weighSnap,
  onSnap: (sn) => { if (stats && sn.score >= detector.cfg.minScore) stats.strong++; }
});

function processFrame(src, sw, sh, t) {
  cur = src; curW = sw; curH = sh;
  const gray = grayFrame();
  prevGray = lastGray; lastGray = gray;
  const profile = Motion.profiles(gray, W, H);
  if (prev) {
    const m = Motion.estimate(prev, profile, 40);
    const cut = detector.cfg.cuts && (m.dx || m.dy) && Motion.isCut(prevGray, gray, W, H, m.dx, m.dy);
    detector.push(cut ? { t, dx: 0, dy: 0, cut: true } : { t, dx: m.dx / W, dy: m.dy / W });
    if (stats) {
      if (!stats.frames) stats.firstT = t;
      stats.frames++; stats.lastT = t;
      if (cut) stats.cuts++; else if (m.dx || m.dy) stats.moving++;
    }
    const settling = detector.isSettling();
    if (settling && !wasSettling) settleCrop = centreCrop(); // camera just stopped after a snap
    if (!settling) settleCrop = null; // used by weighSnap during push(), or the snap was aborted
    wasSettling = settling;
    fpsCount++;
    if (t - fpsFrom >= 1000) { fps = fpsCount * 1000 / (t - fpsFrom); fpsCount = 0; fpsFrom = t; }
    if (debugOn && (debugTick++ & 1) === 0) { // dev overlay only: ~15 updates/s
      window.zeroed.debugFrame({ boxes: Motion.movingBlobs(prevGray, lastGray, W, H, m.dx, m.dy), dx: m.dx / W, dy: m.dy / W, fps, info: detector.debugInfo() });
    }
  }
  prev = profile;
  cur = null;
}

// Pull frames straight from the capture track. Unlike requestVideoFrameCallback or timers, this does not
// depend on the hidden window being rendered, which Chromium nearly stops when no Zeroed window is visible.
async function pump(track, myGen) {
  reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  while (myGen === gen) {
    let r;
    try { r = await reader.read(); } catch { break; }
    if (r.done || !r.value) break;
    const frame = r.value;
    try { if (myGen === gen) processFrame(frame, frame.displayWidth, frame.displayHeight, frame.timestamp / 1000); }
    finally { frame.close(); }
  }
}

let sourceId = null, fpsCap = 30;
async function start(id) {
  sourceId = id;
  stop();
  if (!sourceId) return window.zeroed.analyzerStatus({ running: false });
  const myGen = gen;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: 640, maxHeight: 360, maxFrameRate: fpsCap } }
    });
    if (myGen !== gen) { stream.getTracks().forEach(t => t.stop()); return; } // superseded while waiting
    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', () => { if (myGen !== gen) return; stop(); window.zeroed.analyzerStatus({ running: false, error: 'Capture ended (window closed or minimized?)' }); });
    if (typeof MediaStreamTrackProcessor === 'function') {
      pump(track, myGen);
    } else {
      video.srcObject = stream;
      await video.play();
      fallbackTimer = setInterval(() => { if (video.readyState >= 2) processFrame(video, video.videoWidth, video.videoHeight, performance.now()); }, 33);
    }
    stats = newStats();
    window.zeroed.analyzerStatus({ running: true });
  } catch (e) {
    if (myGen === gen) window.zeroed.analyzerStatus({ running: false, error: String(e && e.message || e) });
  }
}

function stop() {
  reportStats(); stats = null;
  gen++;
  if (reader) { reader.cancel().catch(() => {}); reader = null; }
  clearInterval(fallbackTimer); fallbackTimer = null;
  prev = null; lastGray = prevGray = null; settleCrop = null; wasSettling = false; fpsCount = 0; fpsFrom = 0;
  detector.reset();
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null; video.srcObject = null;
}

const applyDetectorState = (s) => {
  detector.setTuning(s.detector.tuning || null);
  const cap = detector.cfg.maxFps;
  if (cap !== fpsCap) { fpsCap = cap; if (sourceId) start(sourceId); } // frame-rate cap needs a new capture
  detector.setSensitivity(s.detector.sensitivity);
  detector.setOverride(s.detector.override || null);
  debugOn = !!s.detector.debug;
};
window.zeroed.onState(applyDetectorState);
window.zeroed.getState().then(applyDetectorState);
window.zeroed.onCaptureSource(start);
window.zeroed.analyzerReady();
