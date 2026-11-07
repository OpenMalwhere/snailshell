// Snailshell build (Windows / Linux / macOS): reads interface/appname.txt + icon, builds <name> for the OS you run it on.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const ifaceDir = path.join(root, 'interface');
const { readAppName, fileSafe, findIcon, DEFAULT_ICON } = require('../shellinfo');
const plat = process.platform; // OS we run on: win32 | linux | darwin
// OS we build FOR (SNAILSHELL_TARGET=windows|linux|macos). Differs from `plat` = cross-build.
const want = ({ windows: 'win32', win32: 'win32', linux: 'linux', macos: 'darwin', darwin: 'darwin' })[String(process.env.SNAILSHELL_TARGET || '').toLowerCase()] || plat;
const cross = want !== plat;
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';      // never try to code-sign

// Windows without Developer Mode/Admin cannot create symlinks. electron-builder's "winCodeSign" download contains two
// macOS-only symlinks, so unpacking it fails ("Cannot create symbolic link : A required privilege is not held").
// The archive is useless for macOS on a Windows build, so we unpack it ourselves (skipping the darwin folder) into the
// exact cache folder electron-builder looks for (winCodeSign-2.6.0). It then finds it ready and never downloads.
const WCS_VERSION = '2.6.0';
function canSymlink() {
  const os = require('os');
  const a = path.join(os.tmpdir(), 'snl-link-' + process.pid), b = a + '-t';
  try { fs.writeFileSync(a, 'x'); fs.symlinkSync(a, b); return true; }
  catch { return false; }
  finally { for (const f of [a, b]) { try { fs.rmSync(f, { force: true }); } catch {} } }
}
async function seedWinCodeSign() {
  const os = require('os');
  const { spawnSync } = require('child_process');
  const base = process.env.ELECTRON_BUILDER_CACHE || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache');
  const target = path.join(base, 'winCodeSign', 'winCodeSign-' + WCS_VERSION);
  const ready = () => fs.existsSync(path.join(target, 'rcedit-x64.exe'));
  if (ready()) return true;
  const sevenZip = require('7zip-bin').path7za;
  const url = `https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-${WCS_VERSION}/winCodeSign-${WCS_VERSION}.7z`;
  console.log('Windows has no symlink permission - preparing signing tools manually...');
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('Could not download ' + url + ' (HTTP ' + res.status + ')');
  const archive = path.join(os.tmpdir(), `winCodeSign-${WCS_VERSION}.7z`);
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  spawnSync(sevenZip, ['x', '-y', '-bd', '-x!darwin', archive, '-o' + target], { encoding: 'utf8' });
  try { fs.rmSync(archive, { force: true }); } catch {}
  if (!ready()) throw new Error('Signing tools were not unpacked correctly.');
  console.log('Signing tools ready:', target);
  return true;
}
const isSymlinkError = (e) => /symbolic link|required privilege|winCodeSign/i.test(String((e && e.message) || e));

async function makePng(src, out) {                      // 512x512 transparent-padded PNG (Linux + macOS)
  const Jimp = require('jimp');
  const img = await Jimp.read(src);
  fs.writeFileSync(out, await img.clone().contain(512, 512).getBufferAsync(Jimp.MIME_PNG));
}
async function makeIco(src, out) {                      // multi-size .ico (Windows)
  if (path.extname(src).toLowerCase() === '.ico') { fs.copyFileSync(src, out); return; }
  const Jimp = require('jimp');
  const pngToIco = require('png-to-ico');
  const img = await Jimp.read(src);
  const bufs = [];
  for (const s of [256, 128, 64, 48, 32, 16]) bufs.push(await img.clone().contain(s, s).getBufferAsync(Jimp.MIME_PNG));
  fs.writeFileSync(out, await pngToIco(bufs));
}

