# 🐌 Snailshell CLI

*Powered by [OpenMalwhere](https://github.com/OpenMalwhere)*

Build a real desktop app (Windows `.exe`, Linux `.AppImage`, macOS `.app`) from any folder of HTML/CSS/JS, right from your terminal.

## Quick start (one line)

**Windows (PowerShell / CMD), macOS, Linux - no install:**
```bash
npx github:OpenMalwhere/snailshell
```

**Install once, then use the `snailshell` command anywhere:**
```bash
# Windows / macOS
npm install -g github:OpenMalwhere/snailshell

# Linux (global install needs sudo on most distros)
sudo npm install -g github:OpenMalwhere/snailshell
```
Then just run:
```bash
snailshell
```

**Linux with sudo (only if you really want it):**
```bash
sudo npx github:OpenMalwhere/snailshell
```
> Prefer the commands above without `sudo npx`. Running the wizard as root saves your apps in `/root/SnailshellApps`
> and the engine in `/root/.snailshell` (owned by root), so your normal user can't edit them later.
> Use `sudo` only for the global install line.

**From a downloaded copy of this folder:**
```bash
npm install -g .      # inside this folder  → command: snailshell
npx .                 # or run without installing
```
Update to the newest version any time: run the same install line again. Needs Node.js 18+.

## What it does
1. **Checks your OS** and, on first run, downloads the matching Electron + build tools into `~/.snailshell/engine`.
2. **Asks the app type**: Windows / Linux / macOS.
3. **Set interface**: paste a folder path. Everything inside is copied into the new app.
4. **App name + icon**: if the folder has no `appname.txt` it asks for the name; if it has no image it creates a **pixel-art icon** from the name.
   - Built-in generator: no key needed.
   - AI: OpenRouter, Groq or OpenAI key → lists every model on your account (type to search) → you pick one.
     Image models draw the icon; text models draw a 16×16 pixel grid. Groq has no image models, so it uses the grid route.
5. **Test run or Generate app** (you choose):
   - **Test run** = same as `npm start`: opens your app in a window right now, nothing is packaged. Edits to the interface refresh live. Close the window to come back to the menu.
   - **Generate app** = builds the real `.exe` / `.AppImage` / `.app`. Output: `~/SnailshellApps/<AppName>/` (`dist/` has the app).

## Commands
```
snailshell                guided wizard
snailshell keys           add / replace / remove AI keys
snailshell reset          delete the downloaded engine
snailshell --target linux --path ./ui --name MyApp --no-ai   (skip questions)
snailshell --mode test                                      (open the app straight away, like npm start)
snailshell --mode build                                     (generate the app straight away)
```
Keys are saved in `~/.snailshell/config.json` (owner-only permissions) only if you say yes.

## Important
Desktop apps must be built **on their own OS**. If you pick another OS than the one you are on, Snailshell prepares the project and a GitHub Actions workflow (`.github/workflows/build.yml`) that builds all three.

## Windows: "Cannot create symbolic link" error
Windows blocks symlinks unless Developer Mode or Administrator is on. Snailshell now repairs this automatically
(it unpacks electron-builder's signing tools without the macOS-only links and retries). If it still fails, turn on
Developer Mode (Settings → System → For developers) or run the terminal as Administrator.

## Building for another OS
| You are on | Windows app | Linux app | macOS app |
|---|---|---|---|
| Windows | ✅ native | 🐳 Docker | GitHub Actions / a Mac |
| Linux | ✅ cross-build (.exe + .zip, no Wine) | ✅ native | GitHub Actions / a Mac |
| macOS | ✅ cross-build | 🐳 Docker | ✅ native |

- **Windows from Linux/macOS** works out of the box. On x64 you get a single portable `.exe` plus a `.zip`; on ARM (e.g. Kali arm64) you get the `.zip` (unzip it on Windows and run the `.exe` inside).
- **Linux from Windows/macOS** uses Docker if it is installed (`electronuserland/builder` image).
- **macOS** apps need a Mac (or the included GitHub Actions workflow).

## Colors look different over SSH / on Linux?
Snailshell uses the full-color (24-bit) logo when the terminal supports it. Over SSH the terminal often does not say so.
Force it with:
```bash
SNAILSHELL_COLOR=truecolor snailshell     # full-color logo
SNAILSHELL_COLOR=256 snailshell           # for older terminals
```
(PowerShell: `$env:SNAILSHELL_COLOR="truecolor"; snailshell`)
