***Français** · [English](README.en.md)*

# 3DSteam

Launcher Steam ultra-léger (Tauri v2 + React), dans l'esprit des menus de consoles portables :
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
du client (`steam/games/<empreinte>.ico`) si elle existe,
sinon la petite icône du cache. L'empreinte vient de `common/clienticon`, lu dans le cache
binaire `appcache/appinfo.vdf` par `appinfo.rs`. La bannière du haut est l'en-tête Steam (460×215).

Un `.ico` est un annuaire : il contient souvent huit ou dix images, de 16 à 512 px, et c'est alors
le décodeur du navigateur qui choisit laquelle afficher. Plutôt que de dépendre de ce choix,
`icons.rs` lit l'annuaire au scan (sans rien décoder, donc sans dépendance) et réécrit dans
`%APPDATA%\com.threedsteam.launcher\icons\` un fichier ne contenant que la plus grande image, en
recopiant ses octets tels quels. Il relève au passage la taille réelle de chaque icône
(`iconSize`) — celle d'un PNG se lit dans son IHDR, l'annuaire plafonnant à 256 px.

**Jeux hors Steam.** Ceux qu'on a ajoutés à Steam (« Ajouter un jeu non-Steam ») apparaissent
dans la grille comme les autres. `shortcuts.rs` lit `userdata/<compte>/config/shortcuts.vdf`, un
VDF binaire (nom, exécutable, dossier, icône, masqué ou non, dernière partie). Leurs visuels sont
ceux qu'on leur a choisis dans Steam (`config/grid/<numéro>p.png`, `_hero`, `_logo`…) ; sans icône
choisie, `icons.rs` extrait celle de l'exécutable (ressources `RT_GROUP_ICON` et `RT_ICON`, le
fichier est chargé comme simple fichier de données, rien n'est exécuté). Ils se lancent par
`steam://rungameid/<identifiant 64 bits>`, donc toujours via Steam, avec son overlay, et l'écran
noir de lancement attend leur fenêtre comme pour un jeu Steam. Ni magasin ni désinstallation dans
leur menu : Steam ne connaît pour eux ni page ni taille, ni temps de jeu.

Beaucoup d'icônes Steam ne dépassent pas 32 px, pour des cases qui en font cinq fois plus. Il n'y
a pas de bon traitement universel, d'où un réglage (⚙ → Apparence → Icônes) : voir plus bas.

La barre d'outils bascule entre **Installés** et **Tout**. « Tout » ajoute les jeux que le client
connaît sans qu'ils soient sur le disque : `appinfo.vdf` donne leur nom et leur type,
`userdata/<compte>/config/localconfig.vdf` dit lesquels ce compte a déjà vus, et le compte retenu
est le plus récent de `loginusers.vdf`. Ce n'est pas une liste de possession — elle contient des
démos et des jeux gratuits essayés, et il lui manque les jeux possédés jamais lancés — mais elle
est locale, instantanée et ne demande aucune clé d'API. Sur la bibliothèque de test : 72 installés
et 306 de plus.

Cette vue est à plat, comme la recherche : elle ne touche pas au plateau, ne permet ni dossier ni
glisser-déposer, et se referme avec Échap / ⓑ. Les jeux non installés s'y affichent en retrait,
leurs visuels viennent du CDN, et ils ne sont pas lançables.

Les jaquettes viennent du cache local de Steam (`appcache/librarycache`, servi via `asset://` ; seuls ce
dossier, `steam/games` et les icônes dérivées sont autorisés). Si une image manque, le CDN Steam prend le relais, et en dernier recours une tuile
colorée avec les initiales du jeu.

Le lancement passe par `steam://run/<appid>` : Steam s'occupe des mises à jour, du cloud et des DRM.

L'installation passe par `steam://install/<appid>`, qui ouvre la boîte de dialogue de Steam. Il
n'existe pas de moyen de déclencher un téléchargement sans elle : le client détient les licences.
Et cette boîte ne répond à aucune touche — ni Tab, ni Entrée, aucun anneau de focus — tout en
n'exposant rien à l'UI Automation : trois descendants, zéro bouton. Elle ne se valide qu'au clic.

