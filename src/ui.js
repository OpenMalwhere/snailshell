'use strict';
// Tiny zero-dependency terminal UI: colors, prompts, arrow-key menus, filter list, spinner.
const fs = require('fs');
const path = require('path');

const isTTY = !!(process.stdin.isTTY && process.stdout.isTTY);
const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const color = {
  bold: wrap('1'), dim: wrap('2'), red: wrap('31'), green: wrap('32'), yellow: wrap('33'),
  cyan: wrap('36'), gray: wrap('90'),
  accent: (s) => (useColor ? `\x1b[38;5;39m${s}\x1b[0m` : String(s)),
};

// ---------- non-interactive input (piped stdin / scripts) ----------
let queue = null;
function nextLine() {
  if (!queue) { try { queue = fs.readFileSync(0, 'utf8').split(/\r?\n/); } catch { queue = []; } }
  return queue.length ? queue.shift() : null;
}

function hideCursor() { if (isTTY) process.stdout.write('\x1b[?25l'); }
function showCursor() { if (isTTY) process.stdout.write('\x1b[?25h'); }

function withRaw(handler) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const done = (v) => { stdin.removeListener('data', onData); stdin.setRawMode(false); stdin.pause(); resolve(v); };
    const onData = (chunk) => {
      if (chunk === '\x03') { showCursor(); stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
      handler(chunk, done);
    };
    stdin.on('data', onData);
  });
}

const termWidth = () => Math.max(40, (process.stdout.columns || 80));
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// ---------- text prompt ----------
async function ask(question, { def = '', secret = false } = {}) {
  const prompt = `${color.accent('?')} ${color.bold(question)}${def ? color.gray(` (${def})`) : ''} ${color.accent('›')} `;
  if (!isTTY) {
    process.stdout.write(prompt);
    const l = nextLine();
    process.stdout.write('\n');
    if (l === null) return def;
    return l.trim() || def;
  }
  process.stdout.write(prompt);
  let buf = '';
  const result = await withRaw((chunk, done) => {
    if (chunk.startsWith('\x1b')) return; // arrows etc.
    for (const ch of Array.from(chunk)) {
      if (ch === '\r' || ch === '\n') { process.stdout.write('\n'); return done(buf); }
      if (ch === '\x7f' || ch === '\b') {
        if (buf.length) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); }
      } else if (ch >= ' ') {
        buf += ch; process.stdout.write(secret ? '•' : ch);
      }
    }
  });
  return result.trim() || def;
}

// ---------- single-choice menu ----------
async function select(title, options, { initial = 0 } = {}) {
  if (!isTTY) {
    console.log(`${color.accent('?')} ${color.bold(title)}`);
    options.forEach((o, i) => console.log(`   ${i + 1}) ${o.label}${o.hint ? '  - ' + o.hint : ''}`));
    const l = nextLine();
    const n = parseInt((l || '').trim(), 10);
    const pick = options[(n >= 1 && n <= options.length ? n : initial + 1) - 1];
    console.log(`${color.green('✔')} ${title} › ${pick.label}`);
    return pick.value;
  }
  let idx = initial, drawn = 0;
  const render = () => {
    if (drawn) process.stdout.write(`\x1b[${drawn}A\x1b[J`);
    const lines = [`${color.accent('?')} ${color.bold(title)} ${color.gray('(↑/↓ then Enter)')}`];
    options.forEach((o, i) => {
      const hint = o.hint ? color.gray('  ' + o.hint) : '';
      lines.push(i === idx ? `  ${color.accent('❯ ' + o.label)}${hint}` : `    ${o.label}${hint}`);
    });
    process.stdout.write(lines.join('\n') + '\n');
    drawn = lines.length;
  };
  hideCursor(); render();
  const chosen = await withRaw((chunk, done) => {
    if (chunk === '\x1b[A' || chunk === 'k') idx = (idx - 1 + options.length) % options.length;
    else if (chunk === '\x1b[B' || chunk === 'j') idx = (idx + 1) % options.length;
    else if (chunk === '\r' || chunk === '\n') return done(idx);
    else if (/^[1-9]$/.test(chunk) && +chunk <= options.length) idx = +chunk - 1;
    render();
  });
  process.stdout.write(`\x1b[${drawn}A\x1b[J`); showCursor();
  console.log(`${color.green('✔')} ${color.bold(title)} ${color.accent('›')} ${options[chosen].label}`);
  return options[chosen].value;
}

async function confirm(question, def = true) {
  return select(question, [{ label: 'Yes', value: true }, { label: 'No', value: false }], { initial: def ? 0 : 1 });
}

