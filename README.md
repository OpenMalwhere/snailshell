# 🐌 Snailshell CLI

*Powered by [OpenMalwhere](https://github.com/OpenMalwhere)*

Build a real desktop app (Windows `.exe`, Linux `.AppImage`, macOS `.app`) from any folder of HTML/CSS/JS, right from your terminal.

## Install
```bash
npm install -g github:OpenMalwhere/snailshell # direct install (windows os)
sudo npm install -g github:OpenMalwhere/snailshell # direct install (linux os)

            [or]
            
npm install -g .          # inside this folder  → command: snailshell
npx .                     # or run without installing
# after you publish to npm:  npx snailshell
```
Needs Node.js 18+.

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
