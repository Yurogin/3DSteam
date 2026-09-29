*[Français](README.md) · **English***

# 3DSteam

A very light Steam launcher (Tauri v2 + React) in the style of the 3DS / Wii U HOME menu: a grid of
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

Plenty of Steam icons are no larger than 32 px, for slots five times that. There is no one right way
to handle this, hence a setting (⚙ → General → Icons): see below.

The toolbar switches between **Installed** and **All**. "All" adds the games the client knows about
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

| File | Role |
| --- | --- |
| `src-tauri/src/vdf.rs` | Valve KeyValues parser (+ tests) |
| `src-tauri/src/steam.rs` | Steam detection, libraries, manifests, artwork, catalogue, launching |
| `src-tauri/src/appinfo.rs` | Binary `appinfo.vdf` cache: names, types, icon hashes (+ tests) |
| `src-tauri/src/icons.rs` | Largest image in an `.ico`, real icon sizes (+ tests) |
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

## Settings

The ⚙ button (or `P`, or Select on a controller) opens the settings:

- **Theme** — 14 themes included (Super Nintendo among them, in the shareable format), plus your own,
  changing colours, background (patterns, gradients), panels and corner radii: 3DS Blue, Wii U,
  Switch Red, Pikachu Yellow, Kirby Pink, Hyrule, Famicom, Sunset, Game Boy, Virtual Boy, Soft
  Night, Switch Neon, GameCube. `T` moves to the next one.
- **Presets** — save the current layout under a name (game placement, folders and theme), then load,
  overwrite, rename or delete it. Games installed since a preset was saved are placed after its last
  item when it is loaded.
- **Controls** — keyboard or controller: a drawing of the device (the key for the selected action
  lights up) and the list of actions; "Change" waits for the next key or button. A key already in use
  is swapped with the other action. The left stick always moves the cursor.
- **Icons** — what to do with an icon too small for its slot (under three quarters of it):
  **Plate** (the default) places it at a *whole-number* multiple of its size on a tinted backing, so
  nothing is resampled — stretching 32 px over 150 otherwise yields a mix of 4 px and 5 px pixels;
  **Fill tile** stretches it anyway, with hard pixels; **Smooth** lets the browser interpolate;
  **Scale2x**, **xBR** and **HQx** upscale it by computation (`src/lib/upscale.ts`); **Box art**
  drops the icon for the cropped 600×900 cover, the only genuinely high-resolution option.
- **Cursor** — five ways to mark the selected icon, each with a preview: soft glow (the default),
  pulsing ring, thin outline, raised, none. The style is set as a `data-cursor` attribute on `<html>`
  (like the theme) and lives in `src/index.css`, one shadow variable and one animation variable per
  style.
- **Language** — French or English (dates and times follow it).
- **General** — sounds and volume, fullscreen, icons, cursor.
- **Data** — reset the layout, the preferences, clear the game cache, or wipe everything (each one
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
filled in automatically. A complete example is the bundled Super Nintendo theme,
`src/themes/builtin/super-nintendo.3dstheme`:

```json
{
  "format": 1,
  "id": "super-nintendo",
  "name": { "fr": "Super Nintendo", "en": "Super Nintendo" },
  "dark": false,
  "colors": { "background": "#d8d7e1", "background2": "#b9b8c8", "surface": "#f0eff5", "text": "#312f3d", "accent": "#5a4bb8" },
  "pattern": { "type": "snes", "color": "#5a4bb8", "opacity": 0.55, "size": 30 },
  "shape": { "tileRadius": 12, "panelRadius": 18, "panelStyle": "border" }
}
```

Patterns: `none`, `dots`, `stripes`, `grid`, `checker`, `stars`, `triangles`, `lines`, `scanlines`,
`snes`. Panel styles: `solid`, `glass`, `border`. Optional `image` field: an image as
`data:image/…;base64`. To ship a theme with the app: a file in `src/themes/builtin/` and a line in
`BUILTIN_DEFS` (`src/themes/themes.ts`).

## Controls

Everything works with the mouse, with the keyboard alone, or with a controller alone (a PC hooked up
to a TV). The defaults are below; all of it can be changed under ⚙ → Controls.

| Action | Mouse | Keyboard | Controller |
| --- | --- | --- | --- |
| Move around the grid (empty slots included) | click | arrows | D-pad / left stick |
| Start / open a folder | double-click or button | Enter | Ⓐ |
| Back (close the folder, clear the search) | "← Back" | Esc | Ⓑ |
| Pick up / drop an icon | drag it | Space (Enter drops, Esc cancels) | Ⓧ (Ⓐ drops, Ⓑ cancels) |
| New folder (on an empty slot) | "+ New folder" | `N` | Ⓨ |
| Rows − / + | the − / + buttons | `-` / `+` | LB / RB |
| Menus (toolbar, top screen, top bar) | click | ↑ from the first row, then arrows | same |
| Settings | ⚙ | `P` | Select |
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