// ---------- big searchable list (model picker) ----------
async function selectFilter(title, items, { pageSize = 12 } = {}) {
  // items: [{ label, value, tag }]
  if (!isTTY) {
    console.log(`${color.accent('?')} ${color.bold(title)} (${items.length} items)`);
    items.slice(0, 40).forEach((o, i) => console.log(`   ${i + 1}) ${o.label} ${o.tag || ''}`));
    const l = (nextLine() || '').trim();
    const n = parseInt(l, 10);
    const pick = (n >= 1 && n <= items.length) ? items[n - 1] : (items.find((i) => i.label === l || i.value === l) || items[0]);
    console.log(`${color.green('✔')} ${title} › ${pick.label}`);
    return pick.value;
  }
  let filter = '', idx = 0, top = 0, drawn = 0;
  const filtered = () => {
    const f = filter.toLowerCase();
    return f ? items.filter((i) => i.label.toLowerCase().includes(f)) : items;
  };
  const render = () => {
    const list = filtered();
    if (idx >= list.length) idx = Math.max(0, list.length - 1);
    if (idx < top) top = idx;
    if (idx >= top + pageSize) top = idx - pageSize + 1;
    if (drawn) process.stdout.write(`\x1b[${drawn}A\x1b[J`);
    const w = termWidth() - 6;
    const lines = [
      `${color.accent('?')} ${color.bold(title)} ${color.gray(`(${list.length}/${items.length})`)}`,
      `  ${color.gray('type to search · ↑/↓ move · PgUp/PgDn jump · Enter select')}`,
      `  ${color.accent('search ›')} ${filter}${color.gray(filter ? '' : ' (start typing)')}`,
    ];
    list.slice(top, top + pageSize).forEach((o, i) => {
      const real = top + i;
      const text = clip(o.label, w - (o.tag ? strip(o.tag).length + 2 : 0));
      const tag = o.tag ? '  ' + o.tag : '';
      lines.push(real === idx ? `  ${color.accent('❯ ' + text)}${tag}` : `    ${text}${tag}`);
    });
    if (!list.length) lines.push(color.gray('    no matches'));
    process.stdout.write(lines.join('\n') + '\n');
    drawn = lines.length;
  };
  hideCursor(); render();
  const chosen = await withRaw((chunk, done) => {
    const list = filtered();
    if (chunk === '\x1b[A') idx = Math.max(0, idx - 1);
    else if (chunk === '\x1b[B') idx = Math.min(list.length - 1, idx + 1);
    else if (chunk === '\x1b[5~') idx = Math.max(0, idx - pageSize);
    else if (chunk === '\x1b[6~') idx = Math.min(list.length - 1, idx + pageSize);
    else if (chunk === '\r' || chunk === '\n') { if (list.length) return done(list[idx]); }
    else if (chunk === '\x7f' || chunk === '\b') { filter = filter.slice(0, -1); idx = 0; top = 0; }
    else if (chunk === '\x1b') { filter = ''; idx = 0; top = 0; }
    else if (!chunk.startsWith('\x1b') && chunk >= ' ') { filter += chunk.replace(/[\r\n]/g, ''); idx = 0; top = 0; }
    render();
  });
  process.stdout.write(`\x1b[${drawn}A\x1b[J`); showCursor();
  console.log(`${color.green('✔')} ${color.bold(title)} ${color.accent('›')} ${chosen.label}`);
  return chosen.value;
}

// ---------- spinner (with elapsed time) ----------
function spinner(text) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0, cur = text, timer = null;
  const t0 = Date.now();
  const secs = () => { const s = Math.floor((Date.now() - t0) / 1000); return s >= 3 ? color.gray(` ${s}s`) : ''; };
  const draw = () => process.stdout.write(`\r\x1b[2K${color.accent(frames[i++ % frames.length])} ${clip(cur, termWidth() - 10)}${secs()}`);
  if (isTTY) { hideCursor(); timer = setInterval(draw, 80); draw(); } else console.log(`… ${text}`);
  const end = (sym, t) => {
    if (timer) clearInterval(timer);
    if (isTTY) { process.stdout.write('\r\x1b[2K'); showCursor(); }
    console.log(`${sym} ${t || cur}${secs()}`);
  };
  return {
    update(t) { cur = t; },
    succeed(t) { end(color.green('✔'), t); },
    fail(t) { end(color.red('✖'), t); },
    warn(t) { end(color.yellow('!'), t); },
  };
}


