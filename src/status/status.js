// Small always-on-top badge so the user can see cheat hints is running, and notice alerts.
const badge = document.getElementById('b'), text = document.getElementById('text');
const LABELS = { watching: 'Cheat hints: watching', waiting: 'Cheat hints: waiting', error: 'Cheat hints: capture error' };
let last = { state: 'starting', alerts: 0 }, flashUntil = 0, flashTest = false, timer = null;

function render() {
  const n = Math.max(0, Math.min(999, Number(last.alerts) || 0));
  const count = `${n} alert${n === 1 ? '' : 's'}`;
  const flashing = Date.now() < flashUntil;
  badge.className = 'badge ' + (LABELS[last.state] ? last.state : '') + (flashing ? ' flash' : '');
  text.textContent = flashing
    ? (flashTest ? '⚠ Test alert' : `⚠ Possible suspicious aim · ${count}`)
    : `${LABELS[last.state] || 'Cheat hints: starting…'} · ${count}`;
}

window.zeroed.onBadge((s) => {
  last = s;
  if (s.flash) {
    flashUntil = Date.now() + 4000; flashTest = !!s.test;
    clearTimeout(timer); timer = setTimeout(render, 4050);
  }
  render();
});