La valider à la place de l'utilisateur serait une mauvaise idée : devant un contrat de licence, ce
serait l'accepter pour lui. On prend donc le problème à l'envers. Tant qu'une fenêtre de Steam est
ouverte, **la manette et le clavier pilotent le curseur** (`padmouse.rs`, activé par défaut) :
stick gauche ou flèches pour le déplacer, stick droit ou Page↑/Page↓ pour faire défiler — un
contrat doit être parcouru avant que son bouton s'active —, gâchette ou Maj pour ralentir et viser
une case à cocher, Ⓐ ou Entrée pour cliquer. Les flèches partent lentement puis accélèrent.

La fenêtre est passée au premier plan si l'utilisateur est encore dans 3DSteam, et le curseur est
amené en son centre, et nulle part ailleurs : le choix reste entier. L'Entrée ou le Ⓐ qui a
demandé l'installation ne clique pas s'il est encore enfoncé à l'ouverture.

Steam devient ainsi utilisable à la manette ou au clavier sans Big Picture, quelle que soit la
fenêtre qu'il ouvre et quelle que soit sa disposition. La manette est lue en XInput et le clavier
par `GetAsyncKeyState`, et non par la page, qui ne reçoit plus rien dès qu'elle perd le focus. Le
pilotage s'arrête quand la fenêtre se ferme, si l'utilisateur passe ailleurs, ou au bout de cinq
minutes ; 3DSteam reprend alors la main.

La désinstallation passe de même par `steam://uninstall/<appid>` : Steam demande confirmation dans
sa propre boîte, pilotable pareil, et le jeu quitte la grille en laissant sa case vide.

**Gérer un jeu** : Ⓐ / Entrée sur un jeu installé le démarre ; sur n'importe quel autre jeu, le
menu d'actions s'ouvre au lieu d'agir. Installer lance un téléchargement de plusieurs gigaoctets,
ce n'est pas à déclencher sur une touche pressée par mégarde — et c'est par là qu'on atteint Pause
et Annuler à la manette et au clavier. Le menu s'ouvre aussi par un clic droit sur une case, la
touche Menu ou `O` au clavier, Ⓨ à la manette. Le menu
propose, selon le jeu : Démarrer ou Installer, Pause ou Reprendre, Annuler, Téléchargements Steam,
Afficher les fichiers, Page du magasin, Sortir du dossier, Désinstaller. Sur un dossier : Ouvrir,
Modifier, Supprimer ; sur une case vide du plateau : Nouveau dossier. On s'y déplace aux flèches ou
à la croix, Ⓐ / Entrée valide, Ⓑ / Échap referme.

**Pause, reprise et annulation** (`steamctl.rs`). Steam n'offre aucune commande `steam://` pour
ça : son interface appelle en interne `SteamClient.Downloads.PauseAppUpdate`, `ResumeAppUpdate` ou
`RemoveFromDownloadList`, dans son contexte JavaScript partagé. On ne l'atteint que par le port de
débogage local de Steam, que le client n'ouvre qu'en présence d'un fichier
`.cef-enable-remote-debugging` dans son dossier, à son démarrage — comme le font Decky Loader ou
Millennium. C'est donc un choix de l'utilisateur, désactivé par défaut (⚙ → Steam → Contrôle des
téléchargements, qui pose le fichier et propose de relancer Steam) : une fois le port ouvert,
n'importe quel programme de ce PC peut piloter Steam.

Sans lui, ces actions ouvrent la liste des téléchargements de Steam, pilotable au clavier et à la
manette (Ⓑ ou Échap pour revenir à 3DSteam). Annuler une installation est à part : ce qui a déjà
été reçu doit être effacé, donc elle passe par la boîte de désinstallation de Steam, qui demande
confirmation.

**Installation, comme sur une boutique de console** (`useArrivals.ts`, `DownloadProgress.tsx`) : un jeu
qu'on installe prend place sur le plateau dès le début de son téléchargement. L'écran du haut lui
est alors consacré : à gauche la phase, le pourcentage en grand, les octets, le débit et le temps
restant ; au centre **sa bannière qui se remplit comme un bocal**, la part encore vide en gris,
bordée d'une vague qui ondule, où tombent des blocs de données qui plongent dans la part remplie
pendant que des bulles y remontent, avec un flotteur qui porte le pourcentage à la surface ; à
droite Pause / Reprendre et Annuler. En pause, tout se fige ; en file ou en préparation, un badge
dit ce qu'on attend ; à la vérification et à l'installation, un reflet passe et repasse.

