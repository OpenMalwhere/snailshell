'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const ui = require('./ui');
const { color } = ui;
const { TARGETS, detectSystem, missingLinuxLibs, HOME_DIR } = require('./system');
const engine = require('./engine');
const cfgStore = require('./config');
const ai = require('./ai');
const pixel = require('./pixel');

const VERSION = require('../package.json').version;
const IMG_EXT = ['.png', '.ico', '.jpg', '.jpeg', '.bmp'];
const STARTER = path.join(engine.PKG_ROOT, 'templates', 'starter-interface');
const WEB_SUBDIRS = ['dist', 'build', 'public', 'www', 'out'];
const SKIP_COPY = new Set(['node_modules', '.git']);

const HELP = `
${color.bold('snailshell')} - build a desktop app from any interface folder

${color.bold('Usage')}
  snailshell                 start the guided wizard
  snailshell keys            add / change AI keys (OpenRouter, Groq, OpenAI)
  snailshell reset           delete the downloaded engine (re-downloaded on next run)
  snailshell --help | --version

${color.bold('Optional flags')} (skip questions)
  --target windows|linux|macos     --path <interface folder>     --name <app name>
  --out <output folder>            --no-ai (built-in pixel icon)  --no-build (prepare only)
  --mode test|build                test = open the app now (like npm start), build = generate the app file
`;

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--help' || t === '-h') a.help = true;
    else if (t === '--version' || t === '-v') a.version = true;
    else if (t === '--no-ai') a.noAi = true;
    else if (t === '--no-build') a.noBuild = true;
    else if (['--target', '--path', '--name', '--out', '--mode'].includes(t)) a[t.slice(2)] = argv[++i];
    else a._.push(t);
  }
  return a;
}

const fileSafe = (n) => n.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim() || 'shell';

