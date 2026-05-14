import electronUpdater from "electron-updater";
import { normalizeUpdaterError } from "./errorNormalization.js";

export class UpdaterAdapter {
  constructor({
    store,
    updater = null,
    logger = console,
    isPackaged = false,
    hasPublishConfiguration = false,
    publishConfiguration = null
  } = {}) {
    if (!store) {
      throw new Error("UpdaterAdapter requires an update lifecycle store.");
    }

    this.store = store;
    this.updater = updater ?? electronUpdater.autoUpdater;
    this.logger = logger ?? console;
    this.isPackaged = Boolean(isPackaged);
    this.hasPublishConfiguration = Boolean(hasPublishConfiguration);
    this.publishConfiguration = publishConfiguration && typeof publishConfiguration === "object" ? { ...publishConfiguration } : null;
    this.bound = false;
    this.downloadInFlight = false;
    this.installInFlight = false;
    this.lastLoggedDownloadPercent = null;

    this.configureUpdater();
    this.bindUpdaterEvents();
  }

  logInfo(message, details = {}) {
    this.logger.info?.(`[Updater] ${message}`, details);
  }

  logError(message, details = {}) {
    this.logger.error?.(`[Updater] ${message}`, details);
  }

  configureUpdater() {
    if (!this.updater || typeof this.updater !== "object") {
      return;
    }

    if ("autoDownload" in this.updater) {
      this.updater.autoDownload = false;
    }

    if ("autoInstallOnAppQuit" in this.updater) {
      this.updater.autoInstallOnAppQuit = false;
    }
  }

  bindUpdaterEvents() {
    if (this.bound || !this.updater?.on) {
      return;
    }

    this.bound = true;

    this.updater.on("checking-for-update", () => {
      this.logInfo("check started", {
        isPackaged: this.isPackaged
      });
      this.store.markChecking("Checking for updates...");
    });

    this.updater.on("update-available", (updateInfo) => {
      this.logInfo("update available", {
        version: updateInfo?.version ?? null
      });
      this.store.markUpdateAvailable(updateInfo, "Update available.");
      Promise.resolve(this.requestDownload({ source: "auto-update-available" })).catch((error) => {
        const normalizedError = normalizeUpdaterError(error);
        this.logError("auto-download failed", {
          code: normalizedError.code ?? null,
          message: normalizedError.message
        });
      });
    });

    this.updater.on("update-not-available", (updateInfo) => {
      this.downloadInFlight = false;
      this.logInfo("update not available", {
        version: updateInfo?.version ?? null
      });
      this.store.markNoUpdateAvailable("No updates available.");
      if (updateInfo) {
        this.store.setState({
          updateInfo
        });
      }
    });

    this.updater.on("download-progress", (progress) => {
      const nextPercent = Number(progress?.percent ?? 0);
      const roundedPercent = Number.isFinite(nextPercent) ? Math.max(0, Math.min(100, Math.round(nextPercent))) : null;
      const shouldLogProgress =
        roundedPercent != null &&
        (
          this.lastLoggedDownloadPercent == null ||
          roundedPercent === 100 ||
          roundedPercent >= this.lastLoggedDownloadPercent + 10
        );
      if (shouldLogProgress) {
        this.lastLoggedDownloadPercent = roundedPercent;
        this.logInfo("download progress", {
          percent: roundedPercent,
          transferred: Number(progress?.transferred ?? 0) || 0,
          total: Number(progress?.total ?? 0) || 0,
          bytesPerSecond: Number(progress?.bytesPerSecond ?? 0) || 0
        });
      }
      this.store.markDownloading(progress, "Update download in progress.");
    });

    this.updater.on("update-downloaded", (updateInfo) => {
      this.downloadInFlight = false;
      this.lastLoggedDownloadPercent = 100;
      this.logInfo("update downloaded", {
        version: updateInfo?.version ?? null
      });
      this.store.markDownloaded(updateInfo, null, "Update downloaded and waiting for a safe install window.");
    });

    this.updater.on("error", (error) => {
      this.downloadInFlight = false;
      this.lastLoggedDownloadPercent = null;
      const normalizedError = normalizeUpdaterError(error);
      this.logError("error", {
        code: normalizedError.code ?? null,
        message: normalizedError.message
      });
      this.store.markError(normalizedError, normalizedError.message);
    });
  }

  getState() {
    return this.store.getState();
  }

  async requestCheck() {
    if (!this.isPackaged) {
      this.logInfo("startup/manual check skipped in dev or unpackaged mode", {
        isPackaged: this.isPackaged
      });
      return this.store.setState({
        status: "idle",
        message: "Update checks are disabled in dev/unpackaged builds.",
        error: null,
        lastCheckedAt: new Date().toISOString()
      });
    }

    if (!this.hasPublishConfiguration) {
      this.logError("check failed: publish configuration missing");
      return this.store.markError(
        {
          message: "Update publish configuration is missing.",
          code: "ERR_UPDATER_PUBLISH_CONFIG_MISSING"
        },
        "Update publish configuration is missing."
      );
    }

    try {
      this.logInfo("requestCheck invoked", {
        hasPublishConfiguration: this.hasPublishConfiguration
      });
      this.store.markChecking("Checking for updates...");
      if (this.publishConfiguration && typeof this.updater?.setFeedURL === "function") {
        this.updater.setFeedURL(this.publishConfiguration);
      }
      await this.updater.checkForUpdates();
      return this.store.getState();
    } catch (error) {
      const normalizedError = normalizeUpdaterError(error);
      this.logError("check failed", {
        code: normalizedError.code ?? null,
        message: normalizedError.message
      });
      return this.store.markError(normalizedError, normalizedError.message);
    }
  }

