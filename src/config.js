'use strict';
const fs = require('fs');
const path = require('path');
const { HOME_DIR } = require('./system');
const FILE = path.join(HOME_DIR, 'config.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { keys: {} }; }
}
function save(cfg) {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch { /* windows */ }
}
module.exports = { load, save, FILE };
