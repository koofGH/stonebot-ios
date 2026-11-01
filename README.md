# Stonebot v0.4 for iOS (lite)

What's in this build: play Stonebot (15 levels) with live move ratings (brilliant … blunder, book), timed games,
autosave with the "Autosaved" note, "continue your last game", undo / flip / resign, eval bar, captured pieces,
3 themes (Classic, Walnut, Midnight) and 3 piece styles. 
Not in this build (kept small on purpose): Rulecarve, Autoplayer, post-game review, saved-games browser,
position editor, Stonebot vs Stonebot, extra themes/textures. Those can come back in later versions.

## Get the .ipa (you only need a browser, no Mac)
1. Make a free GitHub account, create a **new empty repository** (private is fine).
2. Upload everything in this folder to it (drag the files in on the "uploading an existing file" page;
   keep the `.github` folder - if the web uploader skips it, create the file `.github/workflows/build-ios.yml`
   with "Add file > Create new file" and paste in its contents).
3. Open the repo's **Actions** tab, pick **Build Stonebot IPA**, press **Run workflow**.
4. After ~5 minutes open the finished run and download the **Stonebot-ipa** artifact: a zip holding `Stonebot.ipa`.

## Put it on your iPhone from Windows
- Install **Sideloadly** (sideloadly.io) or **AltStore**, plug in the iPhone, drag in `Stonebot.ipa`, sign in with a
  free Apple ID. The app appears on the home screen (Settings > General > VPN & Device Management > trust yourself).
- Free Apple IDs expire the app after **7 days** - just re-run Sideloadly to refresh it (your saved games stay).
  A paid developer account ($99/yr) lifts that to a year.

## Honest notes
- The Swift shell and the GitHub build could not be run in the environment this was written in (no Mac/Xcode there).
  The game itself (all the JavaScript) was tested in a phone-size browser. If the Actions build fails, copy the red
  error text from the log and send it back - it will be a small fix.
- Stonebot thinks in a background thread; if iOS refuses that, it falls back to thinking on the main thread
  (the screen may freeze for a second or two on high levels).
- The engine runs as JavaScript, which is faster than the PC version, so high levels play a bit stronger here.
- Source for the game is in `src/` (build with `node build.js` -> `www/stonebot.js`).