  async requestDownload({ source = "manual" } = {}) {
    const currentState = this.store.getState();

    if (!this.isPackaged) {
      this.logInfo("download skipped", {
        source,
        reason: "dev_or_unpackaged",
        isPackaged: this.isPackaged
      });
      return this.store.setState({
        message: "Update downloads are disabled in dev/unpackaged builds.",
        error: null
      });
    }

    if (!this.hasPublishConfiguration) {
      this.logError("download skipped", {
        source,
        reason: "publish_configuration_missing"
      });
      return this.store.markError(
        {
          message: "Update publish configuration is missing.",
          code: "ERR_UPDATER_PUBLISH_CONFIG_MISSING"
        },
        "Update publish configuration is missing."
      );
    }

    if (this.downloadInFlight || currentState.status === "downloading") {
      this.logInfo("download skipped", {
        source,
        reason: "already_in_progress"
      });
      return this.store.setState({
        message: "Update download already in progress.",
        error: null
      });
    }

    if (currentState.status !== "available") {
      this.logInfo("download skipped", {
        source,
        reason: "no_available_update",
        status: currentState.status ?? null
      });
      return this.store.markError(
        {
          message: "No available update to download.",
          code: "ERR_UPDATER_NO_AVAILABLE_UPDATE"
        },
        "No available update to download."
      );
    }

    if (typeof this.updater?.downloadUpdate !== "function") {
      this.logError("download skipped", {
        source,
        reason: "download_unavailable"
      });
      return this.store.markError(
        {
          message: "Updater download is unavailable in this runtime.",
          code: "ERR_UPDATER_DOWNLOAD_UNAVAILABLE"
        },
        "Updater download is unavailable in this runtime."
      );
    }

    try {
      this.downloadInFlight = true;
      this.lastLoggedDownloadPercent = null;
      this.logInfo("download started", {
        source,
        version: currentState.updateInfo?.version ?? null
      });
      this.store.markDownloading(currentState.downloadProgress, "Starting update download...");
      await this.updater.downloadUpdate();
      return this.store.getState();
    } catch (error) {
      this.downloadInFlight = false;
      this.lastLoggedDownloadPercent = null;
      const normalizedError = normalizeUpdaterError(error);
      this.logError("download failed", {
        source,
        code: normalizedError.code ?? null,
        message: normalizedError.message
      });
      return this.store.markError(normalizedError, normalizedError.message);
    }
  }

  async requestInstall(safetyState = null) {
    const currentState = this.store.getState();
    const normalizedSafetyState =
      safetyState && typeof safetyState === "object"
        ? {
            safe: Boolean(safetyState.safe),
            reasons: Array.isArray(safetyState.reasons) ? [...safetyState.reasons] : [],
            checkedAt: safetyState.checkedAt ?? null
          }
        : {
            safe: false,
            reasons: ["missing_safety_state"],
            checkedAt: null
          };

    if (!["downloaded", "deferred", "readyToInstall"].includes(currentState.status)) {
      this.logInfo("requestInstall blocked", {
        reason: "no_downloaded_update",
        status: currentState.status ?? null
      });
      return this.store.markError(
        {
          message: "No downloaded update is ready to install.",
          code: "ERR_UPDATER_NO_DOWNLOADED_UPDATE"
        },
        "No downloaded update is ready to install."
      );
    }

    if (this.installInFlight) {
      this.logInfo("requestInstall skipped", {
        reason: "install_already_requested"
      });
      return this.store.setState({
        message: "Update install already requested.",
        error: null
      });
    }

    if (!normalizedSafetyState.safe) {
      this.logInfo("requestInstall blocked", {
        reason: "unsafe_restart_window",
        safetyReasons: normalizedSafetyState.reasons
      });
      if (currentState.deferredUntilSafe) {
        return this.store.setState({
          message: "Update install already deferred until the app is safe.",
          error: null,
          restartRequested: true,
          deferredUntilSafe: true
        });
      }

      return this.store.markInstallDeferred("Update install requested. Waiting for a safe restart window.");
    }

    if (typeof this.updater?.quitAndInstall !== "function") {
      this.logError("requestInstall blocked", {
        reason: "install_unavailable"
      });
      return this.store.markError(
        {
          message: "Updater install is unavailable in this runtime.",
          code: "ERR_UPDATER_INSTALL_UNAVAILABLE"
        },
        "Updater install is unavailable in this runtime."
      );
    }

    try {
      this.installInFlight = true;
      const nextState = this.store.setState({
        status: "readyToInstall",
        message: "Update install approved. Restarting to install update.",
        error: null,
        restartRequested: true,
        deferredUntilSafe: false
      });
      this.logInfo("quitAndInstall invoked", {
        version: currentState.updateInfo?.version ?? nextState.updateInfo?.version ?? null
      });
      this.updater.quitAndInstall();
      return nextState;
    } catch (error) {
      this.installInFlight = false;
      const normalizedError = normalizeUpdaterError(error);
      return this.store.markError(normalizedError, normalizedError.message);
    }
  }
}

export function createUpdaterAdapter(options = {}) {
  return new UpdaterAdapter(options);
}
