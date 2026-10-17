// Dev overlay: draws what the cheat-hint analyzer sees. Coordinates arrive in 0..1 of the captured
// area and are mapped onto this display (exact for whole-screen capture; for a window it assumes the
// window fills the display, e.g. fullscreen/borderless).
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let frame = null, lastAt = 0;

function resize() { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; }
addEventListener('resize', resize); resize();

function rect(x, y, w, h, color, dash) {
  ctx.setLineDash(dash || []); ctx.strokeStyle = color; ctx.lineWidth = 2 * devicePixelRatio;
  ctx.strokeRect(x * canvas.width, y * canvas.height, w * canvas.width, h * canvas.height);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const stale = Date.now() - lastAt > 1000;
  // Fixed regions used by the analyzer (see motion.js).
  rect(0.2, 0.15, 0.6, 0.55, 'rgba(74,163,255,.7)', [8, 6]);   // camera-motion region
  rect(0.35, 0.25, 0.3, 0.4, 'rgba(255,212,0,.8)', [4, 4]);    // "something at centre" check
  if (frame && !stale) {
    for (const b of frame.boxes) {
      rect(b.x, b.y, b.w, b.h, '#ff3b3b');
      ctx.fillStyle = '#ff3b3b'; ctx.font = `${12 * devicePixelRatio}px monospace`;
      ctx.fillText('moving', b.x * canvas.width, b.y * canvas.height - 4 * devicePixelRatio);
    }
    // Camera pan arrow from the centre (scaled up so small pans are visible).
    const cx = canvas.width / 2, cy = canvas.height / 2, k = 8;
    ctx.setLineDash([]); ctx.strokeStyle = '#00ff9d'; ctx.lineWidth = 3 * devicePixelRatio;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + frame.dx * canvas.width * k, cy + frame.dy * canvas.width * k); ctx.stroke();
  }
  const i = frame && frame.info;
  const lines = !i || stale ? ['Zeroed debug', 'no frames (nothing captured?)'] : [
    'Zeroed debug',
    `new frames ${frame.fps.toFixed(0)}/s (fewer while the picture is still)`,
    `phase      ${i.phase}`,
    `speed      ${i.speed.toFixed(2)} widths/s`,
    `snaps      ${i.strong} strong, weight ${i.weight.toFixed(1)} / ${i.needed} needed`,
    `min score  ${i.minScore.toFixed(2)}`,
    `last snap  ${i.lastScore == null ? '-' : `score ${i.lastScore.toFixed(2)} weight ${i.lastWeight.toFixed(1)}`}`,
    `boxes      ${frame.boxes.length}`
  ];
  const fs = 13 * devicePixelRatio, pad = 8 * devicePixelRatio;
  ctx.font = `${fs}px monospace`;
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + pad * 2;
  ctx.fillStyle = 'rgba(12,14,20,.82)'; ctx.fillRect(pad, pad, w, lines.length * fs * 1.35 + pad);
  ctx.fillStyle = '#e8eaee';
  lines.forEach((l, n) => ctx.fillText(l, pad * 2, pad + fs * 1.1 + n * fs * 1.35));
  requestAnimationFrame(draw);
}

window.zeroed.onDebugFrame((f) => { frame = f; lastAt = Date.now(); });
requestAnimationFrame(draw);
