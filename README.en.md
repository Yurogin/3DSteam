*[Français](README.md) · **English***

# 3DSteam

A very light Steam launcher (Tauri v2 + React) in the spirit of handheld console menus: a grid of
icons that extends to the right (empty slots allowed, free cursor, every game dropped wherever you
like), game folders (your own name and colour), a banner for the selected game (details on the left,
square cover in the middle), "pop" sound effects synthesised on the fly, colour themes, and mouse,
keyboard and controller navigation.

## Requirements (Windows)

```powershell
winget install Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive"
```

WebView2 already ships with Windows 11. Node ≥ 20.19.

## Running it

```powershell
npm install
npm run tauri dev      # dev window with hot reload
npm run tauri build    # NSIS installer in src-tauri/target/release/bundle/
npm run dev            # front end alone in the browser, with demo games
```

VDF parser tests: `cd src-tauri; cargo test`. Scan your real library: `cargo test -- --ignored --nocapture`.

> On Windows, build from PowerShell rather than Git Bash: Git Bash's `link` shadows the MSVC one.

## How it works

At startup, `load_cache` reads `games_cache.json` (in `%APPDATA%\com.threedsteam.launcher\`) and the
grid appears immediately. `scan_library` then runs on its own thread: it locates Steam (registry,
then the default paths), reads `libraryfolders.vdf`, parses every `appmanifest_*.acf`, and rewrites
the cache atomically.

Each slot shows the game's square icon, the one from the Steam library list: the client's `.ico`
(`steam/games/<hash>.ico`) when it exists, otherwise the small cached icon. The hash comes from
`common/clienticon`, read out of the binary `appcache/appinfo.vdf` cache by `appinfo.rs`. The banner
at the top is the Steam header image (460×215).

An `.ico` is a directory: it often holds eight or ten images, from 16 to 512 px, and it is then the
browser's decoder that picks which one to show. Rather than depend on that choice, `icons.rs` reads
the directory during the scan (decoding nothing, hence needing no dependency) and writes a file
holding only the largest image into `%APPDATA%\com.threedsteam.launcher\icons\`, copying its bytes
verbatim. It records each icon's real size along the way (`iconSize`) — a PNG's is read from its
IHDR, since the directory caps out at 256 px.

**Non-Steam games.** Games added to Steam ("Add a Non-Steam Game") show up in the grid like any
other. `shortcuts.rs` reads `userdata/<account>/config/shortcuts.vdf`, a binary VDF (name,
executable, folder, icon, hidden or not, last played). Their artwork is whatever was picked for them
in Steam (`config/grid/<id>p.png`, `_hero`, `_logo`…); without a chosen icon, `icons.rs` extracts
the executable's own (`RT_GROUP_ICON` and `RT_ICON` resources; the file is loaded as plain data,
nothing runs). They start through `steam://rungameid/<64-bit id>`, so always through Steam, with
its overlay, and the black launch screen waits for their window as it does for a Steam game. No
store or uninstall in their menu: Steam knows no page, size or playtime for them.

Plenty of Steam icons are no larger than 32 px, for slots five times that. There is no one right way
to handle this, hence a setting (⚙ → Appearance → Icons): see below.

The toolbar toggles between **Installed** and **All**. "All" adds the games the client knows about
without them being on disk: `appinfo.vdf` gives their name and type,
`userdata/<account>/config/localconfig.vdf` says which ones this account has already seen, and the
account used is the most recent one in `loginusers.vdf`. This is not an ownership list — it holds
demos and free games that were tried, and it misses owned games never launched — but it is local,
instant, and needs no API key. On the test library: 72 installed and 306 more.

That view is flat, like search: it leaves the board alone, allows neither folders nor drag and drop,
and closes with Esc / ⓑ. Games that are not installed appear dimmed, their artwork comes from the
CDN, and they cannot be launched.

Cover art comes from Steam's local cache (`appcache/librarycache`, served over `asset://`; only that
folder, `steam/games` and the derived icons are allowed). When an image is missing the Steam CDN
takes over, and as a last resort a coloured tile with the game's initials.