Quand le téléchargement disparaît de la liste, rien ne dit encore s'il est fini ou annulé : le jeu
reste à 100 % jusqu'au scan suivant. Jouable, c'est la fête (la bannière bondit sous une gerbe de
confettis, une étiquette « Prêt à jouer ! », petite fanfare) ; toujours absent du disque, il quitte
le plateau sans bruit.

**Désinstallation** (`Shatter.tsx`) : la tuile se fissure et tremble une demi-seconde, puis vole en
éclats — une grille de triangles un peu tordue, chacun sautant avant de tomber en tournoyant, dans
un nuage de poussière. La bannière de l'écran du haut se fissure de même et bascule hors de l'écran.
La case ne se vide qu'une fois la destruction finie, et seulement pour un jeu qu'on a bien demandé
à désinstaller : un jeu disparu pour une autre raison s'en va sans bruit.

### Lancement d'un jeu

Démarrer un jeu joue une séquence en plein écran (`LaunchSplash.tsx`) : le visuel du jeu envahit
l'écran, l'icône s'envole de sa case et s'écrase au centre (onde de choc, étincelles, vibration de
la manette, fanfare), le logo du jeu apparaît, puis l'icône fonce vers l'écran et un flash blanc se
dissipe sur le noir. **L'écran reste ensuite noir tant que le jeu n'est pas vraiment ouvert**
(`gamewatch.rs`) : Steam note les processus de chaque jeu dans `logs/gameprocess_log.txt`, et le
jeu est ouvert quand l'un d'eux montre une vraie fenêtre. Un jeu qui se referme sans s'être
ouvert, ou qui se fait attendre plus de trois minutes, rend la main avec un message. Un clic, Ⓐ ou
Ⓑ ramènent à 3DSteam à tout moment.

**Un jeu lancé ne se relance pas, et s'arrête depuis 3DSteam.** Le même journal dit quels jeux
tournent : un processus noté par Steam et encore vivant, ou la clé `Running` du registre de Steam
(relu toutes les 2,5 s). Sa tuile porte une pastille verte, l'écran du haut affiche « En cours », et
le démarrer à nouveau ne fait qu'un message. **Arrêter** (écran du haut ou menu de la tuile) demande
à ses fenêtres de se fermer (`WM_CLOSE`, comme la croix : le jeu peut proposer de sauvegarder).
S'il n'est pas fermé six secondes plus tard, ou s'il n'a aucune fenêtre, **Forcer l'arrêt** termine
ses processus. Dans les deux cas, 3DSteam ne vise qu'un processus encore vivant dont l'exécutable
est bien celui que Steam a noté : un numéro de processus repris entre-temps par un autre programme
n'est jamais touché.

### Musique du menu

Une petite musique douce (`menuMusic.ts`), comme celle d'un menu de console, générée à la volée en Web
Audio — aucun fichier, aucun droit d'auteur, et elle ne se répète jamais tout à fait (quatre
accords chauds, une nappe, une basse légère, une mélodie pincée qui change à chaque tour, un peu
d'écho). Elle est discrète par défaut et s'efface d'elle-même quand le lecteur de musique joue, au
lancement d'un jeu, quand 3DSteam n'est plus au premier plan, ou quand les sons sont coupés. Elle
se règle dans ⚙ → Son → Musique du menu.

### Démarrage

⚙ → Démarrage : lancer 3DSteam avec Windows (entrée `Run` du registre de l'utilisateur),
et l'état de la fenêtre à l'ouverture — comme la dernière fois, fenêtre, agrandie, plein écran ou
réduite —, avec une option « réduit quand c'est Windows qui le lance ». Le réglage est appliqué
par Rust avant que la fenêtre ne s'affiche (`startup.rs`, fenêtre créée invisible) : rien ne
clignote. On y règle aussi la grande animation de lancement, et la réduction de 3DSteam une fois
le jeu ouvert.

### Profil et Svgii

À la place d'une photo de profil, un **Svgii**, un avatar à composer pièce par pièce (`mascot.ts`,
`Mascot.tsx`) : forme du visage, teint (réaliste ou pastel), oreilles (humaines, chat, lapin,
ourson, chien, antennes), yeux, bouche, joues roses, coiffure et sa couleur, accessoire (lunettes,
nœud, fleur, casque, couronne, pousse) et couleur préférée, qui l'habille. Tout
est dessiné en SVG, sans aucune image : chaque pièce se cale sur la forme de la tête, et les
franges sont découpées par la tête elle-même, donc toute coiffure va à tout visage.

