import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Placeholder, SectionTitle } from "./AppWindow";
import { clock, currentTrack, player, usePlayer } from "./player";
import { mediaSrc, musicLibrary } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { sound } from "../lib/sound";
import type { Track } from "../types";

interface Album {
  key: string;
  name: string;
  artist: string | null;
  cover: string | null;
  source: Track["source"];
  tracks: Track[];
}

/** Les pistes, réunies en albums : les bandes-son Steam d'abord, puis le dossier Musique. */
function albumsOf(tracks: Track[]): Album[] {
  const map = new Map<string, Album>();
  for (const track of tracks) {
    const key = `${track.source}:${track.album.toLowerCase()}`;
    const album = map.get(key) ?? { key, name: track.album, artist: track.artist, cover: track.cover, source: track.source, tracks: [] };
    album.cover ??= track.cover;
    album.artist ??= track.artist;
    album.tracks.push(track);
    map.set(key, album);
  }
  const albums = [...map.values()];
  for (const album of albums) {
    album.tracks.sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || a.title.localeCompare(b.title));
  }
  return albums.sort((a, b) => (a.source === b.source ? a.name.localeCompare(b.name) : a.source === "soundtrack" ? -1 : 1));
}

/** Pochette : l'image du dossier, sinon un disque aux couleurs de l'appli. */
function Cover({ src, className = "" }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`relative block overflow-hidden bg-linear-to-br from-[#ffa94d] to-[#ff5d8f] ${className}`}>
      {src && !failed ? (
        <img src={mediaSrc(src)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <svg viewBox="0 0 24 24" className="absolute inset-0 m-auto h-1/2 w-1/2 text-white/90" fill="currentColor" aria-hidden>
          <path d="M9 18V6l11-2v12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="6.5" cy="18" r="2.8" />
          <circle cx="17.5" cy="16" r="2.8" />
        </svg>
      )}
    </span>
  );
}

/**
 * Lecteur de musique, comme l'appli musique d'une console : les bandes-son achetées sur Steam et le
 * dossier Musique, rangés en albums. La lecture continue une fois l'appli fermée.
 */
