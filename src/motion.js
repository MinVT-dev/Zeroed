// Estimates global camera pan between two frames using row/column brightness profiles.
// Cheap (no ML, no OpenCV) so it can run at ~30 fps on a 128x72 grayscale downscale.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Motion = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Central region only: HUD elements at the edges don't move with the camera and would bias toward "no motion".
  function profiles(gray, w, h) {
    const x0 = Math.floor(w * 0.2), x1 = Math.floor(w * 0.8), y0 = Math.floor(h * 0.15), y1 = Math.floor(h * 0.7);
    const cols = new Float32Array(x1 - x0), rows = new Float32Array(y1 - y0);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const v = gray[y * w + x];
      cols[x - x0] += v; rows[y - y0] += v;
    }
    const norm = (a, d) => { for (let i = 0; i < a.length; i++) a[i] /= d; return a; };
    return { cols: norm(cols, y1 - y0), rows: norm(rows, x1 - x0) };
  }

  // Shift s minimizing mean |b[i] - a[i+s]|. Returns the shift and how much better it is than no shift.
  function bestShift(a, b, maxS) {
    const n = a.length;
    let best = 0, bestCost = Infinity, zeroCost = Infinity;
    // Try shifts nearest zero first and only accept a strictly better one, so repeating textures
    // (stripes, tiles, fences) don't alias to a whole-period jump when "no movement" fits as well.
    for (let k = 0; k <= 2 * maxS; k++) {
      const s = k % 2 ? (k + 1) / 2 : -k / 2;
      const lo = Math.max(0, -s), hi = Math.min(n, n - s), count = hi - lo;
      if (count < n / 2) continue;
      // De-mean over the overlap so global brightness changes (muzzle flash, damage vignette) don't matter.
      let ma = 0, mb = 0;
      for (let i = lo; i < hi; i++) { ma += a[i + s]; mb += b[i]; }
      ma /= count; mb /= count;
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += Math.abs((b[i] - mb) - (a[i + s] - ma));
      const cost = sum / count;
      if (s === 0) zeroCost = cost;
      if (cost < bestCost - 1e-6) { bestCost = cost; best = s; }
    }
    return { shift: best, gain: zeroCost - bestCost, cost: bestCost };
  }

  const MIN_GAIN = 0.5;    // gray levels; below this the scene is too flat/noisy to trust a shift
  const MIN_REL_GAIN = 0.5; // a real camera pan explains most of the change; one figure walking past does not

  function estimate(prev, cur, maxShift) {
    const x = bestShift(prev.cols, cur.cols, maxShift);
    const y = bestShift(prev.rows, cur.rows, Math.min(maxShift, Math.floor(prev.rows.length / 3)));
    const ok = (r) => r.gain > MIN_GAIN && r.gain > MIN_REL_GAIN * (r.gain + r.cost);
    return { dx: ok(x) ? x.shift : 0, dy: ok(y) ? y.shift : 0 };
  }

  // How much of the new frame the estimated shift fails to explain, relative to the frame's contrast.
  // A real camera pan leaves little behind (well under 0.1 on real footage); a scene cut such as a
  // spectate switch or round-end screen leaves more than 1. Above CUT_RATIO, treat the frame as a cut.
  const CUT_RATIO = 0.8;
  function residualRatio(prev, cur, w, h, dx, dy) {
    let mean = 0;
    for (let i = 0; i < cur.length; i++) mean += cur[i];
    mean /= cur.length;
    let dev = 0;
    for (let i = 0; i < cur.length; i++) dev += Math.abs(cur[i] - mean);
    dev /= cur.length;
    let sum = 0, cnt = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = x + dx, py = y + dy;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      sum += Math.abs(cur[y * w + x] - prev[py * w + px]); cnt++;
    }
    return cnt ? (sum / cnt) / Math.max(1, dev) : Infinity;
  }
  const isCut = (prev, cur, w, h, dx, dy) => residualRatio(prev, cur, w, h, dx, dy) > CUT_RATIO;

  // Fraction of pixels that changed by more than `thresh` between two same-sized grayscale images.
  // Used on a sharp crop of the screen centre taken when the camera stops after a snap and again
  // ~150 ms later: anything that changed belongs to something moving on its own (a player, an NPC).
  // Deliberately crude: it can't tell a player from a spinning prop, and it can't see a target standing still.
  function changedFraction(a, b, thresh = 18) {
    let changed = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > thresh) changed++;
    return changed / a.length;
  }

  // Debug view: boxes around things that move independently of the camera. Compensates the estimated pan
  // (cur[i] ~ prev[i+shift]), thresholds the difference and groups changed pixels into boxes.
  // Returns [{x, y, w, h}] in 0..1 frame coordinates, biggest first. Only run while the dev overlay is on.
  function movingBlobs(prev, cur, w, h, dx, dy, thresh = 28, minArea = 6, maxBoxes = 8) {
    const mask = new Uint8Array(w * h);
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const px = x + dx, py = y + dy;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      if (Math.abs(cur[y * w + x] - prev[py * w + px]) > thresh) mask[y * w + x] = 1;
    }
    const boxes = [], stack = [];
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] !== 1) continue;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
      stack.push(i); mask[i] = 2;
      while (stack.length) {
        const k = stack.pop(), x = k % w, y = (k / w) | 0;
        area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && mask[k - 1] === 1) { mask[k - 1] = 2; stack.push(k - 1); }
        if (x < w - 1 && mask[k + 1] === 1) { mask[k + 1] = 2; stack.push(k + 1); }
        if (y > 0 && mask[k - w] === 1) { mask[k - w] = 2; stack.push(k - w); }
        if (y < h - 1 && mask[k + w] === 1) { mask[k + w] = 2; stack.push(k + w); }
      }
      boxes.push({ area, x0, y0, x1, y1 });
    }
    // A flat-coloured object only changes at its leading and trailing edges, giving two slivers that line up
    // along its height (or width, for vertical motion). Merge boxes that touch, or that are aligned and
    // closer together than their own size.
    const GAP = 3;
    const sameObject = (a, b) => {
      const near = a.x0 - GAP <= b.x1 && b.x0 - GAP <= a.x1 && a.y0 - GAP <= b.y1 && b.y0 - GAP <= a.y1;
      const hMin = Math.min(a.y1 - a.y0, b.y1 - b.y0) + 1, wMin = Math.min(a.x1 - a.x0, b.x1 - b.x0) + 1;
      const yOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1, xOverlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
      const xGap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1) - 1, yGap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1) - 1;
      const sideBySide = yOverlap >= 0.6 * hMin && xGap <= Math.max(GAP, hMin);
      const stacked = xOverlap >= 0.6 * wMin && yGap <= Math.max(GAP, wMin);
      return near || sideBySide || stacked;
    };
    for (let merged = true; merged;) {
      merged = false;
      for (let i = 0; i < boxes.length && !merged; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (sameObject(a, b)) {
          boxes[i] = { area: a.area + b.area, x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
          boxes.splice(j, 1); merged = true; break;
        }
      }
    }
    return boxes
      .filter(b => b.area >= minArea && (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) < w * h * 0.4)
      .sort((a, b) => b.area - a.area).slice(0, maxBoxes)
      .map(b => ({ x: b.x0 / w, y: b.y0 / h, w: (b.x1 - b.x0 + 1) / w, h: (b.y1 - b.y0 + 1) / h }));
  }

  return { profiles, bestShift, estimate, residualRatio, isCut, changedFraction, movingBlobs };
});
