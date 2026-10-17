const p = new URLSearchParams(location.search);
const pct = Math.round(Math.min(1, Math.max(0, Number(p.get('c')) || 0)) * 100);
const n = Math.max(0, Math.min(99, Number(p.get('n')) || 0));
if (p.get('t') === '1') { document.getElementById('title').textContent = 'Test alert (not a real detection)'; document.getElementById('toast').classList.add('test'); }
const win = Math.max(1, Math.min(600, Number(p.get('w')) || 15));
document.getElementById('detail').textContent = `${n} crisp snaps in ${win} s · confidence about ${pct}%`;

// Optional two-tone chime so an alert is noticed even when eyes are on the game.
if (p.get('s') === '1') {
  try {
    const ac = new AudioContext();
    [[880, 0], [660, 0.16]].forEach(([f, at]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ac.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + at + 0.14);
      o.connect(g).connect(ac.destination); o.start(ac.currentTime + at); o.stop(ac.currentTime + at + 0.15);
    });
  } catch { /* audio unavailable: the visual alert still shows */ }
}