function cleanPath(raw) {
  let p = String(raw).trim().replace(/^["']|["']$/g, '').replace(/^file:\/\//, '');
  p = p.replace(/\\ /g, ' ');                       // drag & drop on mac/linux escapes spaces
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

function walk(dir) {
  let count = 0, bytes = 0;
  (function rec(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP_COPY.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p); else { count++; try { bytes += fs.statSync(p).size; } catch { /* ignore */ } }
    }
  })(dir);
  return { count, bytes };
}
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';

function findIcon(dir) {
  for (const ext of IMG_EXT) { const p = path.join(dir, 'icon' + ext); if (fs.existsSync(p)) return p; }
  const first = fs.readdirSync(dir).filter((f) => IMG_EXT.includes(path.extname(f).toLowerCase()) && fs.statSync(path.join(dir, f)).isFile()).sort()[0];
  return first ? path.join(dir, first) : null;
}
function readName(dir) {
  try { return fs.readFileSync(path.join(dir, 'appname.txt'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)[0].trim(); } catch { return ''; }
}
function guessName(dir) {
  try {
    const m = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').match(/<title>([^<]{1,60})<\/title>/i);
    if (m && m[1].trim()) return m[1].trim();
  } catch { /* ignore */ }
  return path.basename(dir);
}

// ---------- step 3: interface folder ----------
async function chooseInterface(args) {
  while (true) {
    const raw = args.path || await ui.ask('Paste the path of your interface folder');
    if (!raw) { ui.fail('Please paste a folder path.'); continue; }
    let dir = cleanPath(raw);
    const bad = !fs.existsSync(dir) ? 'That folder does not exist.' : !fs.statSync(dir).isDirectory() ? 'That is a file, not a folder.'
      : (dir === path.parse(dir).root || dir === os.homedir()) ? 'That folder is too broad (root / home). Pick the folder that holds your index.html.' : null;
    if (bad) { ui.fail(bad); if (args.path) throw new Error(bad); continue; }

    let starter = false;
    if (!fs.existsSync(path.join(dir, 'index.html'))) {
      const sub = WEB_SUBDIRS.find((s) => fs.existsSync(path.join(dir, s, 'index.html')));
      if (sub) {
        ui.warn(`No index.html in the folder itself, but found one in "${sub}/".`);
        if (args.path || await ui.confirm(`Use ${path.join(dir, sub)} as the interface?`)) dir = path.join(dir, sub);
        else continue;
      } else {
        ui.warn('No index.html found in this folder.');
        const choice = args.path ? 'starter' : await ui.select('What now?', [
          { label: 'Keep my files and add the Snailshell starter index.html', value: 'starter' },
          { label: 'Enter another folder', value: 'again' },
        ]);
        if (choice === 'again') continue;
        starter = true;
      }
    }
    const { count, bytes } = walk(dir);
    ui.ok(`Reading ${color.bold(dir)}`);
    ui.info(`${count} files · ${mb(bytes)}${fs.existsSync(path.join(dir, 'index.html')) ? ' · index.html found' : ''}`);
    if (bytes > 500 * 1048576 && !(args.path || await ui.confirm('This folder is over 500 MB. Continue?', false))) continue;
    return { dir, starter };
  }
}

// ---------- AI provider flow ----------
async function connectProvider(cfg, preselect) {
  const provider = preselect || await ui.select('Which AI service do you want to use?', [
    ...Object.entries(ai.PROVIDERS).map(([k, p]) => ({ label: p.label, value: k, hint: cfg.keys[k] ? 'key saved' : p.hint })),
    { label: 'Skip - use the built-in pixel generator', value: null },
  ]);
  if (!provider) return null;
  const P = ai.PROVIDERS[provider];
  let key = cfg.keys[provider];
  if (key && !(await ui.confirm(`Use your saved ${P.label} key?`))) key = null;
  while (true) {
    if (!key) {
      key = (await ui.ask(`${P.label} API key`, { secret: true })).trim();
      if (!key) { ui.warn('No key entered - using the built-in pixel generator.'); return null; }
    }
    const sp = ui.spinner(`Loading models from ${P.label}...`);
    try {
      const models = ai.sortModels(await ai.listModels(provider, key));
      if (!models.length) throw new Error('No models returned.');
      sp.succeed(`${models.length} models available on ${P.label}`);
      if (cfg.keys[provider] !== key && await ui.confirm('Save this key on this computer for next time?')) {
        cfg.keys[provider] = key; cfgStore.save(cfg);
      }
      const tags = { image: color.green('[image]'), chat: color.cyan('[pixel-grid]'), other: color.gray('[n/a]') };
      const items = models.map((m) => ({ label: m.id === m.name ? m.id : `${m.id}`, value: m, tag: tags[m.kind] }));
      while (true) {
        const m = await ui.selectFilter(`Pick a ${P.label} model`, items);
        if (m.kind === 'other') { ui.warn('That model cannot make images or text. Pick another one.'); continue; }
        if (m.kind === 'chat') ui.info('Text model: it will draw the icon as a 16x16 pixel grid.');
        cfg.lastModel = cfg.lastModel || {}; cfg.lastModel[provider] = m.id; cfgStore.save(cfg);
        return { provider, key, model: m.id, kind: m.kind };
      }
    } catch (e) {
      sp.fail(ai.PROVIDERS[provider].label + ': ' + e.message);
      if (!(await ui.confirm('Try a different key?'))) return null;
      key = null;
    }
  }
}

async function makeIcon(name, args, cfg) {
  let conn = null;
  if (!args.noAi) {
    const how = await ui.select(`Create a pixel-art icon for "${name}"`, [
      { label: 'Use an AI service (OpenRouter / Groq / OpenAI)', value: 'ai' },
      { label: 'Built-in pixel generator (no key needed)', value: 'local' },
      { label: 'Snailshell snail icon (default)', value: 'snail' },
    ]);
    if (how === 'snail') return fs.readFileSync(path.join(engine.ENGINE_SRC, 'assets', 'default-icon.png'));
    if (how === 'ai') conn = await connectProvider(cfg);
  }
  if (conn) {
    const sp = ui.spinner(`Asking ${ai.PROVIDERS[conn.provider].label} (${conn.model}) to draw "${name}"...`);
    try {
      const out = await ai.generate({ ...conn, name });
      const buf = out.type === 'image' ? await pixel.pixelate(out.buffer) : await pixel.fromGrid(out);
      sp.succeed('Pixel icon created with AI');
      return buf;
    } catch (e) {
      sp.fail('AI icon failed: ' + e.message);
      ui.info('Using the built-in pixel generator instead.');
    }
  }
  const sp = ui.spinner('Drawing pixel icon...');
  const buf = await pixel.procedural(name);
  sp.succeed('Pixel icon created from the app name');
  return buf;
}

// ---------- keys command ----------
async function keysMenu() {
  const cfg = cfgStore.load(); cfg.keys = cfg.keys || {};
  const provider = await ui.select('Which service?', Object.entries(ai.PROVIDERS).map(([k, p]) => ({ label: p.label, value: k, hint: cfg.keys[k] ? 'key saved' : 'no key' })));
  const action = cfg.keys[provider] ? await ui.select('What do you want to do?', [
    { label: 'Replace the key', value: 'set' }, { label: 'Remove the key', value: 'del' }, { label: 'Cancel', value: 'no' }]) : 'set';
  if (action === 'del') { delete cfg.keys[provider]; cfgStore.save(cfg); ui.ok('Key removed.'); return; }
  if (action === 'no') return;
  delete cfg.keys[provider];
  const conn = await connectProvider(cfg, provider);
  if (conn) ui.ok(`${ai.PROVIDERS[provider].label} connected. Model: ${conn.model}`);
}

// ---------- build ----------
function copyInterface(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, filter: (s) => !SKIP_COPY.has(path.basename(s)) });
}
function uniqueDir(base) {
  let p = base, i = 2;
  while (fs.existsSync(p)) p = `${base}-${i++}`;
  return p;
}
function findArtifacts(distDir, target, exeName) {
  const out = [];
  if (!fs.existsSync(distDir)) return out;
  for (const e of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (target.key === 'windows' && e.isFile() && e.name.endsWith('.exe')) out.push(path.join(distDir, e.name));
    if (target.key === 'linux' && e.isFile() && e.name.endsWith('.AppImage')) out.push(path.join(distDir, e.name));
    if (target.key === 'macos' && e.isDirectory() && e.name.startsWith('mac')) {
      for (const a of fs.readdirSync(path.join(distDir, e.name))) if (a.endsWith('.app')) out.push(path.join(distDir, e.name, a));
    }
  }
  return out;
}
function openFolder(p) {
  const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try { spawn(cmd, [p], { detached: true, stdio: 'ignore' }).unref(); } catch { /* ignore */ }
}

