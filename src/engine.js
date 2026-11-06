'use strict';
// The "engine" is the Electron shell (main.js, preload.js, build script). On first run it is copied to
// ~/.snailshell/engine and its npm packages are downloaded for THIS operating system (Electron is OS-specific).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const ui = require('./ui');
const { HOME_DIR } = require('./system');

const PKG_ROOT = path.join(__dirname, '..');
const ENGINE_SRC = path.join(PKG_ROOT, 'engine');
const ENGINE_DIR = path.join(HOME_DIR, 'engine');
const STAMP = path.join(ENGINE_DIR, '.snailshell-stamp.json');
const SKIP = new Set(['node_modules', 'dist', 'build-temp', 'interface', '.git']);

function copyTree(src, dest, skip = SKIP) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyTree(s, d, skip); else fs.copyFileSync(s, d);
  }
}

const LOG_FILE = path.join(HOME_DIR, 'last-run.log');

// Runs a command with a clean spinner. Raw output is NOT dumped on screen - it goes to ~/.snailshell/last-run.log
function run(cmd, args, { cwd, label, env } = {}) {
  return new Promise((resolve) => {
    const sp = ui.live(label);
    const tail = [];
    let log; try { fs.mkdirSync(HOME_DIR, { recursive: true }); log = fs.createWriteStream(LOG_FILE, { flags: 'a' }); log.write(`\n=== ${new Date().toISOString()}  ${cmd} ${args.join(' ')}\n`); } catch { /* ignore */ }
    const child = spawn([cmd, ...args].join(' '), { cwd, shell: true, env: { ...process.env, NODE_NO_WARNINGS: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (buf) => {
      if (log) log.write(buf);
      sp.push(buf);
      for (const line of buf.toString().split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        tail.push(t); if (tail.length > 80) tail.shift();
      }
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    const finish = (code) => { if (log) log.end(); resolve({ code, tail, text: tail.join('\n') }); };
    child.on('error', (e) => { sp.fail(label + ' - ' + e.message); finish(1); });
    child.on('close', (code) => {
      if (code === 0) sp.succeed(label); else sp.fail(label);
      finish(code);
    });
  });
}

function readStamp() { try { return JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch { return null; } }

async function ensureEngine(sys, version) {
  const want = { version, platform: sys.platform, arch: sys.arch, nodeMajor: sys.node.split('.')[0] };
  const have = readStamp();
  const electronOk = fs.existsSync(path.join(ENGINE_DIR, 'node_modules', 'electron', 'path.txt'));
  const builderOk = fs.existsSync(path.join(ENGINE_DIR, 'node_modules', 'electron-builder', 'package.json'));
  const jimpOk = fs.existsSync(path.join(ENGINE_DIR, 'node_modules', 'jimp', 'package.json'));
  const same = have && have.version === want.version && have.platform === want.platform && have.arch === want.arch;

  if (same && electronOk && builderOk && jimpOk) {
    copyTree(ENGINE_SRC, ENGINE_DIR);               // keep engine scripts (main.js, build.js...) up to date
    ui.ok(`Engine ready ${ui.color.gray('(' + ENGINE_DIR + ')')}`);
    return;
  }

  ui.info(`First-time setup for ${sys.pretty} (${sys.arch}). Downloading the packages for your OS - this happens once.`);
  fs.mkdirSync(ENGINE_DIR, { recursive: true });
  if (have && (have.platform !== want.platform || have.arch !== want.arch)) {
    // node_modules from another OS can't be reused
    fs.rmSync(path.join(ENGINE_DIR, 'node_modules'), { recursive: true, force: true });
  }
  copyTree(ENGINE_SRC, ENGINE_DIR);
  ui.ok('Engine files copied');

  const r = await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: ENGINE_DIR, label: 'Downloading Electron + build tools for ' + sys.host.label.replace(' app', '') });
  if (r.code !== 0) {
    r.tail.slice(-12).forEach((l) => console.log('  ' + l));
    throw new Error('Package download failed. Check your internet connection (Electron is fetched from github.com) and run snailshell again.');
  }
  if (!fs.existsSync(path.join(ENGINE_DIR, 'node_modules', 'electron', 'path.txt'))) {
    throw new Error('Electron did not finish downloading. Run "snailshell reset" and try again.');
  }
  fs.writeFileSync(STAMP, JSON.stringify(want));
  ui.ok('Engine installed');
}

// "npm start": open the Electron app straight from the engine, pointing at the given interface folder.
function start(ifaceDir) {
  return new Promise((resolve) => {
    const env = { ...process.env, SNAILSHELL_INTERFACE: ifaceDir };
    delete env.ELECTRON_RUN_AS_NODE;                // set by some terminals (e.g. VS Code) - would break Electron
    const ignore = () => {};
    process.on('SIGINT', ignore);                   // Ctrl+C closes the app, not this wizard
    const child = spawn('npm start --silent', { cwd: ENGINE_DIR, shell: true, env, stdio: ['ignore', 'inherit', 'inherit'] });
    const done = (code) => { process.removeListener('SIGINT', ignore); resolve(code); };
    child.on('error', (e) => { console.error(e.message); done(1); });
    child.on('close', done);
  });
}

function jimpLib() {
  const { createRequire } = require('module');
  return createRequire(path.join(ENGINE_DIR, 'package.json'))('jimp');
}

function resetEngine() { fs.rmSync(ENGINE_DIR, { recursive: true, force: true }); }

module.exports = { LOG_FILE, ENGINE_DIR, ENGINE_SRC, PKG_ROOT, copyTree, ensureEngine, run, start, jimpLib, resetEngine };