Le Svgii vit un peu : il respire, cligne des yeux, saute de joie quand un jeu finit de s'installer,
s'excite au lancement d'un jeu, est triste quand on en désinstalle un et s'endort quand 3DSteam
n'est plus au premier plan.

On en crée autant qu'on veut. Celui **en favori** te représente partout : la pastille en haut à
gauche, l'icône de l'appli Profil, les réactions. Les Svgii sont gardés dans le stockage local ;
l'ancien profil à un seul Svgii devient le premier de la collection, et le favori.

**Partager.** Les Svgii des autres n'arrivent que s'ils te les partagent. Un Svgii tient en une
douzaine d'octets (le rang de chaque pièce et de chaque couleur, le nom en UTF-8, une somme de
contrôle), écrits en base 32 de Crockford : un code comme `SVGII-041G0-0020G-00028-4199Q-CSV9D-4G35W-G`,
qu'on recopie sans se tromper (ni I, ni L, ni O, ni U ; casse, espaces et tirets indifférents). On
l'envoie tel quel, ou dans un fichier `.svgii` exporté dans `%APPDATA%\com.threedsteam.launcher\svgii\`.
Chez l'ami : « Coller un code » ou « Importer un fichier ». Un Svgii reçu est marqué « Reçu » : il
reste le sien, il ne se retouche pas et ne peut pas être ton favori. Un code déjà dans la
collection n'est pas ajouté deux fois, un code abîmé est refusé.

La pastille en haut à gauche (le pseudo Steam au premier lancement) ouvre la page **Profil**
(`apps/Profile.tsx`), aussi rangée dans la grille comme une appli, avec ton favori pour icône :

- **Ma carte** : le favori et le bouton qui ouvre l'éditeur (`ProfileEditor.tsx`), où chaque choix
  est montré sur une vignette du Svgii, avec un bouton « Au hasard ».
- **Compte Steam** (`profile.rs`), lu en local, sans réseau ni clé d'API : pseudo, anciens pseudos,
  avatar (le cache `config/avatarcache` du client) et niveau Steam, tous tirés de
  `localconfig.vdf`.
- **Quelques chiffres** : temps de jeu, jeux installés (dont hors Steam), jeu favori, nombre de Svgii.
- **Mes Svgii** : la collection. Un Svgii ouvre sa fiche : le mettre en favori, le modifier, le
  partager (son code, à copier ou exporter en fichier) ou le supprimer — sauf le favori.

### Svgii Plaza

Une appli de la grille (`src/apps/plaza/`), en quatre onglets, tout au clavier et à la manette
(Ⓑ referme d'abord le menu d'un Svgii, puis revient au choix des activités) :

- **La Place** : tous tes Svgii s'y promènent (sauf ceux partis en expédition), avec leurs
  accessoires. Un Svgii ouvre son menu : **Nourrir** (la réserve de nourriture), **Parler** (une
  bulle selon son appétit, votre amitié ou ton dernier jeu lancé), **Équiper** (le Dressing) et
  **Passeport** (origine, arrivée, repas, expéditions, code). Le fond de la Place se choisit parmi
  ceux achetés.
- **Svgii Shop** : on y dépense les **Golds**, gagnés en jouant — le temps de jeu total noté par
  Steam est relevé à chaque visite, et chaque tranche de trois minutes jouées depuis la précédente
  rapporte un Gold (200 offerts à la première visite). Chapeaux, lunettes, auras, nourriture et fonds ;
  chaque accessoire s'essaie sur ton favori avant l'achat.
