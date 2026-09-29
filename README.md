# 3DSteam

Launcher Steam ultra-léger (Tauri v2 + React), façon menu HOME de la 3DS / Wii U :
quadrillage d'icônes qui s'étend vers la droite (cases vides autorisées, curseur libre, chaque jeu
déposé où l'on veut), dossiers de jeux (nom et couleur au choix), bannière du jeu sélectionné (infos à
gauche, jaquette carrée au centre), bruitages « pop »
synthétisés en direct, thèmes de couleurs, navigation souris, clavier et manette.

## Prérequis (Windows)

```powershell
winget install Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive"
```

WebView2 est déjà présent sur Windows 11. Node ≥ 20.19.

## Lancer

```powershell
npm install
npm run tauri dev      # fenêtre de dev avec rechargement à chaud
npm run tauri build    # installateur NSIS dans src-tauri/target/release/bundle/
npm run dev            # interface seule dans le navigateur, avec des jeux de démo
```

Tests du parseur VDF : `cd src-tauri; cargo test`. Scan de ta vraie bibliothèque : `cargo test -- --ignored --nocapture`.

> Sous Windows, compile depuis PowerShell et non depuis Git Bash : le `link` de Git Bash masque celui de MSVC.

## Fonctionnement

Au démarrage, `load_cache` lit `games_cache.json` (dans `%APPDATA%\com.threedsteam.launcher\`) et la
grille s'affiche tout de suite. `scan_library` tourne ensuite sur un thread à part : il localise Steam
(registre, puis chemins par défaut), lit `libraryfolders.vdf`, parse chaque `appmanifest_*.acf`, puis
réécrit le cache de façon atomique.

Chaque case affiche l'icône carrée du jeu, celle de la liste de la bibliothèque Steam : le `.ico`
du client (`steam/games/<empreinte>.ico`, retrouvé via `appcache/appinfo.vdf`) si elle existe,
sinon la petite icône du cache. La bannière du haut est l'en-tête Steam (460×215).

Un `.ico` est un annuaire : il contient souvent huit ou dix images, de 16 à 512 px, et c'est alors
le décodeur du navigateur qui choisit laquelle afficher. Plutôt que de dépendre de ce choix,
`icons.rs` lit l'annuaire au scan (sans rien décoder, donc sans dépendance) et réécrit dans
`%APPDATA%\com.threedsteam.launcher\icons\` un fichier ne contenant que la plus grande image, en
recopiant ses octets tels quels. Il relève au passage la taille réelle de chaque icône
(`iconSize`) — celle d'un PNG se lit dans son IHDR, l'annuaire plafonnant à 256 px.

Beaucoup d'icônes Steam ne dépassent pas 32 px, pour des cases qui en font cinq fois plus. Il n'y
a pas de bon traitement universel, d'où un réglage (⚙ → Général → Icônes) : voir plus bas.

Les jaquettes viennent du cache local de Steam (`appcache/librarycache`, servi via `asset://` ; seuls ce
dossier, `steam/games` et les icônes dérivées sont autorisés). Si une image manque, le CDN Steam prend le relais, et en dernier recours une tuile
colorée avec les initiales du jeu.

Le lancement passe par `steam://run/<appid>` : Steam s'occupe des mises à jour, du cloud et des DRM.

| Fichier | Rôle |
| --- | --- |
| `src-tauri/src/vdf.rs` | Parseur KeyValues de Valve (+ tests) |
| `src-tauri/src/steam.rs` | Détection de Steam, bibliothèques, manifestes, visuels, lancement |
| `src-tauri/src/icons.rs` | Plus grande image d'un `.ico`, taille réelle des icônes (+ tests) |
| `src-tauri/src/cache.rs` | Lecture / écriture de `games_cache.json` |
| `src-tauri/src/lib.rs` | Commandes Tauri `load_cache`, `scan_library`, `launch_game` |
| `src/index.css` | Thèmes (variables CSS) branchés sur Tailwind via `@theme inline` |
| `src/lib/cursorStyle.ts` | Style du curseur : lecture / écriture et attribut `data-cursor` |
| `src/lib/iconStyle.tsx` | Traitement des petites icônes (contexte React) |
| `src/lib/upscale.ts` | Agrandissements calculés : Scale2x, xBR, HQx (sur canevas) |
| `src/lib/sound.ts` | Bruitages Web Audio (survol, déplacement, pop, lancement, zoom, thème) |
| `src/lib/board.ts` | Plateau à cases libres (colonne par colonne) et dossiers — fonctions pures |
| `src/components/BoardGrid.tsx` | Quadrillage horizontal, curseur, glisser-déposer |
| `src/components/FolderTile.tsx` / `FolderEditor.tsx` | Icône de dossier, fenêtre nom + couleur |
| `src/components/TopScreen.tsx` | Écran du haut : jeu, dossier ou case vide |

## Paramètres

Le bouton ⚙ (ou `P`, ou Select à la manette) ouvre les paramètres :

- **Thème** — 14 thèmes livrés (dont Super Nintendo, au format partageable), plus les vôtres, qui
  changent couleurs, fond (motifs, dégradés), panneaux et arrondis :
  Bleu 3DS, Wii U, Rouge Switch, Jaune Pikachu, Rose Kirby, Hyrule, Famicom, Coucher de soleil,
  Game Boy, Virtual Boy, Nuit douce, Switch Néon,
  GameCube. `T` passe au suivant.
- **Sauvegardes** — enregistre sous un nom la disposition actuelle (placement des jeux, dossiers
  et thème), puis la recharge, la remplace, la renomme ou la supprime. Les jeux installés depuis
  une sauvegarde se rangent après son dernier élément au chargement.