Launching goes through `steam://run/<appid>`: Steam handles updates, cloud saves and DRM.

Installing goes through `steam://install/<appid>`, which opens Steam's own dialog. There is no way
to start a download without it: the client holds the licences. And that dialog answers no key (no
Tab, no Enter, no focus ring) while exposing nothing to UI Automation either: three descendants,
zero buttons. A click is the only thing that confirms it.

Confirming it on the user's behalf would be a bad idea: in front of a licence agreement, that
means accepting it for them. So the problem is turned around. While a Steam window is open, **the
controller and the keyboard drive the cursor** (`padmouse.rs`, on by default): left stick or arrow
keys move it, right stick or Page Up/Page Down scroll -- an agreement has to be read through before
its button becomes active --, a trigger or Shift slows it down to aim at a checkbox, A or Enter
clicks. Arrow keys start slow, then speed up.

The window is brought to the front if the user is still in 3DSteam, and the cursor is moved to its
centre, and nowhere else: the choice stays entirely the user's. The Enter or A that requested the
install does not click if it is still held when the window opens.

Steam thus becomes usable with a pad or a keyboard without Big Picture, whatever window it opens
and whatever its layout. The controller is read through XInput and the keyboard through
`GetAsyncKeyState` rather than by the page, which receives nothing once it loses focus. Driving
stops when the window closes, if the user goes elsewhere, or after five minutes; 3DSteam then takes
focus back.

Uninstalling likewise goes through `steam://uninstall/<appid>`: Steam asks for confirmation in its
own dialog, driven the same way, and the game leaves the grid, keeping its slot empty.

**Managing a game**: Ⓐ / Enter on an installed game starts it; on any other game the action menu
opens instead of acting. Installing starts a download of several gigabytes, which should not fire
on a key pressed by mistake — and this is how Pause and Cancel are reached without a mouse. The
menu also opens with a right-click on a slot, the Menu key or `O` on the keyboard, Ⓨ on the
controller. Depending on the game, the menu offers: Start or Install, Pause or Resume, Cancel,
Steam downloads, Browse files, Store page, Move out of folder, Uninstall. On a folder: Open, Edit,
Delete; on an empty slot of the main board: New folder. Arrows or the D-pad move through it,
Ⓐ / Enter confirms, Ⓑ / Esc closes it.

**Pausing, resuming and cancelling** (`steamctl.rs`). Steam offers no `steam://` command for this:
its own interface internally calls `SteamClient.Downloads.PauseAppUpdate`, `ResumeAppUpdate` or
`RemoveFromDownloadList` in its shared JavaScript context. The only way in is Steam's local
debugging port, which the client opens only when a `.cef-enable-remote-debugging` file sits in its
folder at startup — as Decky Loader or Millennium do. So it is the user's call, off by default
(⚙ → Steam → Download control, which writes the file and offers to restart Steam): once the port
is open, any program on this PC can control Steam.

Without it, these actions open Steam's download list, driven with the keyboard and the controller
(Ⓑ or Esc to come back to 3DSteam). Cancelling an install is a case apart: what was already
downloaded has to be erased, so it goes through Steam's uninstall dialog, which asks for
confirmation.

**Installing, like on a console store** (`useArrivals.ts`, `DownloadProgress.tsx`): a game being
installed takes its place on the board as soon as its download starts. The top screen is then given
over to it: on the left the phase, the percentage in large type, bytes, rate and time left; in the
middle **its banner filling up like a jar**, the empty part in grey, edged with a rippling wave,
where blocks of data fall and dive into the filled part while bubbles rise through it, with a float
carrying the percentage at the surface; on the right Pause / Resume and Cancel. Paused, everything
freezes; queued or preparing, a badge says what is being waited for; while verifying and
installing, a sheen sweeps back and forth.

When the download leaves the list, nothing yet says whether it finished or was cancelled: the game
stays at 100 % until the next scan. Playable, it is party time (the banner leaps under a burst of
confetti, a "Ready to play!" tag, a little fanfare); still missing from disk, it leaves the board
quietly.

