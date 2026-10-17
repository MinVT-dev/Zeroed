// Watches which window is in front (process name + title), so per-game profiles can switch automatically.
// Electron has no API for other apps' windows, so this uses what each OS ships:
//   Windows: one long-running hidden PowerShell process that polls user32 and prints changes.
//   Linux:   xdotool, if installed.   macOS: osascript (System Events).
const { spawn, execFile } = require('child_process');

const PS_SCRIPT = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class ZeroedFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$lastLine = ''; $lastH = [IntPtr]::Zero; $name = ''
while ($true) {
  $h = [ZeroedFg]::GetForegroundWindow()
  if ($h -ne $lastH) {
    $procId = 0; [void][ZeroedFg]::GetWindowThreadProcessId($h, [ref]$procId)
    $name = ''; try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
    $lastH = $h
  }
  $sb = New-Object System.Text.StringBuilder 512
  [void][ZeroedFg]::GetWindowText($h, $sb, 512)
  $line = "$name\`t$($sb.ToString())"
  if ($line -ne $lastLine) { [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $lastLine = $line }
  Start-Sleep -Milliseconds 700
}`;

function parseLine(line) {
  const i = line.indexOf('\t');
  return i < 0 ? { process: '', title: line.trim() } : { process: line.slice(0, i).trim(), title: line.slice(i + 1).trim() };
}

// onChange({process, title}) fires whenever the front window changes. Returns { supported, stop() }.
function watchForeground(onChange, platform = process.platform) {
  let stopped = false, child = null, timer = null, last = '';
  const emit = (fg) => {
    const key = `${fg.process}\t${fg.title}`;
    if (key !== last) { last = key; onChange(fg); }
  };

  if (platform === 'win32') {
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    const startPs = () => {
      if (stopped) return;
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
      let buf = '';
      child.stdout.on('data', (d) => {
        buf += d.toString('utf8');
        let n;
        while ((n = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, n).replace(/\r$/, ''); buf = buf.slice(n + 1); if (line) emit(parseLine(line)); }
      });
      child.on('error', () => { child = null; });
      child.on('exit', () => { child = null; if (!stopped) setTimeout(startPs, 5000); }); // restart if it dies
    };
    startPs();
    return { supported: true, stop: () => { stopped = true; if (child) child.kill(); } };
  }

  const poll = (cmd, args, parse) => {
    const tick = () => execFile(cmd, args, { timeout: 2000 }, (err, out) => {
      if (stopped) return;
      if (!err) emit(parse(String(out)));
      timer = setTimeout(tick, 1000);
    });
    tick();
  };
  if (platform === 'linux') {
    // Older xdotool builds lack getwindowclassname; fall back to the title alone.
    execFile('xdotool', ['getactivewindow', 'getwindowclassname'], { timeout: 2000 }, (err) => {
      if (stopped) return;
      if (!err) poll('xdotool', ['getactivewindow', 'getwindowclassname', 'getactivewindow', 'getwindowname'], (out) => {
        const [cls = '', title = ''] = out.split('\n');
        return { process: cls.trim(), title: title.trim() };
      });
      else poll('xdotool', ['getactivewindow', 'getwindowname'], (out) => ({ process: '', title: out.trim() }));
    });
    return { supported: true, stop: () => { stopped = true; clearTimeout(timer); } };
  }
  if (platform === 'darwin') {
    poll('osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'], (out) => ({ process: out.trim(), title: out.trim() }));
    return { supported: true, stop: () => { stopped = true; clearTimeout(timer); } };
  }
  return { supported: false, stop() {} };
}

module.exports = { watchForeground, parseLine, PS_SCRIPT };