// ---------- main ----------
async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { console.log(HELP); return; }
  if (args.version) { console.log(VERSION); return; }
  if (args._[0] === 'reset') { engine.resetEngine(); ui.ok('Engine removed. It will be downloaded again next time.'); return; }
  if (args._[0] === 'keys') { ui.printLogo(engine.PKG_ROOT, VERSION); await keysMenu(); return; }

  const cfg = cfgStore.load(); cfg.keys = cfg.keys || {};
  ui.printLogo(engine.PKG_ROOT, VERSION);

  // 1. system
  ui.step(1, 5, 'Checking your system');
  const sys = detectSystem();
  ui.ok(`${sys.pretty} ${color.gray('(' + sys.arch + ')')} · Node ${sys.node}`);
  const libs = missingLinuxLibs();
  if (libs.length) ui.warn(`Missing Linux libraries for running Electron apps: ${libs.join(', ')}\n    Install with: sudo apt install ${libs.join(' ')}`);
  await engine.ensureEngine(sys, VERSION);

  // 2. target
  ui.step(2, 5, 'What type of app do you want to create?');
  let target;
  if (args.target) { target = TARGETS[args.target.toLowerCase()]; if (!target) throw new Error('--target must be windows, linux or macos'); }
  else {
    const key = await ui.select('App type', Object.values(TARGETS).map((t) => ({
      label: `${t.label} (${t.ext})`, value: t.key, hint: t.platform === sys.platform ? '← this computer' : 'needs a ' + t.label.replace(' app', '') + ' PC (or GitHub Actions)',
    })), { initial: Object.values(TARGETS).findIndex((t) => t.platform === sys.platform) });
    target = TARGETS[key];
  }
  const native = target.platform === sys.platform;

  // 3. interface
  ui.step(3, 5, 'Set the interface');
  ui.info('Paste the folder that contains your app (index.html, css, js, images...).');
  const { dir: srcDir, starter } = await chooseInterface(args);

  // 4. name + icon
  ui.step(4, 5, 'App name and icon');
  let name = readName(srcDir);
  if (name) ui.ok(`App name from appname.txt: ${color.bold(name)}`);
  else {
    ui.info('No appname.txt in the folder.');
    name = args.name || await ui.ask('App name', { def: guessName(srcDir) });
  }
  name = name.slice(0, 60).trim() || 'shell';
  const exeName = fileSafe(name);

  const outRoot = path.resolve(args.out || cfg.outputDir || path.join(os.homedir(), 'SnailshellApps'));
  const projectDir = uniqueDir(path.join(outRoot, exeName));
  const ifaceDir = path.join(projectDir, 'interface');
  if (path.resolve(outRoot).startsWith(path.resolve(srcDir) + path.sep) || path.resolve(outRoot) === path.resolve(srcDir)) {
    throw new Error('The output folder is inside your interface folder. Use --out to choose another place.');
  }

  // write the project
  const sp1 = ui.spinner('Copying interface files...');
  fs.mkdirSync(projectDir, { recursive: true });
  engine.copyTree(engine.ENGINE_SRC, projectDir);              // engine sources (no node_modules)
  if (starter) copyInterface(STARTER, ifaceDir);
  copyInterface(srcDir, ifaceDir);
  if (starter && fs.existsSync(path.join(srcDir, 'index.html')) === false) { /* starter index already in place */ }
  fs.writeFileSync(path.join(ifaceDir, 'appname.txt'), name + '\n');
  if (!fs.existsSync(path.join(ifaceDir, 'snailshell.json'))) fs.copyFileSync(path.join(STARTER, 'snailshell.json'), path.join(ifaceDir, 'snailshell.json'));
  sp1.succeed(`Interface copied to ${ifaceDir}`);

  const existing = findIcon(ifaceDir);
  if (existing) ui.ok(`Icon found: ${color.bold(path.basename(existing))}`);
  else {
    ui.info('No image found in the folder.');
    const buf = await makeIcon(name, args, cfg);
    fs.writeFileSync(path.join(ifaceDir, 'icon.png'), buf);
    ui.ok(`Saved ${path.join(ifaceDir, 'icon.png')}`);
  }

  // 5. test run or generate
  ui.step(5, 5, 'Test run or generate the app?');
  if (args.noBuild) { ui.ok(`Project prepared (build skipped): ${projectDir}`); return; }
  if (args.mode && !['test', 'build'].includes(String(args.mode).toLowerCase())) throw new Error('--mode must be test or build');

  let mode = args.mode ? String(args.mode).toLowerCase() : null;
  let tested = false;
  while (true) {
    if (!mode) {
      mode = await ui.select('What do you want to do?', [
        { label: tested ? 'Test run again' : 'Test run', value: 'test', hint: 'opens the app now, like "npm start" - nothing is packaged' },
        { label: `Generate the ${target.label} (${exeName}${target.ext})`, value: 'build', hint: native ? 'builds the real app file' : 'prepares the project for ' + target.label.replace(' app', '') },
        { label: 'Exit', value: 'exit' },
      ]);
    }
    if (mode === 'exit') {
      ui.box('Saved', [
        color.gray('Project   ') + projectDir,
        color.gray('Test run  ') + (process.platform === 'win32' ? 'run.bat' : 'run.sh') + '   (inside that folder)',
        color.gray('Generate  ') + (process.platform === 'win32' ? 'build.bat' : 'build.sh'),
      ]);
      return;
    }
    if (mode === 'test') {
      await testRun(ifaceDir, sys);
      tested = true;
      if (args.mode) return;          // non-interactive: one test run, then stop
      mode = null; continue;
    }
    await buildApp({ sys, target, native, projectDir, ifaceDir, exeName });
    return;
  }
}