**Uninstalling** (`Shatter.tsx`): the tile cracks and shakes for half a second, then shatters — a
slightly warped grid of triangles, each one hopping before it tumbles down, in a cloud of dust. The
banner on the top screen cracks the same way and topples off the screen. The slot only empties once
the destruction is over, and only for a game the user actually asked to uninstall: a game that
disappears for any other reason leaves quietly.

### Starting a game

Starting a game plays a full-screen sequence (`LaunchSplash.tsx`): the game's artwork fills the
screen, the icon flies out of its slot and slams into the centre (shockwave, sparks, controller
rumble, fanfare), the game's logo appears, then the icon dives towards the screen and a white flash
fades to black. **The screen then stays black until the game is really open** (`gamewatch.rs`):
Steam logs each game's processes in `logs/gameprocess_log.txt`, and the game is open once one of
them shows a real window. A game that closes without opening, or keeps you waiting for more than
three minutes, hands control back with a message. A click, Ⓐ or Ⓑ go back to 3DSteam at any time.

**A running game is not started again, and can be stopped from 3DSteam.** The same log tells which
games are running: a process Steam logged that is still alive, or the `Running` key in Steam's
registry (read every 2.5 s). Its tile shows a green dot, the top screen says "Running", and starting
it again only shows a message. **Stop** (top screen or the tile's menu) asks its windows to close
(`WM_CLOSE`, like the close button: the game can offer to save). If it hasn't closed six seconds
later, or has no window at all, **Force stop** terminates its processes. Either way, 3DSteam only
targets a process that is still alive and whose executable is the one Steam logged: a process
number reused in the meantime by another program is never touched.

### Menu music

A soft little tune (`menuMusic.ts`), like a console menu's, generated on the fly with Web Audio —
no file, no copyright, and it never quite repeats (four warm chords, a pad, a light bass, a
plucked melody that changes every loop, a touch of echo). It is quiet by default and fades away by
itself while the music player plays, when a game starts, when 3DSteam is no longer in front, or
when sounds are muted. It is set in ⚙ → Sound → Menu music.

### Startup

⚙ → Startup: start 3DSteam with Windows (the user's `Run` registry entry), and the
window state on opening — like last time, window, maximized, full screen or minimized — with a
"minimized when Windows starts it" option. The setting is applied by Rust before the window shows
(`startup.rs`, window created hidden): nothing flickers. The big launch animation, and minimizing
3DSteam once the game is open, are set there too.

### Profile and Svgii

Instead of a profile picture, a **Svgii**, an avatar you put together piece by piece (`mascot.ts`,
`Mascot.tsx`): face shape, skin (realistic or pastel), ears (human, cat, bunny, bear cub, puppy,
antennae), eyes, mouth, rosy cheeks, hairstyle and its color, accessory (glasses, bow, flower,
headphones, crown, sprout) and favorite color, which dresses it. It is all drawn in
SVG, with no image: each piece fits the shape of the head, and fringes are cut out by the head
itself, so any hairstyle suits any face.

The Svgii is a little alive: it breathes, blinks, jumps for joy when a game finishes installing,
gets excited when a game starts, is sad when one is uninstalled and falls asleep when 3DSteam is no
longer in front.

You can make as many as you like. The one **marked favorite** stands for you everywhere: the pill
at the top left, the Profile app's icon, the reactions. Svgii are kept in local storage; the old
single-Svgii profile becomes the first one in the collection, and the favorite.

**Sharing.** Other people's Svgii only arrive if they share them with you. A Svgii fits in a dozen
bytes (the rank of each piece and each color, the name in UTF-8, a checksum), written in Crockford
base 32: a code like `SVGII-041G0-0020G-00028-4199Q-CSV9D-4G35W-G`, easy to copy without mistakes (no
I, L, O or U; case, spaces and dashes don't matter). Send it as is, or in a `.svgii` file exported to
`%APPDATA%\com.threedsteam.launcher\svgii\`. On the friend's side: "Paste a code" or "Import a
file". A received Svgii is marked "Received": it stays theirs, it can't be edited or be your
favorite. A code already in the collection isn't added twice, a damaged code is refused.

The pill at the top left (the Steam persona name on first launch) opens the **Profile** page
(`apps/Profile.tsx`), also filed in the grid as an app, with your favorite as its icon:

- **My card**: the favorite and the button that opens the editor (`ProfileEditor.tsx`), where each
  choice is shown on a thumbnail of the Svgii, with a "Random" button.
- **Steam account** (`profile.rs`), read locally, with no network or API key: persona name,
  previous names, avatar (the client's `config/avatarcache`) and Steam level, all from
  `localconfig.vdf`.
- **A few numbers**: playtime, installed games (non-Steam included), favorite game, number of Svgii.
- **My Svgii**: the collection. A Svgii opens its card: make it favorite, edit it, share it (its
  code, to copy or export as a file) or delete it — except the favorite.

### Svgii Plaza

An app in the grid (`src/apps/plaza/`), with four tabs, all usable with a keyboard and a controller
(Ⓑ first closes a Svgii's menu, then goes back to the list of activities):

- **The Plaza**: all your Svgii stroll around (except those away on an expedition), wearing their
  accessories. A Svgii opens its menu: **Feed** (from the food stock), **Talk** (a speech bubble
  depending on its appetite, your friendship or the last game you started), **Dress up** (the
  Wardrobe) and **Passport** (origin, arrival, meals, expeditions, code). The Plaza's backdrop is
  picked from those you bought.
- **Svgii Shop**: spend your **Golds**, earned by playing — the total playtime Steam records is read
  on each visit, and every three minutes played since the previous one is worth a Gold (200 offered
  on the first visit). Hats, eyewear, auras, food and backdrops; each accessory can be tried on your
  favorite before buying.
- **Wardrobe**: pick a Svgii, then one accessory (or none) per slot: hat, eyewear, aura.
- **Activities**: **expeditions** (15 min, 1 h or 4 h: the Svgii comes back with Golds, sometimes a
  treat, even if the app was closed in the meantime), a **quiz** made from your library (most played,
  last started, hours spent, biggest on disk; ten Golds per right answer, once a day) and automatic
  **battles** against a passing Svgii (friendship, accessories and appetite make it stronger; five
  rewarded battles a day).

A Svgii gets hungry after about a day; when starving it sulks and won't go on an expedition or into
a battle. The catalogue is modular (`src/lib/svgiiItems.tsx`): each accessory is a `<g id="item-…">`
layer that `Mascot.tsx` places on the Svgii, in one of three slots, fitted to the head it dresses
(its top, its width, where the eyes are); adding an item means one entry in `ITEMS`, a drawing, and
its name in `i18n.tsx`. The Plaza's state (`src/lib/plaza.ts`) is kept in local storage; accessories
stay on this PC and are not part of a Svgii's share code. Everything is drawn in SVG, with no image
or sound taken from any game.

### Built-in apps

Like the software of a console menu, five apps live on the board (`src/apps/`). They are games like
any other: they can be moved, filed into folders, sorted (opening an app counts as playing it for
"Recent") and searched. Their number is negative, never a real Steam game's: nothing about them
goes to Steam. Ⓐ / Enter opens them full screen; the arrows and the D-pad move around, Ⓑ / Esc
closes them.

- **Activity Log**: total play time, play time over the last two weeks (read from
  `localconfig.vdf`), rankings and last sessions. Steam keeps no day-by-day record, so 3DSteam
  notes each game's total at every scan, and the time played on a day is the difference with the
  previous record. The last-seven-days chart thus fills in over the days 3DSteam is open. An empty
  record is never stored, and a day never counts more than 24 hours: a gap in the records does not
  pass for a gaming session. Picking a game moves the cursor to it.
- **Music Player**: soundtracks bought on Steam (`steamapps/music`, with their cover art) and the
  Music folder, grouped into albums. Titles come from FLAC and MP3 tags (`media.rs`), otherwise
  from the file name; a soundtrack shipped in both FLAC and MP3 shows up once. Music keeps playing
  once the app is closed, a pill in the top bar shows it and pauses it, and it stops when a game
  starts.
- **Album**: Steam screenshots (sorted by game, with their thumbnails), Windows ones
  (Win + Print Screen) and Xbox Game Bar ones, newest first, grouped by day. Ⓐ opens a screenshot
  large, ← → go to the next one, Ⓑ goes back to the grid.
- **Profile**: your favorite Svgii, your Steam card and your Svgii collection (see above).
- **Svgii Plaza**: the Plaza, the Svgii Shop, the Wardrobe and activities (see above).

`asset://` is opened on those folders only, when the app lists them.

Progress is shown live (`progress.rs`). The manifests are not enough: measured on a 5 GB download,
Steam only rewrites `BytesDownloaded` about every four minutes, and pausing does not show up there
at all. So three sources are combined:

- the manifests, for the totals, and as exact reference points when Steam rewrites them;
- the `logs/content_log.txt` journal, read as it grows, which gives the phase (queued, preparing,
  downloading, verifying, installing, paused) and the exact counters at every start;
- between two reference points, the bytes `steam.exe` writes to disk (`GetProcessIoCounters`).
  They track the installed bytes within 1 %: 2,281 MB written for 2,252 MB installed in the
  measurement.

All of it is re-read every 0.8 s during a download and every 5 s otherwise. Between two readings
the display extrapolates at the measured rate, never going backwards. On the tile, the icon fills
with colour from the bottom up, with a phase badge and the percentage. A pill in the top bar follows
the active download from anywhere; clicking it moves the cursor to that game, opening its folder if
need be. The game switches to "playable" by itself when it ends. If 3DSteam is opened in the middle
of a download, it starts from the last known reference point, so progress may jump at the next one.

The cursor, for that matter, always follows the game it points at, even when that game changes
slot: sorting, an install landing on the board, a search filtering it. Only moving the cursor on
purpose changes what it follows.

| File | Role |
| --- | --- |
| `src-tauri/src/vdf.rs` | Valve KeyValues parser (+ tests) |
| `src-tauri/src/steam.rs` | Steam detection, libraries, manifests, artwork, catalogue, launching |
| `src-tauri/src/appinfo.rs` | Binary `appinfo.vdf` cache: names, types, icon hashes (+ tests) |
| `src-tauri/src/progress.rs` | Live download progress: manifests, journal, bytes written (+ tests) |
| `src-tauri/src/steamctl.rs` | Pause, resume and cancel through Steam's debugging port |
| `src-tauri/src/media.rs` | Music (FLAC / MP3 tags, cover art) and screenshots for the apps (+ tests) |
| `src-tauri/src/startup.rs` | Starting with Windows, window state on opening (+ tests) |
| `src-tauri/src/gamewatch.rs` | Running games, game really open, polite or forced stop (+ tests) |
| `src/apps/` | Built-in apps: Activity Log, Music Player, Album, Profile, Svgii Plaza |
| `src-tauri/src/padmouse.rs` | Controller and keyboard drive the cursor in front of a Steam window |
| `src-tauri/src/icons.rs` | Largest image in an `.ico`, an `.exe`'s icon, real icon sizes (+ tests) |
| `src-tauri/src/shortcuts.rs` | Non-Steam games added to Steam: binary `shortcuts.vdf`, `grid` artwork (+ tests) |
| `src-tauri/src/cache.rs` | Reading / writing `games_cache.json` |
| `src-tauri/src/lib.rs` | Tauri commands `load_cache`, `scan_library`, `launch_game` |
| `src/index.css` | Themes (CSS variables) wired into Tailwind via `@theme inline` |
| `src/lib/cursorStyle.ts` | Cursor style: storage and the `data-cursor` attribute |
| `src/lib/iconStyle.tsx` | Handling of small icons (React context) |
| `src/lib/upscale.ts` | Computed upscaling: Scale2x, xBR, HQx (on a canvas) |
| `src/lib/sound.ts` | Web Audio effects (hover, move, pop, launch, zoom, theme) |
| `src/lib/board.ts` | Free-slot board (column by column) and folders — pure functions |
| `src/components/BoardGrid.tsx` | Horizontal grid, cursor, drag and drop |
| `src/components/FolderTile.tsx` / `FolderEditor.tsx` | Folder icon, name + colour dialog |
| `src/components/TopScreen.tsx` | Top screen: game, folder or empty slot |
| `src/lib/mascot.ts` / `src/components/Mascot.tsx` | Svgii: pieces, mood, collection, share code, SVG rendering |
| `src/components/ProfileEditor.tsx` | Svgii editor, piece by piece |
| `src/apps/Profile.tsx` | Profile page, Svgii collection and sharing |
| `src/apps/plaza/` | Svgii Plaza: the Plaza, the Svgii Shop, the Wardrobe, activities |
| `src/lib/plaza.ts` / `src/lib/svgiiItems.tsx` | Golds, care and expeditions; item catalogue and SVG layers |
| `src-tauri/src/profile.rs` | Local Steam profile: persona, previous names, avatar, level (+ tests) |

## Settings

The ⚙ button (or `P`, or Select on a controller) opens the settings, sorted into three groups:
**Personalize** (Theme, Appearance, Sound, Language), **System** (Startup, Steam, Controls) and
**Data** (Presets, Reset).

- **Theme** — 14 themes included (16-Bit Console among them, in the shareable format), plus your
  own, changing colours, background (patterns, gradients), panels and corner radii: Sky Blue,
  Frost, Cherry Red, Lemon Yellow, Candy Pink, Enchanted Forest, Retro Cream, Sunset, Pocket Screen,
  Scarlet, Soft Night, Neon, Indigo. `T` moves to the next one.
- **Presets** — save the current layout under a name (game placement, folders and theme), then load,
  overwrite, rename or delete it. Games installed since a preset was saved are placed after its last
  item when it is loaded.
- **Controls** — keyboard or controller: a drawing of the device (the key for the selected action
  lights up) and the list of actions; "Change" waits for the next key or button. A key already in use
  is swapped with the other action. The left stick always moves the cursor.
- **Appearance → Icons** — what to do with an icon too small for its slot (under three quarters of it):
  **Plate** (the default) places it at a *whole-number* multiple of its size on a tinted backing, so
  nothing is resampled — stretching 32 px over 150 otherwise yields a mix of 4 px and 5 px pixels;
  **Fill tile** stretches it anyway, with hard pixels; **Smooth** lets the browser interpolate;
  **Scale2x**, **xBR** and **HQx** upscale it by computation (`src/lib/upscale.ts`); **Box art**
  drops the icon for the cropped 600×900 cover, the only genuinely high-resolution option.
- **Appearance → Cursor** — five ways to mark the selected icon, each with a preview: soft glow (the default),
  pulsing ring, thin outline, raised, none. The style is set as a `data-cursor` attribute on `<html>`
  (like the theme) and lives in `src/index.css`, one shadow variable and one animation variable per
  style.
- **Language** — French or English (dates and times follow it).
- **Sound** — sound effects and their volume, menu music.
- **Startup** — opening 3DSteam (with Windows, window state), fullscreen, what happens when a
  game starts.
- **Steam** — controller and keyboard in Steam windows, direct download control.
- **Reset** — reset the layout, the preferences, clear the game cache, or wipe everything (each one
  asks for confirmation).

Adding a language: one more dictionary in `src/lib/i18n.tsx`.

## Creating and sharing themes

Under ⚙ → Theme, **"+ Create a theme"** starts from the selected theme and opens the editor (a panel
on the right, the interface behind it acting as a live preview): name, light / dark, 5 colours (hue /
saturation / lightness sliders, or a colour picker), background pattern, corner radii, panel style
(solid, glass, border) and a background image. A warning appears when text becomes hard to read.
Everything can be set from a controller too.

Sharing: **Export** writes a `.3dstheme` file into the themes folder
(`%APPDATA%\com.threedsteam.launcher\themes\`, via the "Themes folder" button); **Copy code** puts
the theme on the clipboard. Installing: **Import a file**, **Paste a code**, or simply drop the file
into the themes folder.

A `.3dstheme` is a small JSON file; only `background`, `text` and `accent` are required, the rest is
filled in automatically. A complete example is the bundled 16-Bit Console theme,
`src/themes/builtin/seize-bits.3dstheme`:

```json
{
  "format": 1,
  "id": "seize-bits",
  "name": { "fr": "Console 16 bits", "en": "16-Bit Console" },
  "dark": false,
  "colors": { "background": "#d8d7e1", "background2": "#b9b8c8", "surface": "#f0eff5", "text": "#312f3d", "accent": "#5a4bb8" },
  "pattern": { "type": "buttons", "color": "#5a4bb8", "opacity": 0.55, "size": 30 },
  "shape": { "tileRadius": 12, "panelRadius": 18, "panelStyle": "border" }
}
```

Patterns: `none`, `dots`, `stripes`, `grid`, `checker`, `stars`, `triangles`, `lines`, `scanlines`,
`buttons`. Panel styles: `solid`, `glass`, `border`. Optional `image` field: an image as
`data:image/…;base64`. To ship a theme with the app: a file in `src/themes/builtin/` and a line in
`BUILTIN_DEFS` (`src/themes/themes.ts`).

## Controls

Everything works with the mouse, with the keyboard alone, or with a controller alone (a PC hooked up
to a TV). The defaults are below; all of it can be changed under ⚙ → Controls. On a touchscreen,
tapping a tile selects it, tapping it again starts it. The interface tightens up by itself on small
screens (down to 854 × 534, the Steam Deck screen at 150 % zoom): smaller margins, secondary text
hidden, pills reduced to their icon below 1280 px wide.

| Action | Mouse | Keyboard | Controller |
| --- | --- | --- | --- |
| Move around the grid (empty slots included) | click | arrows | D-pad / left stick |
| Start an installed game / open a folder | double-click or button | Enter | Ⓐ |
| Back (close the folder, clear the search) | "← Back" | Esc | Ⓑ |
| Pick up / drop an icon | drag it | Space (Enter drops, Esc cancels) | Ⓧ (Ⓐ drops, Ⓑ cancels) |
| New folder (on an empty slot) | "+ New folder" | `N` | Ⓨ |
| Manage a game (install, pause, cancel, uninstall…) | right-click | Enter, Menu or `O` | Ⓐ or Ⓨ |
| Rows − / + | the − / + buttons | `-` / `+` | LB / RB |
| Menus (toolbar, top screen, top bar) | click | ↑ from the first row, then arrows | same |
| Settings | ⚙ | `P` | Select |
| Minimize / quit 3DSteam | ⏻ button (top right) | same, with the keyboard | same, with the D-pad |
| Fullscreen | fullscreen icon | `F11` | Start |
| Search | the search field | `/` | Ⓐ on the field: on-screen keyboard |
| Next theme | ⚙ → Theme | `T` | Select → Theme |
| Mute | speaker icon | `M` | speaker icon |

Outside the grid, the arrows (or the D-pad) move from button to button the way a TV interface does,
Ⓐ / Enter activates, Ⓑ / Esc goes back; ↓ from under the toolbar drops back into the grid. In a text
field, Ⓐ opens an **on-screen keyboard** (Ⓧ deletes, Ⓨ space, Ⓑ confirms).

Zooming changes the number of rows; every game keeps its slot number. An uninstalled game leaves its
slot empty and takes it back if it is reinstalled; a new game lands after the last item. The board
has a fixed size (100 slots, 60 inside a folder, or 2 × the number of games if that is larger), so an
icon can be dropped anywhere, even far past the others. "Sort: Recent / A → Z" packs the current view
without gaps (folders first). Deleting a folder deletes no game: they take its slot and the ones
after it. The board, the zoom, the theme, the sound, the last selected game and fullscreen are all
remembered.

## Licence

MIT — see [LICENSE](LICENSE).