- **Dressing** : un Svgii, puis un accessoire (ou aucun) par emplacement : chapeau, lunettes, aura.
- **Activités** : **expéditions** (15 min, 1 h ou 4 h : le Svgii revient avec des Golds, parfois
  une friandise, même si l'appli a été fermée entre-temps), **quiz** fabriqué à partir de ta
  bibliothèque (le plus joué, le dernier lancé, les heures passées, le plus gros sur le disque ;
  dix Golds par bonne réponse, une fois par jour) et **combats** automatiques contre un Svgii de
  passage (amitié, accessoires et appétit font la force ; cinq combats récompensés par jour).

Un Svgii a faim au bout d'une journée environ ; affamé, il boude et ne part ni en expédition ni au
combat. Le catalogue est modulaire (`src/lib/svgiiItems.tsx`) : chaque accessoire est un calque
`<g id="item-…">` posé sur le Svgii par `Mascot.tsx`, dans l'un des trois emplacements, et calé sur
la tête qu'il habille (son sommet, sa largeur, la position des yeux) ; ajouter un objet, c'est une
entrée dans `ITEMS`, un dessin, et son nom dans `i18n.tsx`. L'état de la Plaza (`src/lib/plaza.ts`)
est gardé dans le stockage local ; les accessoires restent sur ce PC et ne passent pas dans le code
de partage d'un Svgii. Tout est dessiné en SVG, sans image ni son extraits d'un jeu.

### Applis intégrées

Comme les logiciels d'un menu de console, cinq applis vivent sur le plateau (`src/apps/`). Ce
sont des jeux comme les autres : on les déplace, on les range dans un dossier, on les trie (ouvrir
une appli compte comme y jouer pour « Récents »), on les cherche. Leur numéro est négatif, jamais
celui d'un vrai jeu Steam : rien de ce qui les concerne ne part vers Steam. Ⓐ / Entrée les ouvre en
plein écran ; les flèches et la croix s'y déplacent, Ⓑ / Échap referme.

- **Journal d'activité** : temps de jeu total, des deux dernières semaines (lus dans
  `localconfig.vdf`), classements et dernières sessions. Steam ne garde aucun relevé jour par
  jour : 3DSteam note donc le cumul de chaque jeu à chaque scan, et le temps joué un jour est l'écart
  avec le relevé précédent. Le graphique des sept derniers jours se remplit ainsi au fil des jours
  où 3DSteam est ouvert. Un relevé vide n'est jamais noté, et un jour ne compte jamais plus de
  24 heures : un trou dans les relevés ne passe pas pour une partie. Choisir un jeu y amène le
  curseur.
- **Lecteur de musique** : les bandes-son achetées sur Steam (`steamapps/music`, avec leur
  pochette) et le dossier Musique, rangés en albums. Les titres viennent des étiquettes FLAC et MP3
  (`media.rs`), du nom de fichier sinon ; une bande-son livrée en FLAC et en MP3 n'apparaît qu'une
  fois. La musique continue appli fermée, une pastille dans la barre du haut la montre et la met
  en pause, et elle s'arrête quand un jeu démarre.
- **Album** : les captures Steam (rangées par jeu, avec leurs miniatures), celles de Windows
  (Win + Impr. écran) et celles de la Xbox Game Bar, des plus récentes aux plus anciennes, groupées
  par jour. Ⓐ ouvre une capture en grand, ← → passent à la voisine, Ⓑ revient à la mosaïque.
- **Profil** : ton Svgii favori, ta carte Steam et ta collection de Svgii (voir plus haut).
- **Svgii Plaza** : la Place, la Svgii Shop, le Dressing et les activités (voir plus haut).

`asset://` n'est ouvert que sur ces dossiers-là, au moment où l'appli les liste.

La progression s'affiche en direct (`progress.rs`). Les manifestes n'y suffisent pas : mesuré sur
un téléchargement de 5 Go, Steam n'y réécrit `BytesDownloaded` qu'environ toutes les quatre
minutes, et la pause n'y apparaît pas. Trois sources sont donc croisées :

- les manifestes, pour les totaux, et comme repères exacts quand Steam les réécrit ;
- le journal `logs/content_log.txt`, lu au fil de l'eau, qui donne la phase (en file,
  préparation, téléchargement, vérification, installation, pause) et les compteurs exacts à
  chaque démarrage ;
- entre deux repères, les octets écrits sur disque par `steam.exe` (`GetProcessIoCounters`). Ils
  suivent les octets installés à 1 % près : 2 281 Mo écrits pour 2 252 Mo installés sur la mesure.

