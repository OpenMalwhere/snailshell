// Snailshell - reads app name + icon from the interface folder (used by main.js and the build script)
const fs = require('fs');
const path = require('path');

const DEFAULT_NAME = 'shell';
const DEFAULT_ICON = path.join(__dirname, 'assets', 'default-icon.png');
const IMG_EXT = ['.png', '.ico', '.jpg', '.jpeg', '.bmp'];

// interface/appname.txt -> app name (first line). Missing/empty -> "shell"
function readAppName(dir) {
  try {
    const t = fs.readFileSync(path.join(dir, 'appname.txt'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)[0].trim();
    return t || DEFAULT_NAME;
  } catch { return DEFAULT_NAME; }
}

// make the name safe to use as a file name (Name.exe)
function fileSafe(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim() || DEFAULT_NAME;
}

// interface/icon.png (or icon.ico/jpg/jpeg/bmp), otherwise the first image in the interface root.
// Returns null when there is none (then the default Snailshell icon is used).
function findIcon(dir) {
  try {
    for (const ext of IMG_EXT) {
      const p = path.join(dir, 'icon' + ext);
      if (fs.existsSync(p)) return p;
    }
    const first = fs.readdirSync(dir)
      .filter(f => IMG_EXT.includes(path.extname(f).toLowerCase()) && fs.statSync(path.join(dir, f)).isFile())
      .sort()[0];
    return first ? path.join(dir, first) : null;
  } catch { return null; }
}

module.exports = { readAppName, fileSafe, findIcon, DEFAULT_NAME, DEFAULT_ICON };
