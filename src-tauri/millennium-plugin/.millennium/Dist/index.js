// Frontend du pont 3DSteam, chargé par Millennium dans l'interface de Steam, là où vit `SteamClient`.
// Écrit à la main dans la forme qu'attend Millennium (celle de ses plugins compilés).
const MILLENNIUM_IS_CLIENT_MODULE = true;
const pluginName = "3dsteam-bridge";

function InitializePlugins() {
  const list = window.PLUGIN_LIST || (window.PLUGIN_LIST = {});
  list[pluginName] || (list[pluginName] = {});
  window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS || (window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS = {});
}
InitializePlugins();

const __call_server_method__ = (method, args) => Millennium.callServerMethod(pluginName, method, args);

let PluginEntryPointMain = function () {
  return (function (exports, api) {
    "use strict";
    const call = async (method, data) => JSON.parse(await __call_server_method__(method, { payload: JSON.stringify(data ?? null) }));
    /** Identifiant que l'interface de Steam donne à ce PC (les autres sont les PC distants). */
    const CLIENT = "0";
    /** États de l'assistant d'installation de Steam (`EInstallMgrState`). */
    const STATE = { SHOW_CONFIG: 7, SHOW_EULAS: 8, COMPLETE: 14, FAILED: 15, CANCELED: 16 };
    /** États où Steam attend une réponse que seul l'utilisateur peut donner, dans sa fenêtre. */
    const NEEDS_USER = new Set([4 /* clé CD */, 6 /* mot de passe */, 11 /* changer de disque */, 13 /* inscription */]);

    /** Installation demandée par 3DSteam, en attente de l'assistant de Steam. */
    let pendingInstall = null;
    function settle(outcome) {
      const pending = pendingInstall;
      if (!pending) return;
      pendingInstall = null;
      clearTimeout(pending.timer);
      pending.resolve(outcome);
    }

    // L'assistant de Steam passe par plusieurs états. On ne valide que la configuration (dossier,
    // place) d'une installation que 3DSteam a demandée, et seulement si rien n'y pose question :
    // place insuffisante, dossier débranché, contrat de licence ou clé, la fenêtre de Steam reste
    // à l'écran et c'est l'utilisateur qui décide. Un contrat n'est jamais accepté à sa place.
    async function onInstallWizard(state) {
      const pending = pendingInstall;
      if (!pending || !state) return;
      const ours = state.currentAppID === pending.appid || (state.rgApps ?? []).some((app) => app.nAppID === pending.appid);
      if (!ours) return;
      try {
        if (state.eInstallState === STATE.SHOW_CONFIG) {
          let config = state;
          if (Number.isInteger(pending.folder) && pending.folder !== config.iInstallFolder && config.bCanChangeInstallFolder) {
            config = await SteamClient.Installs.SetInstallFolder(pending.folder);
          }
          if (config.nDiskSpaceRequired >= config.nDiskSpaceAvailable) return settle({ started: false, reason: "space" });
          if (config.iUnmountedFolder !== -1) return settle({ started: false, reason: "folder" });
          await SteamClient.Installs.ContinueInstall();
          return settle({ started: true });
        }
        if (state.eInstallState === STATE.SHOW_EULAS) return settle({ started: false, reason: "eula" });
        if (NEEDS_USER.has(state.eInstallState)) return settle({ started: false, reason: "steam" });
        if (state.eInstallState === STATE.COMPLETE) return settle({ started: true });
        if (state.eInstallState === STATE.FAILED || state.eInstallState === STATE.CANCELED) return settle({ started: false, reason: "failed" });
        // Les autres états sont des attentes (licence, informations du jeu) : la suite viendra.
      } catch (e) {
        settle({ started: false, reason: "failed", error: String(e?.message ?? e) });
      }
    }

    // Les seules actions permises.
    const ACTIONS = {
      pause: (cmd) => SteamClient.Downloads.PauseAppUpdate(cmd.appid, CLIENT),
      // Reprendre un jeu ne suffit pas si toute la file est en pause : Steam fait les deux.
      resume: async (cmd) => {
        await SteamClient.Downloads.ResumeAppUpdate(cmd.appid, CLIENT);
        await SteamClient.Downloads.EnableAllDownloads(true, CLIENT);
      },
      remove: (cmd) => SteamClient.Downloads.RemoveFromDownloadList(cmd.appid, CLIENT),
      /** Bibliothèques où installer, avec leur place libre. */
      folders: async () =>
        (await SteamClient.InstallFolder.GetInstallFolders())
          .filter((folder) => folder.bIsMounted)
          .map((folder) => ({
            index: folder.nFolderIndex,
            path: folder.strFolderPath,
            label: folder.strUserLabel || "",
            drive: folder.strDriveName || "",
            free: Number(folder.nFreeSpace),
            isDefault: !!folder.bIsDefaultFolder,
          })),
      install: (cmd) =>
        new Promise((resolve) => {
          settle({ started: false, reason: "replaced" });
          // Sans réponse de Steam, 3DSteam abandonne de lui-même : ce délai ne fait que libérer la place.
          pendingInstall = { appid: cmd.appid, folder: cmd.folder, resolve, timer: setTimeout(() => settle({ started: false, reason: "timeout" }), 30000) };
          SteamClient.Installs.OpenInstallWizard([cmd.appid]);
        }),
      // `true` : la confirmation a déjà eu lieu, dans 3DSteam (c'est ce que fait la boîte de Steam).
      uninstall: (cmd) => SteamClient.Installs.OpenUninstallWizard([cmd.appid], true),
    };
    const NEEDS_APPID = new Set(["pause", "resume", "remove", "install", "uninstall"]);

    async function execute(command) {
      let result;
      try {
        const run = Object.hasOwn(ACTIONS, command.action) ? ACTIONS[command.action] : null;
        if (!run) throw new Error("commande refusée");
        if (NEEDS_APPID.has(command.action) && !(Number.isInteger(command.appid) && command.appid > 0)) throw new Error("jeu invalide");
        if (command.folder != null && !(Number.isInteger(command.folder) && command.folder >= 0)) throw new Error("dossier invalide");
        const data = await run(command);
        result = { id: command.id, ok: true, data: data ?? null };
      } catch (e) {
        result = { id: command.id, ok: false, error: String(e?.message ?? e) };
      }
      await call("report", result);
    }

    let busy = false;
    async function tick() {
      if (busy) return;
      busy = true;
      try {
        const command = await call("poll");
        // Sans attendre : une installation patiente jusqu'à la réponse de Steam, et le battement
        // (écrit par `poll`) ne doit pas s'arrêter pendant ce temps.
        if (command && typeof command.id === "string") void execute(command).catch((e) => console.warn("[3dsteam-bridge]", e));
      } catch (e) {
        console.warn("[3dsteam-bridge]", e);
      } finally {
        busy = false;
      }
    }

    const plugin = api.definePlugin(async () => {
      SteamClient.Installs.RegisterForShowInstallWizard((state) => void onInstallWizard(state));
      setInterval(tick, 500);
      // Pendant un téléchargement, Steam envoie ces nouvelles en continu : une page en arrière-plan
      // dont les minuteurs seraient ralentis répond quand même aussitôt.
      SteamClient.Downloads.RegisterForDownloadOverview(() => void tick());
      return { title: "3DSteam", icon: window.SP_REACT.createElement(api.IconsModule.Settings, null) };
    });
    exports.default = plugin;
    Object.defineProperty(exports, "__esModule", { value: true });
    return exports;
  })({}, window.MILLENNIUM_API);
};

async function ExecutePluginModule() {
  const module = PluginEntryPointMain();
  Object.assign(window.PLUGIN_LIST[pluginName], { ...module, __millennium_internal_plugin_name_do_not_use_or_change__: pluginName });
  const panel = await module.default();
  if (panel && panel.title !== undefined && panel.icon !== undefined && panel.content !== undefined) {
    window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS[pluginName] = panel;
  }
  MILLENNIUM_BACKEND_IPC.postMessage(1, { pluginName });
}
ExecutePluginModule();
