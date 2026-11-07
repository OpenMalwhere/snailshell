# 🐌 Snailshell

A system application you can run as an `.exe`. The **interface** is whatever you put in the
`interface/` folder — HTML, CSS, JS, images, anything. Edit the files and Snailshell reloads live.

```
Snailshell/
├─ interface/            <- your UI lives here (index.html is the entry)
│   ├─ index.html
│   ├─ icon.png          <- becomes the .exe icon (optional)
│   ├─ appname.txt       <- becomes the app name / exe name (optional)
│   └─ snailshell.json   <- window settings (size, frameless, entry...)
├─ main.js  preload.js  shellinfo.js   <- the system core
├─ assets/default-icon.png             <- used when there is no icon
├─ run.bat / run.sh      <- run it (Windows / Linux+Mac)
└─ build.bat / build.sh  <- build the app (Windows / Linux+Mac)
```

## App name and icon
- **appname.txt** — the text inside is the app name. It is the window title and the exe name
  (`Snailshell` -> `Snailshell.exe`). No file / empty file -> **`shell.exe`**.
- **icon.png** — becomes the .exe icon (also accepts `icon.ico`, `icon.jpg`, `icon.bmp`).
  If there is no `icon.*`, the first image in the interface root is used. If there are no images
  at all -> a small transparent PNG with dots. Use a square image, 256x256 or bigger is best.
- Both are applied when you run `build.bat`. While developing (`run.bat`) the window shows the
  name and icon immediately, and they update live when you change the files.

## Run (development) - Windows, Linux, macOS
Needs Node.js 18+.
- Windows: double-click `run.bat`
- Linux / macOS: `bash run.sh`
- or on any system: `npm install` then `npm start`

## Build
Run the build **on the system you want to build for** (Windows -> .exe, Linux -> AppImage, Mac -> .app):
- Windows: `build.bat`  -> `dist/<name>.exe` (portable) + `dist/win-unpacked/`
- Linux:   `bash build.sh` -> `dist/<name>.AppImage` + `dist/linux-unpacked/`
- macOS:   `bash build.sh` -> `dist/mac*/<name>.app` (unsigned: right-click -> Open the first time)

In every case keep the **interface** folder next to the app (next to the .exe / .AppImage / .app).
`dist/interface` is already copied for you. The app always loads that folder, so you can edit
the interface without rebuilding. (Name and icon only change when you rebuild.)
No Mac/Linux machine? Push the project to GitHub and run the included workflow
(Actions -> build -> Run workflow) - it builds all three for you.

## node_modules
`node_modules` is **different on each OS** (Electron downloads a platform-specific binary), so never
copy it between Windows / Linux / Mac. Share the project **without** `node_modules` and run
`npm install` on each system.

Windows build fails with "symbolic link" / "winCodeSign"? Turn on Developer Mode or run as Administrator.

## snailshell.json
| key | default | meaning |
|---|---|---|
| width / height | 1100 / 720 | window size |
| frameless | false | remove the title bar (use `-webkit-app-region: drag` + `snailshell.window.*`) |
| entry | index.html | start page |
| alwaysOnTop | false | keep on top |
| hideMenu | true | hide the menu bar |
| devtools | false | open DevTools on start |

## System API (`window.snailshell`)
```js
await snailshell.system.info()                 // user, host, cpu, memory, appName, paths
await snailshell.system.exec('dir', {cwd})     // -> {ok, code, stdout, stderr}
await snailshell.fs.read(path) / write(path, data) / list(dir) / exists(path) / remove(path)
await snailshell.dialog.open({properties:['openFile']}) / save() / message()
await snailshell.shell.openExternal(url) / openPath(p) / showInFolder(p)
await snailshell.clipboard.read() / write(text)
await snailshell.window.minimize() / maximize() / close() / setTitle() / fullscreen(bool) / alwaysOnTop(bool)
await snailshell.app.reload() / devtools() / quit()
```

⚠️ The interface has full access to run commands and read/write files. Only run interface
code you trust.
