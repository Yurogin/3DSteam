[Français](README.md) · **English**

# 3DSteam

A lightweight Steam launcher for Windows, inspired by handheld console menus. Built with
Tauri v2, React and Rust. Fully usable with a mouse, keyboard or controller.

## Features

**Library**
- Free-form icon grid: place each game anywhere, empty slots included, with customizable folders
  (name, colour).
- Installed Steam games, non-Steam games added to the client, and an "All" view of every game the
  account knows.
- Reads Steam's files locally: no API key, no third-party account.
- Search, sorting (recent, A → Z), zoom, saved layouts.

**Game management**
- Launch, install and uninstall through Steam (`steam://`), which keeps handling updates, cloud
  saves and DRM.
- Real-time download progress, with pause, resume and cancel.
- Detects running games, with graceful or forced shutdown from 3DSteam.
- Controller and keyboard control of Steam windows, without Big Picture.

**Built-in apps**
- Activity log: playtime, rankings, seven-day history.
- Music player: Steam soundtracks and the Music folder.
- Album: Steam, Windows and Xbox Game Bar screenshots.
- Profile and Svgii: customizable SVG avatars, shareable by code.
- Svgii Plaza: a collection mini-game (shop, expeditions, quiz, battles).

**Customization**
- 14 built-in themes and a theme editor, with `.3dstheme` import and export.
- Sound effects and menu music generated with Web Audio, no audio files.
- Start with Windows, window state on launch.
- French and English interface, adapted to small screens (Steam Deck) and touch.

## Installation

### Requirements

- Windows 10 or 11 (WebView2 ships with Windows 11)
- Node.js ≥ 20.19
- Rust and the MSVC build tools:

```powershell
winget install Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive"
```

### Commands

```powershell
npm install
npm run tauri dev      # development build with hot reload
npm run tauri build    # NSIS installer in src-tauri/target/release/bundle/
npm run dev            # front end only, in the browser, with demo games
```

Rust tests: `cd src-tauri; cargo test`. Add `-- --ignored --nocapture` to scan your own Steam
library.

> Build from PowerShell rather than Git Bash: Git Bash's `link` shadows MSVC's.

## Architecture

On startup, the grid renders from a local cache while a background scan rereads the Steam library:
`libraryfolders.vdf`, `appmanifest_*.acf` manifests, the binary `appinfo.vdf` cache and
`shortcuts.vdf`. Application data is stored in `%APPDATA%\com.threedsteam.launcher\`.

| Module | Purpose |
| --- | --- |
| `src-tauri/src/steam.rs` | Steam detection, libraries, manifests, artwork, launching |
| `src-tauri/src/vdf.rs`, `appinfo.rs` | Text and binary VDF parsers |
| `src-tauri/src/shortcuts.rs` | Non-Steam games |
| `src-tauri/src/icons.rs` | Icon extraction from `.ico` and `.exe` files |
| `src-tauri/src/progress.rs` | Download progress |
| `src-tauri/src/steamctl.rs` | Download pause, resume and cancel |
| `src-tauri/src/gamewatch.rs` | Running game tracking and shutdown |
| `src-tauri/src/padmouse.rs` | Controller and keyboard control of Steam windows |
| `src-tauri/src/media.rs` | Music and screenshots |
| `src-tauri/src/profile.rs` | Local Steam profile |
| `src-tauri/src/startup.rs` | Start with Windows |
| `src/components/` | Grid, top screen, menus, settings, animations |
| `src/apps/` | Built-in apps |
| `src/lib/` | Board, navigation, sound, Svgii, translations |
| `src/themes/` | Theme format and built-in themes |

### Technical notes

- **Installing games.** Steam's install dialog only responds to the mouse. Rather than confirming
  it automatically (which would mean accepting a licence on the user's behalf), 3DSteam turns the
  controller and keyboard into a mouse cursor while a Steam window is open.
- **Download control.** Steam exposes no `steam://` command to pause or cancel a download. 3DSteam
  uses the client's local debugging port, **disabled by default** (⚙ → Steam). Once enabled, any
  local program can control Steam. Without it, these actions open Steam's download list instead.
- **With Millennium.** Millennium keeps the debugging port to itself, so 3DSteam offers a small
  Millennium plugin instead (`src-tauri/millennium-plugin/`, ⚙ → Steam). It runs inside Steam's
  interface and talks to 3DSteam through files, with no open port. It handles pause, resume and
  cancel, as well as installing and uninstalling without the Steam window. A licence agreement, a
  key or a lack of space always leaves the Steam window to the user.
- **Progress.** Steam rarely updates its manifests during a download, so progress combines the
  manifests, the `content_log.txt` log and the bytes written by `steam.exe`.

## Themes

Create a theme in ⚙ → Theme → **Create a theme**, then share it as a `.3dstheme` file or as a code
to paste. Imported themes are stored in `%APPDATA%\com.threedsteam.launcher\themes\`.

A theme is a JSON file. Only the `background`, `text` and `accent` colours are required:

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

- Patterns: `none`, `dots`, `stripes`, `grid`, `checker`, `stars`, `triangles`, `lines`,
  `scanlines`, `buttons`.
- Panels: `solid`, `glass`, `border`.
- Optional background image: the `image` field, as `data:image/…;base64`.

To bundle a theme with the app, add its file to `src/themes/builtin/` and register it in
`BUILTIN_DEFS` (`src/themes/themes.ts`).

## Controls

Default bindings, configurable in ⚙ → Controls.

| Action | Keyboard | Controller |
| --- | --- | --- |
| Move | Arrow keys | D-pad / left stick |
| Launch / open | Enter | Ⓐ |
| Back | Esc | Ⓑ |
| Action menu | Menu or `O` | Ⓨ |
| Move an icon | Space | Ⓧ |
| New folder | `N` | Ⓨ (on an empty slot) |
| Zoom | `-` / `+` | LB / RB |
| Search | `/` | Ⓐ on the field |
| Settings | `P` | Select |
| Fullscreen | `F11` | Start |
| Change theme | `T` | — |
| Mute | `M` | — |

With a mouse: double-click to launch, right-click for the action menu, drag and drop to rearrange.

## License

MIT. See [LICENSE](LICENSE).