(async () => {
  const appName = readAppName(ifaceDir);
  const exeName = fileSafe(appName);
  let iconSrc = findIcon(ifaceDir) || DEFAULT_ICON;
  if (want !== 'win32' && path.extname(iconSrc).toLowerCase() === '.ico') {
    console.log('Note: .ico icons only work for Windows builds - use icon.png. Using the default icon here.');
    iconSrc = DEFAULT_ICON;
  }

  console.log('Platform :', plat + (cross ? ' -> building for ' + want : ''));
  console.log('App name :', appName, '->', exeName);
  console.log('Icon     :', iconSrc === DEFAULT_ICON ? '(default Snailshell icon)' : iconSrc);

  const tmp = path.join(root, 'build-temp');
  fs.mkdirSync(tmp, { recursive: true });
  try { fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true }); } catch {}

  if (plat === 'win32' && !canSymlink()) {
    try { await seedWinCodeSign(); }
    catch (e) { console.log('Could not prepare signing tools automatically:', e.message); }
  }
  const builder = require('electron-builder');
  const base = {
    appId: 'com.snailshell.' + exeName.toLowerCase().replace(/[^a-z0-9]/g, ''),
    productName: exeName,
    directories: { output: 'dist' },
    files: ['main.js', 'preload.js', 'shellinfo.js', 'package.json', 'assets/**']
  };
  let targets, config;

  if (want === 'win32') {
    const ico = path.join(tmp, 'icon.ico'); await makeIco(iconSrc, ico);
    // Cross-build from Linux/macOS: no Wine, so the exe's own icon can't be edited (signAndEditExecutable:false).
    // 'zip' always works; the single-file 'portable' .exe needs the x64 NSIS tools, so only try it on x64 hosts.
    const list = !cross ? ['dir', 'portable'] : (process.arch === 'x64' ? ['dir', 'portable', 'zip'] : ['dir', 'zip']);
    targets = builder.Platform.WINDOWS.createTarget(list, ...(cross ? [builder.Arch.x64] : []));
    config = { ...base, win: { icon: ico, target: list, artifactName: exeName + '-windows.${ext}', signAndEditExecutable: !cross && process.env.SNAILSHELL_NO_EDIT !== '1' }, portable: { artifactName: exeName + '.exe' } };
  } else if (want === 'linux') {
    if (cross) throw new Error('A Linux app (.AppImage) cannot be built on ' + plat + '. Use Docker, WSL or GitHub Actions (see the README).');
    const png = path.join(tmp, 'icon.png'); await makePng(iconSrc, png);
    targets = builder.Platform.LINUX.createTarget(['dir', 'AppImage']);
    config = { ...base, linux: { icon: png, category: 'Utility', target: ['dir', 'AppImage'], executableName: exeName },
               appImage: { artifactName: exeName + '.AppImage' } };
  } else if (want === 'darwin') {
    if (cross) throw new Error('A macOS app cannot be built on ' + plat + ' (needs Apple tools). Use a Mac or GitHub Actions (see the README).');
    const png = path.join(tmp, 'icon.png'); await makePng(iconSrc, png);
    targets = builder.Platform.MAC.createTarget(['dir']);
    config = { ...base, mac: { icon: png, category: 'public.app-category.utilities', target: ['dir'], identity: null } };
  } else { throw new Error('Unsupported platform: ' + want); }

  try {
    await builder.build({ targets, config, publish: 'never' });
  } catch (e) {
    if (plat !== 'win32' || !isSymlinkError(e)) throw e;
    console.log('\nSYMLINK_BLOCKED: Windows blocked symbolic links while unpacking electron-builder tools.');
    console.log('Retrying without the signing/icon-editing step...');
    config.win.signAndEditExecutable = false;
    await builder.build({ targets, config, publish: 'never' });
  }

  // copy interface/ next to the app so it stays editable (dist/interface + next to each unpacked build / .app)
  const dist = path.join(root, 'dist');
  const dests = [path.join(dist, 'interface')];
  for (const d of fs.readdirSync(dist, { withFileTypes: true }))
    if (d.isDirectory() && (d.name.endsWith('-unpacked') || d.name.startsWith('mac'))) dests.push(path.join(dist, d.name, 'interface'));
  for (const dest of dests) { fs.rmSync(dest, { recursive: true, force: true }); fs.cpSync(ifaceDir, dest, { recursive: true }); }
  if (want === 'win32' && cross) {                       // zip again, now that interface/ is inside win-unpacked
    const zip = path.join(dist, exeName + '-windows.zip'), src = path.join(dist, 'win-unpacked');
    if (fs.existsSync(src)) {
      try { fs.rmSync(zip, { force: true }); } catch {}
      const r = require('child_process').spawnSync(require('7zip-bin').path7za, ['a', '-tzip', '-mx=5', '-bd', zip, '.'], { cwd: src, encoding: 'utf8' });
      if (r.status !== 0) console.log('Warning: could not rebuild the zip:', (r.stdout || '') + (r.stderr || ''));
    }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

  console.log('\nDone! Look in the dist/ folder. Keep the "interface" folder next to the app.');
})().catch(e => { console.error('\nBuild failed:', e.message || e); process.exit(1); });
