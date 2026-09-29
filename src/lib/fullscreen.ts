import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri } from "./api";

/** Plein écran de la fenêtre Tauri, ou de la page dans un navigateur (mode démo). */
export async function isFullscreen(): Promise<boolean> {
  if (inTauri) return getCurrentWindow().isFullscreen();
  return document.fullscreenElement != null;
}

export async function setFullscreen(on: boolean): Promise<void> {
  if (inTauri) return getCurrentWindow().setFullscreen(on);
  if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
  if (!on && document.fullscreenElement) await document.exitFullscreen();
}