Le tout est relu toutes les 0,8 s pendant un téléchargement et toutes les 5 s sinon. L'affichage
prolonge au débit mesuré entre deux relevés, sans jamais reculer. Sur la tuile, l'icône se colore
de bas en haut à mesure qu'elle se remplit, avec un badge de phase et le pourcentage. Une pastille
dans la barre du haut suit le téléchargement en cours d'où qu'on soit ; un clic dessus amène le
curseur sur le jeu, en ouvrant au besoin son dossier. Le jeu passe de lui-même à « jouable » à la
fin. Si 3DSteam est ouvert en plein téléchargement, le point de départ est le dernier repère
connu : la progression peut faire un saut au repère suivant.

Le curseur suit d'ailleurs toujours le jeu qu'il désigne, même quand celui-ci change de case : tri,
installation qui le pose sur le plateau, recherche qui filtre. Seul un déplacement voulu du curseur
change ce qu'il suit.

| Fichier | Rôle |
| --- | --- |
| `src-tauri/src/vdf.rs` | Parseur KeyValues de Valve (+ tests) |
| `src-tauri/src/steam.rs` | Détection de Steam, bibliothèques, manifestes, visuels, catalogue, lancement |
| `src-tauri/src/appinfo.rs` | Cache binaire `appinfo.vdf` : noms, types, empreintes d'icônes (+ tests) |
| `src-tauri/src/progress.rs` | Progression des téléchargements en direct : manifestes, journal, octets écrits (+ tests) |
| `src-tauri/src/steamctl.rs` | Pause, reprise et annulation par le port de débogage de Steam |
| `src-tauri/src/media.rs` | Musique (étiquettes FLAC / MP3, pochettes) et captures d'écran des applis (+ tests) |
| `src-tauri/src/startup.rs` | Démarrage avec Windows, état de la fenêtre à l'ouverture (+ tests) |
| `src-tauri/src/gamewatch.rs` | Jeux lancés, jeu vraiment ouvert, arrêt poli ou forcé (+ tests) |
| `src/apps/` | Applis intégrées : journal d'activité, lecteur de musique, album, profil, Svgii Plaza |
| `src-tauri/src/padmouse.rs` | La manette et le clavier pilotent le curseur devant une fenêtre Steam |
| `src-tauri/src/icons.rs` | Plus grande image d'un `.ico`, icône d'un `.exe`, taille réelle des icônes (+ tests) |
| `src-tauri/src/shortcuts.rs` | Jeux hors Steam ajoutés à Steam : `shortcuts.vdf` binaire, visuels de `grid` (+ tests) |
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
| `src/lib/mascot.ts` / `src/components/Mascot.tsx` | Svgii : pièces, humeur, collection, code de partage, dessin SVG |
| `src/components/ProfileEditor.tsx` | Éditeur de Svgii, pièce par pièce |
| `src/apps/Profile.tsx` | Page Profil, collection de Svgii et partage |
| `src/apps/plaza/` | Svgii Plaza : la Place, la Svgii Shop, le Dressing, les activités |
| `src/lib/plaza.ts` / `src/lib/svgiiItems.tsx` | Golds, soins et expéditions ; catalogue et calques SVG des objets |
| `src-tauri/src/profile.rs` | Profil Steam local : pseudo, anciens pseudos, avatar, niveau (+ tests) |

## Paramètres

Le bouton ⚙ (ou `P`, ou Select à la manette) ouvre les paramètres, rangés en trois groupes :
**Personnaliser** (Thème, Apparence, Son, Langue), **Système** (Démarrage, Steam, Touches) et
**Données** (Sauvegardes, Réinitialiser).

- **Thème** — 14 thèmes livrés (dont Console 16 bits, au format partageable), plus les vôtres, qui
  changent couleurs, fond (motifs, dégradés), panneaux et arrondis :
  Bleu ciel, Givre, Rouge cerise, Jaune citron, Rose bonbon, Forêt enchantée, Rétro crème, Coucher
  de soleil, Écran de poche, Écarlate, Nuit douce, Néon, Indigo. `T` passe au suivant.
- **Sauvegardes** — enregistre sous un nom la disposition actuelle (placement des jeux, dossiers
  et thème), puis la recharge, la remplace, la renomme ou la supprime. Les jeux installés depuis
  une sauvegarde se rangent après son dernier élément au chargement.
