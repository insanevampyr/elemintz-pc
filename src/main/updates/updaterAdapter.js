import electronUpdater from "electron-updater";
import { normalizeUpdaterError } from "./errorNormalization.js";

export class UpdaterAdapter {
  constructor({
    store,
    updater = null,
    isPackaged = false,
    hasPublishConfiguration = false,
    publishConfiguration = null
  } = {}) {
    if (!store) {
      throw new Error("UpdaterAdapter requires an update lifecycle store.");
    }

    this.store = store;
    this.updater = updater ?? electronUpdater.autoUpdater;
    this.isPackaged = Boolean(isPackaged);
    this.hasPublishConfiguration = Boolean(hasPublishConfiguration);
    this.publishConfiguration = publishConfiguration && typeof publishConfiguration === "object" ? { ...publishConfiguration } : null;
    this.bound = false;
    this.downloadInFlight = false;
    this.installInFlight = false;

    this.configureUpdater();
    this.bindUpdaterEvents();
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
      this.store.markChecking("Checking for updates...");
    });

    this.updater.on("update-available", (updateInfo) => {
      this.store.markUpdateAvailable(updateInfo, "Update available.");
    });

    this.updater.on("update-not-available", (updateInfo) => {
      this.downloadInFlight = false;
      this.store.markNoUpdateAvailable("No updates available.");
      if (updateInfo) {
        this.store.setState({
          updateInfo
        });
      }
    });

    this.updater.on("download-progress", (progress) => {
      this.store.markDownloading(progress, "Update download in progress.");
    });

    this.updater.on("update-downloaded", (updateInfo) => {
      this.downloadInFlight = false;
      this.store.markDownloaded(updateInfo, null, "Update downloaded and waiting for a safe install window.");
    });

    this.updater.on("error", (error) => {
      this.downloadInFlight = false;
      const normalizedError = normalizeUpdaterError(error);
      this.store.markError(normalizedError, normalizedError.message);
    });
  }

  getState() {
    return this.store.getState();
  }

  async requestCheck() {
    if (!this.isPackaged) {
      return this.store.setState({
        status: "idle",
        message: "Update checks are disabled in dev/unpackaged builds.",
        error: null,
        lastCheckedAt: new Date().toISOString()
      });
    }

    if (!this.hasPublishConfiguration) {
      return this.store.markError(
        {
          message: "Update publish configuration is missing.",
          code: "ERR_UPDATER_PUBLISH_CONFIG_MISSING"
        },
        "Update publish configuration is missing."
      );
    }

    try {
      this.store.markChecking("Checking for updates...");
      if (this.publishConfiguration && typeof this.updater?.setFeedURL === "function") {
        this.updater.setFeedURL(this.publishConfiguration);
      }
      await this.updater.checkForUpdates();
      return this.store.getState();
    } catch (error) {
      const normalizedError = normalizeUpdaterError(error);
      return this.store.markError(normalizedError, normalizedError.message);
    }
  }

  async requestDownload() {
    const currentState = this.store.getState();

    if (!this.isPackaged) {
      return this.store.setState({
        message: "Update downloads are disabled in dev/unpackaged builds.",
        error: null
      });
    }

    if (!this.hasPublishConfiguration) {
      return this.store.markError(
        {
          message: "Update publish configuration is missing.",
          code: "ERR_UPDATER_PUBLISH_CONFIG_MISSING"
        },
        "Update publish configuration is missing."
      );
    }

    if (this.downloadInFlight || currentState.status === "downloading") {
      return this.store.setState({
        message: "Update download already in progress.",
        error: null
      });
    }

    if (currentState.status !== "available") {
      return this.store.markError(
        {
          message: "No available update to download.",
          code: "ERR_UPDATER_NO_AVAILABLE_UPDATE"
        },
        "No available update to download."
      );
    }

    if (typeof this.updater?.downloadUpdate !== "function") {
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
      this.store.markDownloading(currentState.downloadProgress, "Starting update download...");
      await this.updater.downloadUpdate();
      return this.store.getState();
    } catch (error) {
      this.downloadInFlight = false;
      const normalizedError = normalizeUpdaterError(error);
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
      return this.store.markError(
        {
          message: "No downloaded update is ready to install.",
          code: "ERR_UPDATER_NO_DOWNLOADED_UPDATE"
        },
        "No downloaded update is ready to install."
      );
    }

    if (this.installInFlight) {
      return this.store.setState({
        message: "Update install already requested.",
        error: null
      });
    }

    if (!normalizedSafetyState.safe) {
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
