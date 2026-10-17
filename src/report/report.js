// Small end-of-match popup. Closes on the Close button or by itself after 30 s (handled by the main process).
const $ = (id) => document.getElementById(id);
document.getElementById('close').addEventListener('click', () => window.zeroed.closeReport());
window.zeroed.onReport((r) => {
  $('rTitle').textContent = 'Match report';
  $('rWhere').textContent = `${r.profile || 'Default'} · ${r.label} · ${new Date(r.start).toLocaleTimeString([], { timeStyle: 'short' })}`;
  $('rVerdict').textContent = r.verdict;
  $('rVerdict').classList.toggle('alerted', r.alerts.length > 0);
  const dl = $('rStats');
  dl.textContent = '';
  const add = (k, v) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); };
  add('Duration', Report.formatDuration(r.durationSec));
  add('Alerts at', r.alerts.length ? r.alerts.map(Report.formatDuration).join(', ') : 'None');
  add('Crisp snaps', String(r.strong));
  add('Camera moving', `${r.movingPct}% of frames`);
  add('Cuts ignored', String(r.cuts));
  add('Frames', `${r.frames} (about ${r.fps}/s)`);
});