export function MusicPlayer() {
  const { t, tn } = useI18n();
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const state = usePlayer();
  const now = currentTrack(state);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void musicLibrary()
      .then((list) => alive && setTracks(list))
      .catch(() => alive && setTracks([]));
    return () => {
      alive = false;
    };
  }, []);

  const albums = useMemo(() => albumsOf(tracks ?? []), [tracks]);
  const nowKey = now ? `${now.source}:${now.album.toLowerCase()}` : null;
  const album = albums.find((a) => a.key === (picked ?? nowKey)) ?? albums[0];

  if (!tracks) return <Placeholder>{t("loading")}</Placeholder>;
  if (!albums.length) return <Placeholder>{t("musicEmpty")}</Placeholder>;

  return (
    <div className="grid min-h-full gap-6 p-5 sm:p-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <NowPlaying />
      <div className="flex min-w-0 flex-col gap-6">
        <section>
          <SectionTitle aside={tn("albums", albums.length)}>{t("musicAlbums")}</SectionTitle>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
            {albums.map((a) => {
              const current = a.key === album?.key;
              return (
                <button
                  key={a.key}
                  type="button"
                  aria-current={current || undefined}
                  onMouseEnter={() => sound.hover()}
                  onClick={() => {
                    sound.select();
                    setPicked(a.key);
                  }}
                  className={`group flex flex-col gap-2 rounded-2xl p-2 text-left outline-none transition-colors focus:bg-accent-soft ${current ? "bg-accent-soft" : "hover:bg-surface-2"}`}
                >
                  <Cover src={a.cover} className="aspect-square w-full rounded-xl shadow-soft" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-extrabold text-ink">{a.name}</span>
                    <span className="block truncate text-xs font-bold text-muted">
                      {a.source === "soundtrack" ? t("musicSoundtrack") : t("musicFolder")} · {tn("tracks", a.tracks.length)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        {album && (
          <section>
            <SectionTitle aside={album.artist ?? undefined}>{album.name}</SectionTitle>
            <ol className="flex flex-col">
              {album.tracks.map((track, i) => {
                const playing = now?.path === track.path;
                return (
                  <li key={track.path}>
                    <button
                      type="button"
                      onMouseEnter={() => sound.hover()}
                      onClick={() => {
                        sound.select();
                        player.play(album.tracks, i);
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none focus:bg-accent-soft ${playing ? "text-accent-strong" : "text-ink hover:bg-surface-2"}`}
                    >
                      <span className="w-6 shrink-0 text-right text-sm font-black tabular-nums text-muted">
                        {playing ? <Equalizer active={state.playing} small /> : (track.number ?? i + 1)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-extrabold">{track.title}</span>
                      {track.artist && track.artist !== album.artist && (
                        <span className="hidden max-w-48 truncate text-xs font-bold text-muted sm:block">{track.artist}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}

/** Lecture en cours : pochette, titre, progression, commandes. */
function NowPlaying() {
  const { t } = useI18n();
  const state = usePlayer();
  const now = currentTrack(state);
  return (
    <aside className="flex flex-col gap-4 self-start rounded-3xl bg-surface-2 p-4 lg:sticky lg:top-0">
      <div className="relative">
        <motion.div
          key={now?.path ?? "none"}
          initial={{ scale: 0.9, opacity: 0, rotate: -3 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          <Cover src={now?.cover ?? null} className="aspect-square w-full rounded-2xl shadow-pop" />
        </motion.div>
        {now && (
          <span className="absolute bottom-3 left-3 rounded-full bg-black/50 px-2.5 py-1.5 backdrop-blur-sm">
            <Equalizer active={state.playing} />
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-lg font-black text-ink">{now?.title ?? t("musicNothing")}</p>
        <p className="truncate text-sm font-bold text-muted">{now ? [now.artist, now.album].filter(Boolean).join(" · ") : t("musicPick")}</p>
      </div>
      <div>
        <input
          type="range"
          aria-label={t("musicSeek")}
          min={0}
          max={Math.max(1, Math.round(state.duration))}
          value={Math.round(state.time)}
          disabled={!now}
          onChange={(e) => player.seek(Number(e.target.value))}
          className="w-full accent-(--accent)"
        />
        <div className="flex justify-between text-xs font-bold tabular-nums text-muted">
          <span>{clock(state.time)}</span>
          <span>{clock(state.duration)}</span>
        </div>
      </div>
      <div className="flex items-center justify-center gap-3">
        <RoundButton label={t("musicPrevious")} onClick={() => player.previous()} disabled={!now}>
          <path d="M6 5v14M19 6 9 12l10 6V6Z" />
        </RoundButton>
        <RoundButton label={state.playing ? t("musicPause") : t("musicPlay")} onClick={() => player.toggle()} disabled={!now} big>
          {state.playing ? <path d="M8 5v14M16 5v14" /> : <path d="M7 5v14l12-7L7 5Z" />}
        </RoundButton>
        <RoundButton label={t("musicNext")} onClick={() => player.next()} disabled={!now}>
          <path d="M18 5v14M5 6l10 6-10 6V6Z" />
        </RoundButton>
      </div>
      <label className="flex items-center gap-2 text-xs font-bold text-muted">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        </svg>
        <input
          type="range"
          aria-label={t("volume")}
          min={0}
          max={100}
          value={Math.round(state.volume * 100)}
          onChange={(e) => player.setVolume(Number(e.target.value) / 100)}
          className="flex-1 accent-(--accent)"
        />
      </label>
    </aside>
  );
}

function RoundButton({ label, onClick, disabled, big, children }: { label: string; onClick: () => void; disabled?: boolean; big?: boolean; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseEnter={() => sound.hover()}
      onClick={onClick}
      whileTap={{ scale: 0.9 }}
      className={`grid place-items-center rounded-full shadow-soft disabled:opacity-40 ${big ? "h-14 w-14 bg-accent text-on-accent" : "h-11 w-11 bg-surface text-ink"}`}
    >
      <svg viewBox="0 0 24 24" width={big ? 26 : 20} height={big ? 26 : 20} fill="currentColor" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </motion.button>
  );
}

/**
 * Pastille de la barre du haut : la musique continue appli fermée, on la voit et on la met en
 * pause d'ici ; un clic sur le titre rouvre le lecteur.
 */
export function MusicPill({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const state = usePlayer();
  const now = currentTrack(state);
  return (
    <AnimatePresence>
      {now && (
        <motion.div
          className="flex h-10 shrink-0 items-center gap-1 rounded-full bg-surface py-1 pl-3 pr-1 shadow-soft xl:min-w-0 xl:max-w-44 xl:shrink"
          initial={{ opacity: 0, scale: 0.8, x: 12 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          exit={{ opacity: 0, scale: 0.8, x: 12 }}
          transition={{ type: "spring", stiffness: 420, damping: 28 }}
        >
          <button
            type="button"
            onMouseEnter={() => sound.hover()}
            onClick={onOpen}
            title={now.title}
            className="flex min-w-0 items-center gap-2 text-sm font-extrabold text-ink"
          >
            <Equalizer active={state.playing} small />
            {/* Fenêtre étroite : l'égaliseur seul, le titre est dans l'infobulle. */}
            <span className="hidden truncate xl:block">{now.title}</span>
          </button>
          <button
            type="button"
            aria-label={state.playing ? t("musicPause") : t("musicPlay")}
            onMouseEnter={() => sound.hover()}
            onClick={() => player.toggle()}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-strong"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {state.playing ? <path d="M8 5v14M16 5v14" /> : <path d="M7 5v14l12-7L7 5Z" />}
            </svg>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Petit égaliseur animé : il danse pendant la lecture et se fige en pause. */
export function Equalizer({ active, small }: { active: boolean; small?: boolean }) {
  return (
    <span className={`inline-flex items-end gap-[2px] ${small ? "h-3" : "h-4"} ${active ? "" : "eq-paused"}`} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={`eq-bar ${small ? "w-[2px]" : "w-[3px]"} rounded-full ${small ? "bg-accent" : "bg-white"}`} style={{ animationDelay: `${i * -0.23}s` }} />
      ))}
    </span>
  );
}
