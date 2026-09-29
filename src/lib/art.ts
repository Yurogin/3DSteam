import { convertFileSrc } from "@tauri-apps/api/core";
import { inTauri } from "./api";
import type { Game, GameArt } from "../types";

/** Clés de `GameArt` qui portent un chemin d'image : `iconSize` est une mesure, pas un visuel. */
type ArtKind = { [K in keyof GameArt]-?: string extends NonNullable<GameArt[K]> ? K : never }[keyof GameArt];

/** Fichier équivalent sur le CDN ; l'icône n'existe qu'en local (son nom est une empreinte). */
const CDN_FILES: Record<ArtKind, string | null> = {
  capsule: "library_600x900.jpg",
  hero: "library_hero.jpg",
  logo: "logo.png",
  header: "header.jpg",
  icon: null,
};

const CDNS = [
  "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps",
  "https://cdn.cloudflare.steamstatic.com/steam/apps",
];

/**
 * Liste ordonnée des URLs à essayer : cache local de Steam (via `asset://`), puis CDN.
 * Le composant <GameArt> passe à la suivante en cas d'erreur de chargement.
 */
export function artSources(game: Game, ...kinds: ArtKind[]): string[] {
  const urls: string[] = [];
  for (const kind of kinds) {
    const local = game.art[kind];
    if (local && inTauri) urls.push(convertFileSrc(local));
    const file = CDN_FILES[kind];
    if (file) for (const cdn of CDNS) urls.push(`${cdn}/${game.appid}/${file}`);
  }
  return urls;
}

/** Teinte stable par jeu pour les tuiles sans image. */
export function gameHue(appid: number): number {
  return (appid * 137.508) % 360;
}

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}
