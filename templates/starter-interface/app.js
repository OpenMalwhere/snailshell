const $ = (id) => document.getElementById(id);

(async () => {
  const i = await snailshell.system.info();
  $('info').textContent =
`User      : ${i.user}@${i.hostname}
Platform  : ${i.platform} ${i.arch} (${i.osRelease})
CPU       : ${i.cpuModel} x${i.cpus}
Memory    : ${(i.freeMem/1e9).toFixed(1)} GB free / ${(i.totalMem/1e9).toFixed(1)} GB
Snailshell: v${i.version}
Interface : ${i.interfaceDir}`;
})();

async function run() {
  const cmd = $('cmd').value.trim();
  if (!cmd) return;
  $('out').textContent = '> ' + cmd + '\n';
  const r = await snailshell.system.exec(cmd);
  $('out').textContent += (r.stdout || '') + (r.stderr || '') + (r.ok ? '' : `\n[exit code ${r.code}]`);
}
$('run').onclick = run;
$('cmd').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });

$('pick').onclick = async () => {
  const [file] = await snailshell.dialog.open({ properties: ['openFile'] });
  if (!file) return;
  $('picked').textContent = file;
  try {
    const text = await snailshell.fs.read(file);
    $('preview').textContent = text.slice(0, 3000);
  } catch (e) { $('preview').textContent = 'Could not read as text: ' + e.message; }
};
