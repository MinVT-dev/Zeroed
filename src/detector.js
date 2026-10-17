// Heuristic "suspicious aim" detector working on camera-pan samples from a spectated/recorded view.
// It looks for repeated crisp snaps: very fast, almost straight, then dead still. Humans overshoot,
// correct, and decelerate; some aim assists do not. This is a weak signal and WILL false-positive
// (fast flick players, scripted camera moves, low frame rates), so output is only ever a low-confidence hint.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Detector = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const FRAME_MS = 34;       // capture runs at up to 30 fps
  const STALL_MS = 250;
  const MAX_SNAP_MS = 120;

  // Tunable thresholds. Sensitivity presets set minSnaps/minScore; users can override any of them.
  const DEFAULTS = {
    fast: 2.5,          // screen widths per second that count as part of a snap
    minDisp: 0.12,      // fraction of the screen width a snap must cover
    settleMs: 150,      // how long the camera must stay still after a snap
    windowMs: 15000,    // snaps are counted over this time window
    cooldownMs: 45000,  // minimum time between two alerts
    centre: 'half',     // how a snap counts when nothing moves at screen centre: half | full | ignore
    cuts: true,         // ignore scene cuts (spectate switch, round end)
    maxFps: 30          // analysis frame-rate cap
  };
  const RANGES = {
    fast: [1.5, 6], minDisp: [0.05, 0.4], settleMs: [80, 400], windowMs: [5000, 60000],
    cooldownMs: [10000, 300000], minSnaps: [1, 10], minScore: [0.5, 0.95]
  };

  // Coerce untrusted tuning (settings file, renderer) into valid values; returns null for "use the preset".
  function sanitizeTuning(t) {
    if (!t || typeof t !== 'object') return null;
    const out = {};
    for (const [k, [lo, hi]] of Object.entries(RANGES)) {
      const n = Number(t[k]);
      if (t[k] !== undefined && t[k] !== null && Number.isFinite(n)) out[k] = Math.min(hi, Math.max(lo, k === 'minSnaps' ? Math.round(n) : n));
    }
    if (['half', 'full', 'ignore'].includes(t.centre)) out.centre = t.centre;
    if (typeof t.cuts === 'boolean') out.cuts = t.cuts;
    if (Number(t.maxFps) === 15 || Number(t.maxFps) === 30) out.maxFps = Number(t.maxFps);
    return Object.keys(out).length ? out : null;
  }

  const LEVELS = {
    low:    { minSnaps: 5, minScore: 0.85 },
    medium: { minSnaps: 4, minScore: 0.8 },
    high:   { minSnaps: 3, minScore: 0.7 }
  };

  class Detector {
    // Samples: { t: ms, dx, dy, cut? } where dx/dy are camera pan since the previous sample, in frame-widths,
    // and cut marks a scene change (spectate switch, killcam, round end) that must not count as movement.
    // weigh(t) -> 0..1: how much a snap finishing at time t should count (e.g. lower if nothing is at screen centre).
    // onSnap(snap) fires for every scored snap ({t, score, weight}); used for match statistics.
    constructor({ sensitivity = 'medium', onAlert = () => {}, weigh = () => 1, onSnap = () => {} } = {}) {
      this.weigh = weigh; this.onSnap = onSnap; this.override = null; this.tuning = null;
      this.setSensitivity(sensitivity);
      this.onAlert = onAlert;
      this.reset();
    }
    setSensitivity(level) { this.level = LEVELS[level] ? level : 'medium'; this._applyCfg(); }
    // Dev-only: override thresholds ({minSnaps, minScore}) or pass null to go back to the preset.
    setOverride(o) { this.override = o && Number.isFinite(o.minSnaps) && Number.isFinite(o.minScore) ? { minSnaps: o.minSnaps, minScore: o.minScore } : null; this._applyCfg(); }
    // User tuning from the advanced settings, or null to use the preset alone.
    setTuning(t) { this.tuning = sanitizeTuning(t); this._applyCfg(); }
    _applyCfg() { this.cfg = Object.assign({}, DEFAULTS, LEVELS[this.level] || LEVELS.medium, this.tuning || {}, this.override || {}); }
    isSettling() { return !!this.settle; }
    debugInfo() {
      const strong = this.snaps.filter(sn => sn.score >= this.cfg.minScore);
      const last = this.snaps[this.snaps.length - 1] || null;
      return {
        phase: this.settle ? 'settling' : this.run ? 'snap?' : 'idle',
        speed: this.lastSpeed || 0,
        strong: strong.length,
        weight: strong.reduce((a, b) => a + b.weight, 0),
        needed: this.cfg.minSnaps, minScore: this.cfg.minScore,
        lastScore: last ? last.score : null, lastWeight: last ? last.weight : null
      };
    }
    reset() { this.last = null; this.run = null; this.settle = null; this.snaps = []; this.lastAlert = -Infinity; this.prevStep = 0; }

    push(s) {
      const prev = this.last;
      this.last = s;
      if (!prev) return null;
      const dt = s.t - prev.t;
      if (dt <= 0) return null;
      if (s.cut) { this.run = null; this.settle = null; this.prevStep = 0; return this._evaluate(s.t); }
      const step = Math.hypot(s.dx, s.dy);
      const wasStill = this.prevStep === 0;
      this.prevStep = step;
      // Screen capture only delivers a frame when the picture changes, so after stillness a long gap just
      // means "nothing happened" and the movement in this frame took at most one frame interval. A long gap
      // with movement on both sides means capture really stalled mid-motion, and the sample can't be timed.
      if (dt > STALL_MS && !wasStill && step > 0) { this.run = null; this.settle = null; return null; }
      const dtEff = wasStill ? Math.min(dt, FRAME_MS) : Math.min(dt, STALL_MS);
      this.lastSpeed = (step / dtEff) * 1000;
      const fast = this.lastSpeed > this.cfg.fast;

      if (this.settle) {
        if (fast) { this.settle = null; } // moved again right away: a correction, not a lock
        else {
          this.settle.residual += step;
          if (s.t >= this.settle.until) { this._finishSnap(s.t); }
          return this._evaluate(s.t);
        }
      }
      if (fast) {
        if (!this.run) this.run = { t0: s.t - dtEff, x: 0, y: 0, path: 0 };
        this.run.x += s.dx; this.run.y += s.dy; this.run.path += step; this.run.end = s.t;
      } else if (this.run) {
        const r = this.run;
        this.run = null;
        const disp = Math.hypot(r.x, r.y);
        if (disp >= this.cfg.minDisp && r.end - r.t0 <= MAX_SNAP_MS) {
          this.settle = { run: r, disp, until: s.t + this.cfg.settleMs, residual: step };
        }
      }
      return this._evaluate(s.t);
    }

    _finishSnap(t) {
      const { run, disp, residual } = this.settle;
      this.settle = null;
      const directness = Math.min(1, disp / run.path);
      const stillness = Math.max(0, 1 - residual / disp / 0.25);
      const score = directness * stillness;
      const snap = { t, score, weight: score >= this.cfg.minScore ? this.weigh(t) : 0 };
      this.snaps.push(snap);
      this.onSnap(snap);
    }

    _evaluate(t) {
      this.snaps = this.snaps.filter(sn => t - sn.t <= this.cfg.windowMs);
      const strong = this.snaps.filter(sn => sn.score >= this.cfg.minScore);
      const weight = strong.reduce((a, b) => a + b.weight, 0);
      if (weight < this.cfg.minSnaps || t - this.lastAlert < this.cfg.cooldownMs) return null;
      this.lastAlert = t;
      const avg = strong.reduce((a, b) => a + b.score, 0) / strong.length;
      const alert = { confidence: Math.min(0.9, (weight / (this.cfg.minSnaps * 2)) * avg), snaps: strong.length, windowSec: this.cfg.windowMs / 1000 };
      this.onAlert(alert);
      return alert;
    }
  }

  return { Detector, LEVELS, DEFAULTS, RANGES, sanitizeTuning };
});
