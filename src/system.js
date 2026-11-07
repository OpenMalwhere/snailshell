'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TARGETS = {
  windows: { key: 'windows', label: 'Windows app', ext: '.exe', platform: 'win32' },
  linux:   { key: 'linux',   label: 'Linux app',   ext: '.AppImage', platform: 'linux' },
  macos:   { key: 'macos',   label: 'macOS app',   ext: '.app', platform: 'darwin' },
};

function detectSystem() {
  const platform = process.platform;
  const host = Object.values(TARGETS).find((t) => t.platform === platform);
  if (!host) throw new Error(`Unsupported OS "${platform}". Snailshell supports Windows, Linux and macOS.`);
  let pretty = host.label.replace(' app', '');
  if (platform === 'win32') {
    const build = parseInt((os.release().split('.')[2] || '0'), 10);
    pretty = build >= 22000 ? 'Windows 11' : 'Windows 10 or older';
  } else if (platform === 'linux') {
    try {
      const m = fs.readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]+)"?/m);
      if (m) pretty = m[1];
    } catch { /* ignore */ }
  } else if (platform === 'darwin') {
    pretty = 'macOS ' + os.release();
  }
  const hasDisplay = platform !== 'linux' || !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  return { platform, host, pretty, arch: os.arch(), node: process.versions.node, hasDisplay };
}

// Linux only: Electron needs a few system libraries. We can't install them without sudo, so we just check + tell the user.
function missingLinuxLibs() {
  if (process.platform !== 'linux') return [];
  let list = '';
  try { list = execSync('ldconfig -p', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return []; }
  const need = { 'libgtk-3.so.0': 'libgtk-3-0', 'libnss3.so': 'libnss3', 'libasound.so.2': 'libasound2' };
  return Object.entries(need).filter(([so]) => !list.includes(so)).map(([, pkg]) => pkg);
}

const HOME_DIR = path.join(os.homedir(), '.snailshell');
module.exports = { TARGETS, detectSystem, missingLinuxLibs, HOME_DIR };