- **Touches** — clavier ou manette : dessin de l'appareil (la touche de l'action choisie s'allume)
  et liste des actions ; « Modifier » attend la prochaine touche / le prochain bouton. Une touche
  déjà utilisée est échangée avec l'autre action. Le stick gauche déplace toujours le curseur.
- **Icônes** — que faire d'une icône trop petite pour sa case (en dessous des trois quarts) :
  **Plaque** (par défaut) la pose à un multiple *entier* de sa taille sur un fond teinté, donc sans
  rééchantillonnage — étirer du 32 px sur 150 donne sinon des pixels de 4 et de 5 px mélangés ;
  **Plein cadre** l'étire quand même, en pixels francs ; **Lissé** laisse le navigateur interpoler ;
  **Scale2x**, **xBR** et **HQx** l'agrandissent par le calcul (`src/lib/upscale.ts`) ; **Jaquette**
  l'abandonne au profit de la 600×900 recadrée, la seule option en vraie haute résolution.
- **Curseur** — cinq façons de signaler l'icône sélectionnée, avec un aperçu de chacune : halo
  doux (par défaut), halo pulsé, contour fin, surélevé, aucun. Le style est posé en attribut
  `data-cursor` sur `<html>` (comme le thème) et se règle dans `src/index.css`, une variable
  d'ombre et une d'animation par style.
- **Langue** — français ou anglais (dates et heures suivent la langue).
- **Général** — sons et volume, plein écran, icônes, curseur.
- **Données** — réinitialiser la disposition, les préférences, vider le cache des jeux, ou tout
  remettre à zéro (chaque action demande une confirmation).

Ajouter une langue : un dictionnaire dans `src/lib/i18n.tsx`.

## Créer et partager des thèmes

Dans ⚙ → Thème : **« + Créer un thème »** part du thème sélectionné et ouvre l'éditeur (panneau à
droite, l'interface derrière sert d'aperçu en direct) : nom, clair / sombre, 5 couleurs (curseurs
teinte / saturation / luminosité, ou sélecteur de couleur à la souris), motif de fond, arrondis,
style des panneaux (pleins, verre, bordure) et image de fond. Une alerte prévient si le texte devient
peu lisible. Tout se règle aussi à la manette.

Partager : **Exporter** enregistre un fichier `.3dstheme` dans le dossier des thèmes
(`%APPDATA%\com.threedsteam.launcher\themes\`, bouton « Dossier des thèmes »), **Copier le code**
met le thème dans le presse-papiers. Installer : **Importer un fichier**, **Coller un code**, ou
déposer simplement le fichier dans le dossier des thèmes.

Un `.3dstheme` est un petit JSON ; seules `background`, `text` et `accent` sont obligatoires, le
reste est complété automatiquement. Exemple complet : le thème Super Nintendo livré,
`src/themes/builtin/super-nintendo.3dstheme` :

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

Motifs : `none`, `dots`, `stripes`, `grid`, `checker`, `stars`, `triangles`, `lines`, `scanlines`,
`snes`. Styles de panneaux : `solid`, `glass`, `border`. Champ facultatif `image` : une image en
`data:image/…;base64`. Pour ajouter un thème livré avec l'application : un fichier dans
`src/themes/builtin/` et une ligne dans `BUILTIN_DEFS` (`src/themes/themes.ts`).

## Contrôles

Tout se fait à la souris, au clavier seul ou à la manette seule (PC branché sur une télé).
Réglages par défaut ci-dessous ; tout est modifiable dans ⚙ → Touches.

| Action | Souris | Clavier | Manette |
| --- | --- | --- | --- |
| Se déplacer dans la grille (cases vides comprises) | clic | flèches | croix / stick gauche |
| Démarrer / ouvrir un dossier | double-clic ou bouton | Entrée | Ⓐ |
| Retour (fermer le dossier, effacer la recherche) | « ← Retour » | Échap | Ⓑ |
| Prendre / poser une icône | la glisser | Espace (Entrée pose, Échap annule) | Ⓧ (Ⓐ pose, Ⓑ annule) |
| Nouveau dossier (sur une case vide) | « + Dossier » | `N` | Ⓨ |
| Rangées − / + | boutons − / + | `-` / `+` | LB / RB |
| Menus (barre d'outils, écran du haut, barre du haut) | clic | ↑ depuis la 1re rangée, puis flèches | idem |
| Paramètres | ⚙ | `P` | Select |
| Plein écran | icône plein écran | `F11` | Start |
| Rechercher | champ de recherche | `/` | Ⓐ sur le champ : clavier virtuel |
| Changer de thème | ⚙ → Thème | `T` | Select → Thème |
| Couper les sons | icône haut-parleur | `M` | icône haut-parleur |

Hors de la grille, les flèches (ou la croix) passent d'un bouton à l'autre comme sur une interface de
télé, Ⓐ / Entrée active, Ⓑ / Échap revient en arrière ; ↓ sous la barre d'outils redescend dans la
grille. Dans un champ de texte, Ⓐ ouvre un **clavier virtuel** (Ⓧ efface, Ⓨ espace, Ⓑ valide).

Le zoom change le nombre de rangées ; chaque jeu garde son numéro de case. Un jeu désinstallé laisse
sa case vide et la retrouve s'il est réinstallé ; un nouveau jeu se place après le dernier élément.
Le plateau a une taille fixe (100 cases, 60 dans un dossier, ou 2 × le nombre de jeux si c'est plus) :
on peut poser une icône n'importe où, même loin après les autres.
« Trier : Récents / A → Z » range la vue courante sans trous (dossiers en tête). Supprimer un dossier
ne supprime aucun jeu : ils reprennent sa case et les suivantes. Le plateau, le zoom, le thème, le son et
le dernier jeu sélectionné et le plein écran sont mémorisés.

## Licence

MIT — voir [LICENSE](LICENSE).
