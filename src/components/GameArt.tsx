import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

interface Props {
  sources: string[];
  alt: string;
  className?: string;
  style?: CSSProperties;
  /** Rendu si aucune source ne se charge. */
  fallback?: ReactNode;
  /** Dimensions réelles de l'image chargée. */
  onSize?: (width: number, height: number) => void;
}

/** Délais du filet de sécurité : si une image n'a ni chargé ni échoué, on la redemande. */
const RETRY_DELAYS = [2500, 5000, 8000];

/**
 * <img> qui essaie chaque source l'une après l'autre (cache local → CDN → repli).
 * Filet de sécurité : une requête restée sans réponse (ni `load` ni `error`) est relancée
 * automatiquement, puis abandonnée au profit de la source suivante.
 */
export function GameArt({ sources, alt, className, style, fallback = null, onSize }: Props) {
  const key = sources.join("|");
  // L'état est rattaché à la liste de sources : si elle change, on repart de zéro sans effet
  // (un effet de remise à zéro pourrait masquer une image déjà chargée depuis le cache).
  const [stored, setStored] = useState({ key, index: 0, attempt: 0 });
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const { index, attempt } = stored.key === key ? stored : { index: 0, attempt: 0 };
  const base = sources[index];
  // Une relance change l'URL pour forcer une nouvelle requête (le paramètre est ignoré côté serveur).
  const src = base && attempt ? `${base}${base.includes("?") ? "&" : "?"}retry=${attempt}` : base;
  const loaded = src != null && loadedSrc === src;

  const markLoaded = (img: HTMLImageElement) => {
    setLoadedSrc(img.getAttribute("src"));
    onSize?.(img.naturalWidth, img.naturalHeight);
  };

  useEffect(() => {
    if (!src || loaded) return;
    const timer = window.setTimeout(() => {
      const img = imgRef.current;
      // Chargée sans que l'évènement nous soit parvenu : on l'affiche simplement.
      if (img?.complete && img.naturalWidth > 0) return markLoaded(img);
      setStored(
        attempt < RETRY_DELAYS.length
          ? { key, index, attempt: attempt + 1 }
          : { key, index: index + 1, attempt: 0 },
      );
    }, RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]);
    return () => clearTimeout(timer);
  }, [src, loaded]);

  if (!src) return <>{fallback}</>;

  return (
    <img
      ref={imgRef}
      key={src}
      src={src}
      alt={alt}
      draggable={false}
      style={style}
      decoding="async"
      onLoad={(e) => markLoaded(e.currentTarget)}
      onError={() => setStored({ key, index: index + 1, attempt: 0 })}
      className={`${className ?? ""} transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
    />
  );
}