// ---------- test run: same as "npm start" ----------
async function testRun(ifaceDir, sys) {
  if (!sys.hasDisplay) { ui.warn('No display found (DISPLAY / WAYLAND_DISPLAY is not set), so a window cannot open here.'); return; }
  ui.info('Starting your app (npm start). Close its window - or press Ctrl+C - to come back here.');
  ui.info(`Live reload is on: edit files in ${ifaceDir} and the window refreshes by itself.`);
  console.log('');
  const code = await engine.start(ifaceDir);
  console.log('');
  if (code === 0 || code === null) ui.ok('Test run closed.');
  else ui.warn(`The app exited with code ${code}. Scroll up for the error message.`);
}

// ---------- generate the real app ----------
async function buildApp({ sys, target, native, projectDir, ifaceDir, exeName }) {
  const hostName = sys.host.label.replace(' app', '');
  if (!native) {
    const want = target.label.replace(' app', '');
    ui.box(`${want} apps can't be built on ${hostName}`, [
      `The packager needs ${want}'s own system tools to create ${target.ext}, so each desktop app must be built on its own OS.`,
      '',
      color.bold('Your options'),
      `  • Build the ${hostName} app on this PC (instant)`,
      `  • GitHub Actions: push the project, run the "build" workflow, download the ${want} app`,
      `  • Copy the project to a ${want} computer and run build.${target.key === 'windows' ? 'bat' : 'sh'}`,
    ], 'yellow');
    if (ui.isTTY && await ui.confirm(`Build the ${hostName} app for this computer now instead?`)) {
      target = sys.host; native = true;
    } else {
      ui.info(`Project ready: ${projectDir}`);
      return;
    }
  }

  const stage = path.join(engine.ENGINE_DIR, 'interface');
  fs.rmSync(stage, { recursive: true, force: true });
  copyInterface(ifaceDir, stage);
  ui.ok('Interface staged into the build engine');
  const r = await engine.run('npm', ['run', 'build'], { cwd: engine.ENGINE_DIR, label: `Packaging ${exeName}${target.ext} (first build downloads packaging tools, please wait)` });
  if (r.code !== 0) {
    const sym = /symbolic link|required privilege|SYMLINK_BLOCKED/i.test(r.text);
    const lines = sym && process.platform === 'win32' ? [
      color.bold('Windows blocked a permission the packager needs (symbolic links).'),
      '',
      'Fix (30 seconds, one time):',
      `  1. Open ${color.bold('Settings → System → For developers')}`,
      `  2. Turn on ${color.bold('Developer Mode')}`,
      '  3. Open a new terminal and run snailshell again',
      '',
      `Or just run the terminal ${color.bold('as Administrator')} once.`,
    ] : [
      color.bold('The packaging step failed.'),
      '',
      ...r.tail.filter((l) => /error|failed|cannot|ENOENT|EPERM/i.test(l)).slice(-4).map((l) => l.slice(0, 120)),
    ];
    lines.push('', color.gray('Full log:    ' + engine.LOG_FILE), color.gray('Your project is saved: ' + projectDir));
    ui.box('Build failed', lines, 'red');
    process.exitCode = 1;
    return;
  }
  const distOut = path.join(projectDir, 'dist');
  fs.rmSync(distOut, { recursive: true, force: true });
  fs.cpSync(path.join(engine.ENGINE_DIR, 'dist'), distOut, { recursive: true });
  const arts = findArtifacts(distOut, target, exeName);

  ui.box('Your app is ready', [
    ...arts.map((x) => color.bold(x)),
    '',
    color.gray('Project   ') + projectDir,
    '',
    color.gray('Keep the "interface" folder next to the app. Edit it any time - no rebuild needed.'),
  ], 'green');
  if (ui.isTTY) {
    const act = await ui.select('What next?', [
      { label: 'Open the output folder', value: 'open' }, { label: 'Exit', value: 'exit' }]);
    if (act === 'open') openFolder(path.dirname(arts[0] || distOut));
  }
}

module.exports = { main };