// ---------- gradient colors (matched to the Snailshell logo: electric blue -> cyan -> ice white) ----------
const TRUECOLOR = /truecolor|24bit/i.test(process.env.COLORTERM || '') || !!process.env.WT_SESSION || process.env.TERM_PROGRAM === 'vscode' || process.env.TERM_PROGRAM === 'iTerm.app';
const PALETTE = [[11, 145, 255], [40, 185, 255], [110, 220, 255], [234, 245, 255], [110, 220, 255], [60, 120, 255], [95, 90, 240], [60, 120, 255], [11, 145, 255]];
const P256 = [27, 33, 39, 45, 81, 117, 153, 195, 153, 117, 81, 45, 39, 33];
function gradRGB(t) {                                   // t: any number, wraps 0..1
  t = ((t % 1) + 1) % 1;
  const f = t * (PALETTE.length - 1), i = Math.floor(f), k = f - i, a = PALETTE[i], b = PALETTE[Math.min(i + 1, PALETTE.length - 1)];
  return [0, 1, 2].map((n) => Math.round(a[n] + (b[n] - a[n]) * k));
}
function cch(ch, t, dim = 0) {                          // one colored character; dim 0..1 fades toward the background
  if (!useColor) return ch;
  if (TRUECOLOR) {
    const [r, g, b] = gradRGB(t).map((v) => Math.round(v * (1 - dim) + 40 * dim));
    return `\x1b[38;2;${r};${g};${b}m${ch}\x1b[0m`;
  }
  return `\x1b[38;5;${dim > 0.55 ? 244 : P256[Math.floor((((t % 1) + 1) % 1) * P256.length)]}m${ch}\x1b[0m`;
}
function gradText(text, offset = 0, dim = 0, spread = 0.03) {
  return Array.from(String(text)).map((ch, i) => (ch === ' ' ? ch : cch(ch, offset + i * spread, dim))).join('');
}

