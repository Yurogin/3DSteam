import { useEffect, useState } from "react";
import { GameArt } from "./GameArt";
import { AppIcon } from "../apps/builtin";
import { artSources, gameHue, initials } from "../lib/art";
import { useIconStyle } from "../lib/iconStyle";
import { upscaled, type Upscaler } from "../lib/upscale";
import type { Game } from "../types";

/** En dessous de cette part de la tuile, une icône est jugée trop petite pour la remplir. */
const SMALL_BELOW = 0.75;
/** Part de la tuile qu'occupe alors l'icône en mode « plaque » : le reste fait la marge. */
const PLATE_FILL = 0.72;

/**
 * Visuel carré d'un jeu : son icône (celle de la liste Steam), sinon la jaquette recadrée,
 * sinon ses initiales. Remplit son parent (qui doit être positionné). `size` = côté affiché (px).
 *
 * Plus de la moitié des icônes de Steam ne dépassent pas 32 px, pour des cases qui en font cinq
 * fois plus. Il n'y a pas de bon traitement universel — voir `iconStyle.ts` pour les cinq au choix.
 */
export function GameIcon({ game, size }: { game: Game; size: number }) {
  // Une appli intégrée a son icône dessinée : ni cache Steam, ni CDN.
  return game.builtin ? <AppIcon id={game.builtin} /> : <SteamIcon game={game} size={size} />;
}

function SteamIcon({ game, size }: { game: Game; size: number }) {
  const { style } = useIconStyle();
  /** Côté réel de l'icône, mesuré au chargement ; le scan le connaît souvent déjà (`iconSize`). */
  const [natural, setNatural] = useState<number | null>(null);
  const [scaled, setScaled] = useState<string | null>(null);
  const hue = gameHue(game.appid);

  /** Les trois traitements calculés partagent la même mécanique, seule la règle change. */
  const algo: Upscaler | null = style === "scale2x" || style === "xbr" || style === "hqx" ? style : null;
  const known = game.art.iconSize ?? natural;
  const small = known != null && known < size * SMALL_BELOW;
  const iconSource = artSources(game, "icon")[0];

  // Calculé une seule fois par icône et par algorithme, hors rendu. `null` = impossible
  // (canevas teinté) : on reste alors sur le plein cadre.
  useEffect(() => {
    if (!algo || !small || !iconSource) return;
    let alive = true;
    setScaled(null);
    void upscaled(iconSource, algo).then((url) => alive && setScaled(url));
    return () => {
      alive = false;
    };
  }, [algo, small, iconSource]);

  const cover = "absolute inset-0 h-full w-full object-cover";
  const plate = small && style === "plate" && natural != null;
  const side = plate && known ? known * Math.max(1, Math.floor((size * PLATE_FILL) / known)) : 0;

  const initialsTile = (
    <div
      className="absolute inset-0 grid place-items-center font-black text-white"
      style={{
        background: `linear-gradient(145deg, hsl(${hue} 75% 66%), hsl(${(hue + 40) % 360} 70% 52%))`,
        fontSize: size * 0.3,
      }}
    >
      {initials(game.name)}
    </div>
  );

  // Jaquette : on ne passe pas du tout par l'icône, la 600×900 a de vrais pixels à revendre.
  if (small && style === "capsule") {
    return (
      <GameArt
        sources={artSources(game, "capsule", "header")}
        alt=""
        className={`${cover} object-[50%_22%]`}
        fallback={initialsTile}
      />
    );
  }

  // Agrandissement prêt : l'image calculée remplace l'icône, la chaîne de repli n'a plus lieu d'être.
  if (small && algo && scaled) {
    return <img src={scaled} alt="" draggable={false} className={cover} />;
  }

  return (
    <>
      {plate && (
        <span
          className="absolute inset-0"
          style={{
            background: `linear-gradient(145deg, hsl(${hue} 70% 60% / 0.28), hsl(${(hue + 40) % 360} 65% 45% / 0.12)), var(--surface-2)`,
          }}
        />
      )}
      <GameArt
        sources={artSources(game, "icon")}
        alt=""
        onSize={(width) => setNatural(width)}
        className={plate ? "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" : cover}
        style={
          plate
            ? { width: side, height: side, imageRendering: "pixelated" }
            : // « Lissé » laisse le navigateur interpoler ; les autres gardent des pixels francs.
              small && style !== "smooth"
              ? { imageRendering: "pixelated" }
              : undefined
        }
        fallback={
          <GameArt
            sources={artSources(game, "capsule", "header")}
            alt=""
            className={`${cover} object-[50%_22%]`}
            fallback={initialsTile}
          />
        }
      />
    </>
  );
}
