// Match reports: a summary of what cheat hints measured during one match (one continuous capture).
// Only real measurements go in; nothing is estimated or extrapolated.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Report = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MIN_MATCH_SEC = 60; // shorter captures (menus, quick tab-ins) don't get a report

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  // runs: { [captureRunId]: {frames, moving, cuts, strong, seconds} } so capture restarts within a match add up.
  function buildReport({ start, end, label, profile, alerts, runs }) {
    const t = { frames: 0, moving: 0, cuts: 0, strong: 0, seconds: 0 };
    for (const r of Object.values(runs || {})) for (const k of Object.keys(t)) t[k] += Math.max(0, num(r && r[k]));
    const durationSec = Math.max(0, Math.round((num(end) - num(start)) / 1000));
    const report = {
      id: `${num(start)}`,
      start: num(start), durationSec,
      label: String(label || '').slice(0, 120), profile: String(profile || '').slice(0, 40),
      alerts: (alerts || []).map(a => Math.max(0, Math.round((num(a) - num(start)) / 1000))).slice(0, 50),
      frames: t.frames, strong: t.strong, cuts: t.cuts,
      movingPct: t.frames ? Math.round((100 * t.moving) / t.frames) : 0,
      fps: t.seconds ? Math.round((10 * t.frames) / t.seconds) / 10 : 0
    };
    report.verdict = verdict(report);
    return report;
  }

  function verdict(r) {
    if (r.alerts.length) return `${r.alerts.length} alert${r.alerts.length === 1 ? '' : 's'}. Review those moments: an alert is a hint, not proof.`;
    if (r.frames < 30) return 'Too little footage was analysed to judge this match.';
    return 'No suspicious aim patterns seen.';
  }

  function formatDuration(sec) {
    sec = Math.max(0, Math.round(num(sec)));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  // Reports read back from the settings file are untrusted; rebuild them field by field.
  function sanitizeReports(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 20).filter(r => r && typeof r === 'object').map(r => {
      const out = {
        id: String(r.id || '').slice(0, 20), start: num(r.start), durationSec: Math.max(0, Math.round(num(r.durationSec))),
        label: String(r.label || '').slice(0, 120), profile: String(r.profile || '').slice(0, 40),
        alerts: (Array.isArray(r.alerts) ? r.alerts : []).map(a => Math.max(0, Math.round(num(a)))).slice(0, 50),
        frames: Math.max(0, Math.round(num(r.frames))), strong: Math.max(0, Math.round(num(r.strong))), cuts: Math.max(0, Math.round(num(r.cuts))),
        movingPct: Math.min(100, Math.max(0, Math.round(num(r.movingPct)))), fps: Math.max(0, num(r.fps))
      };
      out.verdict = verdict(out);
      return out;
    });
  }

  return { MIN_MATCH_SEC, buildReport, formatDuration, sanitizeReports, verdict };
});