// ---------- live build panel: flowing gradient bar + the last lines of output, lolcat style ----------
const PHASES = [
  [/download|fetch|http/i, 'Downloading tools'],
  [/npm|install|added/i, 'Installing packages'],
  [/packaging|platform=/i, 'Packaging the app'],
  [/nsis|portable|appimage|target=/i, 'Building the executable'],
  [/icon|rcedit|sign/i, 'Applying icon'],
  [/7z|extract|unpack/i, 'Unpacking'],
];
function live(label, { rows = 4 } = {}) {
  if (!isTTY || !useColor) {
    const sp = spinner(label);
    return { push() {}, update() {}, succeed: sp.succeed, fail: sp.fail };
  }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const t0 = Date.now(); const buf = []; let phase = 'Starting', f = 0, drawn = 0, cur = label;
  const clean = (l) => strip(String(l)).replace(/[\x00-\x08\x0b-\x1f]/g, '').replace(/^[\s•›>*-]+/, '').trim();
  const bar = (w) => {
    const pos = (f * 0.7) % (w + 10) - 5;
    let out = '';
    for (let i = 0; i < w; i++) {
      const lit = Math.max(0, 1 - Math.abs(i - pos) / 5);
      out += cch(lit > 0.15 ? '▰' : '▱', i / w * 0.8 - f * 0.012, lit > 0.15 ? 0 : 0.55);
    }
    return out;
  };
  const draw = () => {
    const W = Math.min(termWidth() - 4, 90), secs = Math.floor((Date.now() - t0) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
    const out = [];
    out.push(`${cch(frames[f % frames.length], f * 0.02)} ${color.bold(gradText(clip(cur, W - 20), f * 0.012))}  ${color.gray(mm)}`);
    out.push(`  ${bar(Math.min(36, W - 6))}  ${color.gray(phase)}`);
    const shown = buf.slice(-rows);
    for (let i = 0; i < rows; i++) {
      const line = shown[i - (rows - shown.length)];
      const age = rows - 1 - i;
      out.push(line === undefined ? '' : `  ${color.gray('│')} ${gradText(clip(line, W - 6), f * 0.015 + i * 0.07, Math.min(0.7, age * 0.2), 0.025)}`);
    }
    if (drawn) process.stdout.write(`\x1b[${drawn}A`);
    process.stdout.write(out.map((l) => '\x1b[2K' + l).join('\n') + '\n');
    drawn = out.length; f++;
  };
  hideCursor(); draw();
  const timer = setInterval(draw, 70);
  const end = (sym, t) => {
    clearInterval(timer);
    if (drawn) process.stdout.write(`\x1b[${drawn}A\x1b[J`);
    showCursor();
    const secs = Math.floor((Date.now() - t0) / 1000);
    console.log(`${sym} ${t || cur}${secs >= 3 ? color.gray(' ' + secs + 's') : ''}`);
  };
  return {
    push(raw) {
      for (const l of String(raw).split(/\r?\n/)) {
        const c = clean(l); if (!c) continue;
        buf.push(c); if (buf.length > 50) buf.shift();
        for (const [re, name] of PHASES) if (re.test(c)) { phase = name; break; }
      }
    },
    update(t) { cur = t; },
    succeed(t) { end(color.green('✔'), t); },
    fail(t) { end(color.red('✖'), t); },
  };
}

// ---------- boxed panels ----------
function box(title, lines, tone = 'accent') {
  const paint = tone === 'red' ? color.red : tone === 'green' ? color.green : tone === 'yellow' ? color.yellow : color.accent;
  const w = Math.min(termWidth() - 2, 78);
  const inner = w - 4;
  const wrapLine = (l) => {
    const out = []; let rest = String(l);
    if (!strip(rest).length) return [''];
    while (strip(rest).length > inner) {
      let cut = rest.lastIndexOf(' ', inner); if (cut < inner * 0.4) cut = inner;
      out.push(rest.slice(0, cut)); rest = rest.slice(cut).trimStart();
    }
    out.push(rest); return out;
  };
  const pad = (l) => l + ' '.repeat(Math.max(0, inner - strip(l).length));
  const head = ` ${title} `;
  console.log('');
  console.log(paint('╭─') + paint(color.bold(head)) + paint('─'.repeat(Math.max(1, w - 3 - head.length)) + '╮'));
  for (const l of lines.flatMap(wrapLine)) console.log(paint('│ ') + pad(l) + paint(' │'));
  console.log(paint('╰' + '─'.repeat(w - 2) + '╯'));
}

// ---------- logo / banner ----------
const BRAND = { name: 'OpenMalwhere', url: 'https://github.com/OpenMalwhere' };
const link = (url, text) => (useColor ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : text);   // clickable in Windows Terminal / VS Code / iTerm

function printLogo(pkgRoot, version) {
  const assets = path.join(pkgRoot, 'assets');
  const cols = process.stdout.columns || 80;
  const has256 = /256/.test(process.env.TERM || '') || TRUECOLOR;
  const credit = [
    color.gray('powered by'),
    color.bold(link(BRAND.url, gradText(BRAND.name, 0.05, 0, 0.06))),
    color.gray(link(BRAND.url, 'github.com/' + BRAND.name)),
  ];
  let sideDone = false;
  console.log('');
  if (useColor && cols >= 70) {
    const file = path.join(assets, TRUECOLOR ? 'logo.truecolor.ansi' : (has256 ? 'logo.256.ansi' : null) || 'logo.256.ansi');
    try {
      const lines = fs.readFileSync(file, 'utf8').replace(/\s+$/, '').split(/\r?\n/);
      const width = Math.max(...lines.map((l) => strip(l).length));
      if (cols >= width + 4 + 24) {                       // wide terminal: put the credit beside the logo
        const at = lines.length - 6;                      // lower right, next to the snail's body
        const out = lines.map((l, i) => {
          const c = credit[i - at];
          return c ? l + '\x1b[0m' + ' '.repeat(width - strip(l).length + 4) + c : l;
        });
        process.stdout.write(out.join('\n') + '\n');
        sideDone = true;
      } else process.stdout.write(lines.join('\n') + '\n');
    } catch { /* ignore */ }
  } else {
    console.log(color.accent('   __     ___        ____   ____  ____'));
    console.log(color.accent('  (  )___/ >_|      (    \\ / __ \\(  _ \\'));
    console.log(color.accent('   \\_______/  snail  ) _  ) _ _ ))   /'));
  }
  console.log('');
  console.log(`  ${color.bold(gradText('S N A I L S H E L L', 0, 0, 0.045))}  ${color.gray('v' + version)}`);
  console.log(`  ${color.gray('Turn any interface folder into a real desktop app.')}`);
  if (!sideDone) console.log(`  ${color.gray('powered by')} ${color.bold(link(BRAND.url, gradText(BRAND.name, 0.05, 0, 0.06)))}  ${color.gray('· ' + link(BRAND.url, 'github.com/' + BRAND.name))}`);
  console.log('');
}

const step = (n, total, text) => {
  const bar = Array.from({ length: total }, (_, i) => (i < n ? color.accent('●') : color.gray('○'))).join(' ');
  const rule = color.gray('─'.repeat(Math.max(4, Math.min(termWidth() - 2, 78) - 4 - total * 2 - String(text).length)));
  console.log(`\n${bar}  ${color.bold(text)} ${rule}`);
};
const ok = (t) => console.log(`${color.green('✔')} ${t}`);
const warn = (t) => console.log(`${color.yellow('!')} ${t}`);
const info = (t) => console.log(`  ${color.gray(t)}`);
const fail = (t) => console.log(`${color.red('✖')} ${t}`);

module.exports = { isTTY, color, live, gradText, ask, select, confirm, selectFilter, spinner, box, printLogo, step, ok, warn, info, fail, showCursor, hideCursor };
