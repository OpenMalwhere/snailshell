// Snailshell - main process
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { readAppName, findIcon, DEFAULT_ICON } = require('./shellinfo');

let win = null;
let interfaceDir = null;
let config = {};
let appName = 'shell';

// ---------- locate the interface folder ----------
function findInterfaceDir() {
  const list = [];
  if (process.env.SNAILSHELL_INTERFACE) list.push(process.env.SNAILSHELL_INTERFACE);                                  // test run from the CLI
  if (!app.isPackaged) list.push(path.join(__dirname, 'interface'));
  if (process.env.PORTABLE_EXECUTABLE_DIR) list.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'interface')); // Windows portable
  if (process.env.APPIMAGE) list.push(path.join(path.dirname(process.env.APPIMAGE), 'interface'));                  // Linux AppImage
  if (process.platform === 'darwin') list.push(path.join(process.execPath, '..', '..', '..', '..', 'interface'));  // macOS: next to the .app
  list.push(path.join(path.dirname(process.execPath), 'interface'));
  list.push(path.join(__dirname, 'interface'));
  return list.find(p => fs.existsSync(p)) || list[0];
}

function loadConfig() {
  const defaults = {
    width: 1100, height: 720, minWidth: 400, minHeight: 300,
    frameless: false, entry: 'index.html', alwaysOnTop: false, hideMenu: true, devtools: false
  };
  try {
    const raw = fs.readFileSync(path.join(interfaceDir, 'snailshell.json'), 'utf8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch { return defaults; }
}

const FALLBACK = `data:text/html;charset=utf-8,${encodeURIComponent(`
<body style="font-family:Segoe UI,sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:64px">🐌</div><h2>Snailshell</h2>
<p>No interface found.<br>Create an <b>interface</b> folder next to Snailshell.exe<br>and put an <b>index.html</b> in it.</p></div></body>`)}`;

function applyIcon() {
  const img = nativeImage.createFromPath(findIcon(interfaceDir) || DEFAULT_ICON);
  if (win) win.setIcon(img);                                   // Windows + Linux
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(img); // macOS dock
}

function createWindow() {
  interfaceDir = findInterfaceDir();
  config = loadConfig();
  appName = readAppName(interfaceDir);
  app.setAppUserModelId(appName);

  win = new BrowserWindow({
    title: appName,
    icon: nativeImage.createFromPath(findIcon(interfaceDir) || DEFAULT_ICON),
    width: config.width, height: config.height,
    minWidth: config.minWidth, minHeight: config.minHeight,
    frame: !config.frameless,
    alwaysOnTop: !!config.alwaysOnTop,
    backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  applyIcon();
  win.on('page-title-updated', e => e.preventDefault()); // window title always = appname.txt

  if (config.hideMenu) Menu.setApplicationMenu(null);

  const entry = path.join(interfaceDir, config.entry);
  if (fs.existsSync(entry)) win.loadFile(entry); else win.loadURL(FALLBACK);

  if (config.devtools) win.webContents.openDevTools({ mode: 'detach' });

  // open target=_blank / external links in the default browser
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  watchInterface();
  win.on('closed', () => { win = null; });
}

// ---------- live reload when interface files change ----------
let watcher = null, timer = null;
function watchInterface() {
  if (watcher) { try { watcher.close(); } catch {} }
  if (!fs.existsSync(interfaceDir)) return;
  try {
    watcher = fs.watch(interfaceDir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!win) return;
        config = loadConfig();
        appName = readAppName(interfaceDir);
        win.setTitle(appName);
        applyIcon();
        const entry = path.join(interfaceDir, config.entry);
        if (fs.existsSync(entry)) win.loadFile(entry); else win.loadURL(FALLBACK);
      }, 250);
    });
  } catch {}
}

// ---------- system API (exposed through preload as window.snailshell) ----------
ipcMain.handle('sys:info', () => ({
  platform: process.platform, arch: process.arch, hostname: os.hostname(),
  user: os.userInfo().username, home: os.homedir(), tmp: os.tmpdir(),
  cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model,
  totalMem: os.totalmem(), freeMem: os.freemem(), uptime: os.uptime(),
  osRelease: os.release(), version: app.getVersion(), interfaceDir, appName
}));

ipcMain.handle('sys:exec', (_e, command, opts = {}) => new Promise(resolve => {
  exec(command, { cwd: opts.cwd || os.homedir(), timeout: opts.timeout || 60000, windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
    (error, stdout, stderr) => resolve({ ok: !error, code: error ? error.code : 0, stdout, stderr }));
}));

ipcMain.handle('fs:read', async (_e, p, enc = 'utf8') => fs.promises.readFile(p, enc === 'base64' ? undefined : enc).then(b => enc === 'base64' ? b.toString('base64') : b));
ipcMain.handle('fs:write', async (_e, p, data) => { await fs.promises.mkdir(path.dirname(p), { recursive: true }); await fs.promises.writeFile(p, data); return true; });
ipcMain.handle('fs:list', async (_e, p) => {
  const items = await fs.promises.readdir(p, { withFileTypes: true });
  return items.map(i => ({ name: i.name, dir: i.isDirectory() }));
});
ipcMain.handle('fs:exists', (_e, p) => fs.existsSync(p));
ipcMain.handle('fs:delete', async (_e, p) => { await fs.promises.rm(p, { recursive: true, force: true }); return true; });

ipcMain.handle('dialog:open', async (_e, opts = {}) => (await dialog.showOpenDialog(win, opts)).filePaths);
ipcMain.handle('dialog:save', async (_e, opts = {}) => (await dialog.showSaveDialog(win, opts)).filePath || null);
ipcMain.handle('dialog:message', async (_e, opts = {}) => (await dialog.showMessageBox(win, opts)).response);

ipcMain.handle('shell:open', (_e, target) => shell.openExternal(target));
ipcMain.handle('shell:openPath', (_e, target) => shell.openPath(target));
ipcMain.handle('shell:show', (_e, target) => shell.showItemInFolder(target));

ipcMain.handle('clip:read', () => clipboard.readText());
ipcMain.handle('clip:write', (_e, t) => { clipboard.writeText(String(t)); return true; });

ipcMain.handle('win:minimize', () => win && win.minimize());
ipcMain.handle('win:maximize', () => { if (!win) return; win.isMaximized() ? win.unmaximize() : win.maximize(); });
ipcMain.handle('win:close', () => win && win.close());
ipcMain.handle('win:setTitle', (_e, t) => win && win.setTitle(String(t)));
ipcMain.handle('win:fullscreen', (_e, v) => win && win.setFullScreen(!!v));
ipcMain.handle('win:alwaysOnTop', (_e, v) => win && win.setAlwaysOnTop(!!v));
ipcMain.handle('app:reload', () => win && win.reload());
ipcMain.handle('app:devtools', () => win && win.webContents.toggleDevTools());
ipcMain.handle('app:quit', () => app.quit());

// ---------- lifecycle ----------
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox'); // lets the unpacked/AppImage build run without setuid sandbox setup
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); } else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
}
app.on('window-all-closed', () => app.quit());
