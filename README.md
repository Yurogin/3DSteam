**Français** · [English](README.en.md)

# 3DSteam

Launcher Steam léger pour Windows, inspiré des menus de consoles portables. Construit avec
Tauri v2, React et Rust. Entièrement utilisable à la souris, au clavier ou à la manette.

## Fonctionnalités

**Bibliothèque**
- Grille d'icônes libre : chaque jeu se place où l'on veut, cases vides comprises, avec dossiers
  personnalisables (nom, couleur).
- Jeux Steam installés, jeux hors Steam ajoutés au client, et vue « Tout » des jeux connus du compte.
- Lecture 100 % locale des fichiers de Steam : aucune clé d'API, aucun compte tiers.
- Recherche, tri (récents, A → Z), zoom, sauvegardes de disposition.

**Gestion des jeux**
- Lancement, installation et désinstallation via Steam (`steam://`), qui garde la main sur les
  mises à jour, le cloud et les DRM.
- Progression des téléchargements en temps réel, avec pause, reprise et annulation.
- Détection des jeux en cours, avec arrêt propre ou forcé depuis 3DSteam.
- Pilotage des fenêtres Steam à la manette ou au clavier, sans Big Picture.

**Applis intégrées**
- Journal d'activité : temps de jeu, classements, historique sur sept jours.
- Lecteur de musique : bandes-son Steam et dossier Musique.
- Album : captures Steam, Windows et Xbox Game Bar.
- Profil et Svgii : avatars SVG personnalisables, partageables par code.
- Svgii Plaza : mini-jeu de collection (boutique, expéditions, quiz, combats).

**Personnalisation**
- 14 thèmes intégrés et éditeur de thèmes, avec import et export au format `.3dstheme`.
- Bruitages et musique du menu générés en Web Audio, sans fichier audio.
- Démarrage avec Windows, état de la fenêtre à l'ouverture.
- Interface en français et en anglais, adaptée aux petits écrans (Steam Deck) et au tactile.

## Installation

### Prérequis

- Windows 10 ou 11 (WebView2 est inclus dans Windows 11)
- Node.js ≥ 20.19
- Rust et les outils de compilation MSVC :

```powershell
winget install Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive"
```

### Commandes

```powershell
npm install
npm run tauri dev      # application en développement, rechargement à chaud
npm run tauri build    # installateur NSIS dans src-tauri/target/release/bundle/
npm run dev            # interface seule dans le navigateur, avec des jeux de démo
```

Tests Rust : `cd src-tauri; cargo test`. Ajoutez `-- --ignored --nocapture` pour scanner votre
propre bibliothèque Steam.

> Compilez depuis PowerShell plutôt que Git Bash : le `link` de Git Bash masque celui de MSVC.

## Architecture

Au démarrage, la grille s'affiche depuis un cache local, puis un scan en arrière-plan relit
la bibliothèque Steam : `libraryfolders.vdf`, manifestes `appmanifest_*.acf`, cache binaire
`appinfo.vdf` et `shortcuts.vdf`. Les données de l'application sont stockées dans
`%APPDATA%\com.threedsteam.launcher\`.

| Module | Rôle |
| --- | --- |
| `src-tauri/src/steam.rs` | Détection de Steam, bibliothèques, manifestes, visuels, lancement |
| `src-tauri/src/vdf.rs`, `appinfo.rs` | Parseurs VDF texte et binaire |
| `src-tauri/src/shortcuts.rs` | Jeux hors Steam |
| `src-tauri/src/icons.rs` | Extraction des icônes `.ico` et `.exe` |
| `src-tauri/src/progress.rs` | Progression des téléchargements |
| `src-tauri/src/steamctl.rs` | Pause, reprise et annulation des téléchargements |
| `src-tauri/src/gamewatch.rs` | Suivi et arrêt des jeux lancés |
| `src-tauri/src/padmouse.rs` | Pilotage des fenêtres Steam à la manette et au clavier |
| `src-tauri/src/media.rs` | Musique et captures d'écran |
| `src-tauri/src/profile.rs` | Profil Steam local |
| `src-tauri/src/startup.rs` | Démarrage avec Windows |
| `src/components/` | Grille, écran du haut, menus, paramètres, animations |
| `src/apps/` | Applis intégrées |
| `src/lib/` | Plateau, navigation, sons, Svgii, traductions |
| `src/themes/` | Format et thèmes intégrés |

### Notes techniques

- **Installation.** La boîte d'installation de Steam ne répond qu'à la souris. Plutôt que de la
  valider automatiquement (ce qui reviendrait à accepter une licence à la place de l'utilisateur),
  3DSteam convertit la manette et le clavier en curseur tant qu'une fenêtre Steam est ouverte.
- **Contrôle des téléchargements.** Steam n'expose aucune commande `steam://` pour mettre en pause
  ou annuler. 3DSteam passe par le port de débogage local du client, **désactivé par défaut**
  (⚙ → Steam). Une fois activé, n'importe quel programme local peut piloter Steam. Sans lui, ces
  actions ouvrent la liste des téléchargements de Steam.
- **Progression.** Steam met rarement à jour ses manifestes pendant un téléchargement. La
  progression croise donc les manifestes, le journal `content_log.txt` et les octets écrits par
  `steam.exe`.

## Thèmes

Créez un thème dans ⚙ → Thème → **Créer un thème**, puis partagez-le en fichier `.3dstheme` ou en
code à coller. Les thèmes importés sont stockés dans `%APPDATA%\com.threedsteam.launcher\themes\`.

Un thème est un fichier JSON. Seules les couleurs `background`, `text` et `accent` sont
obligatoires :

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

- Motifs : `none`, `dots`, `stripes`, `grid`, `checker`, `stars`, `triangles`, `lines`,
  `scanlines`, `buttons`.
- Panneaux : `solid`, `glass`, `border`.
- Image de fond facultative : champ `image`, en `data:image/…;base64`.

Pour intégrer un thème à l'application, ajoutez son fichier dans `src/themes/builtin/` et
déclarez-le dans `BUILTIN_DEFS` (`src/themes/themes.ts`).

## Contrôles

Raccourcis par défaut, modifiables dans ⚙ → Touches.

| Action | Clavier | Manette |
| --- | --- | --- |
| Se déplacer | Flèches | Croix / stick gauche |
| Lancer / ouvrir | Entrée | Ⓐ |
| Retour | Échap | Ⓑ |
| Menu d'actions | Menu ou `O` | Ⓨ |
| Déplacer une icône | Espace | Ⓧ |
| Nouveau dossier | `N` | Ⓨ (sur une case vide) |
| Zoom | `-` / `+` | LB / RB |
| Rechercher | `/` | Ⓐ sur le champ |
| Paramètres | `P` | Select |
| Plein écran | `F11` | Start |
| Changer de thème | `T` | — |
| Couper le son | `M` | — |

À la souris : double-clic pour lancer, clic droit pour le menu d'actions, glisser-déposer pour
réorganiser.

## Licence

MIT. Voir [LICENSE](LICENSE).