- **Touches** — clavier ou manette : dessin de l'appareil (la touche de l'action choisie s'allume)
  et liste des actions ; « Modifier » attend la prochaine touche / le prochain bouton. Une touche
  déjà utilisée est échangée avec l'autre action. Le stick gauche déplace toujours le curseur.
- **Apparence → Icônes** — que faire d'une icône trop petite pour sa case (en dessous des trois quarts) :
  **Plaque** (par défaut) la pose à un multiple *entier* de sa taille sur un fond teinté, donc sans
  rééchantillonnage — étirer du 32 px sur 150 donne sinon des pixels de 4 et de 5 px mélangés ;
  **Plein cadre** l'étire quand même, en pixels francs ; **Lissé** laisse le navigateur interpoler ;
  **Scale2x**, **xBR** et **HQx** l'agrandissent par le calcul (`src/lib/upscale.ts`) ; **Jaquette**
  l'abandonne au profit de la 600×900 recadrée, la seule option en vraie haute résolution.
- **Apparence → Curseur** — cinq façons de signaler l'icône sélectionnée, avec un aperçu de chacune : halo
  doux (par défaut), halo pulsé, contour fin, surélevé, aucun. Le style est posé en attribut
  `data-cursor` sur `<html>` (comme le thème) et se règle dans `src/index.css`, une variable
  d'ombre et une d'animation par style.
- **Langue** — français ou anglais (dates et heures suivent la langue).
- **Son** — bruitages et leur volume, musique du menu.
- **Démarrage** — ouverture de 3DSteam (avec Windows, état de la fenêtre), plein écran, ce qui
  se passe au lancement d'un jeu.
- **Steam** — manette et clavier dans les fenêtres Steam, contrôle direct des téléchargements.
- **Réinitialiser** — réinitialiser la disposition, les préférences, vider le cache des jeux, ou tout
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
reste est complété automatiquement. Exemple complet : le thème Console 16 bits livré,
`src/themes/builtin/seize-bits.3dstheme` :

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

Motifs : `none`, `dots`, `stripes`, `grid`, `checker`, `stars`, `triangles`, `lines`, `scanlines`,
`buttons`. Styles de panneaux : `solid`, `glass`, `border`. Champ facultatif `image` : une image en
`data:image/…;base64`. Pour ajouter un thème livré avec l'application : un fichier dans
`src/themes/builtin/` et une ligne dans `BUILTIN_DEFS` (`src/themes/themes.ts`).

## Contrôles

Tout se fait à la souris, au clavier seul ou à la manette seule (PC branché sur une télé).
Réglages par défaut ci-dessous ; tout est modifiable dans ⚙ → Touches. Sur un écran tactile, toucher
une tuile la sélectionne, la toucher à nouveau la lance. L'interface se resserre d'elle-même sur un
petit écran (dès 854 × 534, l'écran du Steam Deck avec son zoom à 150 %) : marges réduites, textes
secondaires masqués, pastilles réduites à leur icône sous 1280 px de large.

| Action | Souris | Clavier | Manette |
| --- | --- | --- | --- |
| Se déplacer dans la grille (cases vides comprises) | clic | flèches | croix / stick gauche |
| Démarrer un jeu installé / ouvrir un dossier | double-clic ou bouton | Entrée | Ⓐ |
| Retour (fermer le dossier, effacer la recherche) | « ← Retour » | Échap | Ⓑ |
| Prendre / poser une icône | la glisser | Espace (Entrée pose, Échap annule) | Ⓧ (Ⓐ pose, Ⓑ annule) |
| Nouveau dossier (sur une case vide) | « + Dossier » | `N` | Ⓨ |
| Gérer un jeu (installer, pause, annuler, désinstaller…) | clic droit | Entrée, Menu ou `O` | Ⓐ ou Ⓨ |
| Rangées − / + | boutons − / + | `-` / `+` | LB / RB |
| Menus (barre d'outils, écran du haut, barre du haut) | clic | ↑ depuis la 1re rangée, puis flèches | idem |
| Paramètres | ⚙ | `P` | Select |
| Réduire / quitter 3DSteam | bouton ⏻ (en haut à droite) | idem, au clavier | idem, à la croix |
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
