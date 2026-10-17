const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let cfg = Crosshair.DEFAULTS;

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  Crosshair.draw(ctx, cfg, canvas.width / 2, canvas.height / 2, render);
}

window.zeroed.onState((s) => { cfg = s.active; render(); });
window.zeroed.getState().then((s) => { cfg = s.active; render(); });
