// Shared crosshair renderer + settings model. Loaded by Node (tests/main) and by both renderers.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Crosshair = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULTS = {
    style: 'cross',       // cross | t | dot | circle | image
    color: '#00ff66',
    opacity: 1,
    length: 10,           // arm length (px)
    thickness: 2,
    gap: 4,               // distance from center to arm start
    rotation: 0,          // degrees
    dot: true,
    dotSize: 2,
    circleRadius: 12,
    circleThickness: 2,
    outline: true,
    outlineColor: '#000000',
    outlineThickness: 1,
    scale: 1,             // image scale
    image: '',            // data URL for style === 'image'
    offsetX: 0,
    offsetY: 0
  };

  const RANGES = {
    opacity: [0.05, 1], length: [0, 150], thickness: [1, 30], gap: [0, 100],
    rotation: [-180, 180], dotSize: [1, 40], circleRadius: [2, 200],
    circleThickness: [1, 30], outlineThickness: [0, 10], scale: [0.1, 8],
    offsetX: [-3000, 3000], offsetY: [-3000, 3000]
  };
  const STYLES = ['cross', 't', 'dot', 'circle', 'image'];
  const HEX = /^#[0-9a-f]{6}$/i;

  function clamp(v, [lo, hi]) { return Math.min(hi, Math.max(lo, v)); }

  // Coerce untrusted input (imported share codes, hand-edited config) into a valid config.
  function sanitize(input) {
    const out = Object.assign({}, DEFAULTS);
    if (!input || typeof input !== 'object') return out;
    if (STYLES.includes(input.style)) out.style = input.style;
    for (const k of ['color', 'outlineColor']) if (typeof input[k] === 'string' && HEX.test(input[k])) out[k] = input[k].toLowerCase();
    for (const k of Object.keys(RANGES)) {
      const n = Number(input[k]);
      if (input[k] !== undefined && input[k] !== null && input[k] !== '' && Number.isFinite(n)) out[k] = clamp(n, RANGES[k]);
    }
    for (const k of ['dot', 'outline']) if (typeof input[k] === 'boolean') out[k] = input[k];
    if (typeof input.image === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(input.image)) out.image = input.image;
    return out;
  }

  const imageCache = new Map();
  function getImage(src, onLoad) {
    if (typeof Image === 'undefined' || !src) return null;
    let img = imageCache.get(src);
    if (!img) {
      img = new Image();
      img.onload = onLoad || null;
      img.src = src;
      imageCache.set(src, img);
      if (imageCache.size > 8) imageCache.delete(imageCache.keys().next().value);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  // Draw at (cx, cy) on a 2D context. `onImageReady` re-triggers drawing once an image finishes decoding.
  function draw(ctx, cfg, cx, cy, onImageReady) {
    const c = sanitize(cfg);
    ctx.save();
    ctx.globalAlpha = c.opacity;
    ctx.translate(cx, cy);
    ctx.rotate((c.rotation * Math.PI) / 180);
    ctx.lineCap = 'butt';

    if (c.style === 'image') {
      const img = getImage(c.image, onImageReady);
      if (img) {
        const w = img.naturalWidth * c.scale, h = img.naturalHeight * c.scale;
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      }
      ctx.restore();
      return;
    }

    const arms = [];
    if (c.style === 'cross' || c.style === 't') {
      const g = c.gap, l = c.length;
      arms.push([-g - l, 0, -g, 0], [g, 0, g + l, 0], [0, g, 0, g + l]);
      if (c.style === 'cross') arms.push([0, -g - l, 0, -g]);
    }
    // Vertical/horizontal arms are axis-aligned rects, so outlines and fills stay pixel-crisp.
    const rects = arms.map(([x1, y1, x2, y2]) => {
      const t = c.thickness;
      return x1 === x2
        ? { x: x1 - t / 2, y: Math.min(y1, y2), w: t, h: Math.abs(y2 - y1) }
        : { x: Math.min(x1, x2), y: y1 - t / 2, w: Math.abs(x2 - x1), h: t };
    });

    const ow = c.outline ? c.outlineThickness : 0;
    if (ow > 0) {
      ctx.fillStyle = c.outlineColor;
      for (const r of rects) ctx.fillRect(r.x - ow, r.y - ow, r.w + ow * 2, r.h + ow * 2);
      if (c.style === 'circle') {
        ctx.strokeStyle = c.outlineColor;
        ctx.lineWidth = c.circleThickness + ow * 2;
        ctx.beginPath(); ctx.arc(0, 0, c.circleRadius, 0, Math.PI * 2); ctx.stroke();
      }
      if (c.dot || c.style === 'dot') {
        ctx.beginPath(); ctx.arc(0, 0, c.dotSize / 2 + ow, 0, Math.PI * 2); ctx.fill();
      }
    }

    ctx.fillStyle = c.color;
    for (const r of rects) ctx.fillRect(r.x, r.y, r.w, r.h);
    if (c.style === 'circle') {
      ctx.strokeStyle = c.color;
      ctx.lineWidth = c.circleThickness;
      ctx.beginPath(); ctx.arc(0, 0, c.circleRadius, 0, Math.PI * 2); ctx.stroke();
    }
    if (c.dot || c.style === 'dot') {
      ctx.beginPath(); ctx.arc(0, 0, c.dotSize / 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // Share codes: "ZR1:" + base64(JSON); older SL1:/FH1: codes still import. Images are excluded to keep codes short.
  function encode(cfg) {
    const c = sanitize(cfg);
    const out = {};
    for (const k of Object.keys(DEFAULTS)) if (k !== 'image' && c[k] !== DEFAULTS[k]) out[k] = c[k];
    if (c.style === 'image') out.style = 'cross';
    const json = JSON.stringify(out);
    const b64 = typeof Buffer !== 'undefined' ? Buffer.from(json, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(json)));
    return 'ZR1:' + b64;
  }

  function decode(code) {
    if (typeof code !== 'string') throw new Error('Not a share code');
    const m = /^(?:ZR1|SL1|FH1):([A-Za-z0-9+/=]+)$/.exec(code.trim());
    if (!m) throw new Error('Not a valid Zeroed code');
    const json = typeof Buffer !== 'undefined' ? Buffer.from(m[1], 'base64').toString('utf8') : decodeURIComponent(escape(atob(m[1])));
    return sanitize(JSON.parse(json));
  }

  // Files: {format:'zeroed', version:1, crosshairs:[{name, cfg}]}. Images are included, unlike share codes.
  const MAX_PACK = 100;
  function toPack(list) {
    return JSON.stringify({
      format: 'zeroed', version: 1,
      crosshairs: list.slice(0, MAX_PACK).map(p => ({ name: String(p.name || 'Untitled').slice(0, 40), cfg: sanitize(p.cfg) }))
    }, null, 2);
  }
  function parsePack(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('File is not valid JSON'); }
    if (!data || !['zeroed', 'sightline'].includes(data.format) || !Array.isArray(data.crosshairs)) throw new Error('Not a Zeroed crosshair file');
    const out = data.crosshairs.slice(0, MAX_PACK).filter(p => p && typeof p === 'object')
      .map(p => ({ name: String(p.name || 'Imported').slice(0, 40), cfg: sanitize(p.cfg) }));
    if (!out.length) throw new Error('File contains no crosshairs');
    return out;
  }

  const PRESETS = [
    { name: 'Classic Green', cfg: {} },
    { name: 'Tiny Dot', cfg: { style: 'dot', dotSize: 4, color: '#ff2d2d' } },
    { name: 'T-Shape Cyan', cfg: { style: 't', color: '#00e5ff', length: 8, gap: 3 } },
    { name: 'Ring', cfg: { style: 'circle', circleRadius: 14, circleThickness: 2, dot: true, color: '#ffe600' } },
    { name: 'Precision', cfg: { length: 6, gap: 2, thickness: 1, dotSize: 1, color: '#ffffff' } },
    { name: 'Wide Open', cfg: { length: 14, gap: 12, thickness: 2, dot: false, color: '#ff00d4' } }
  ].map(p => ({ name: p.name, cfg: sanitize(p.cfg) }));

  return { DEFAULTS, RANGES, STYLES, PRESETS, sanitize, draw, encode, decode, toPack, parsePack };
});
