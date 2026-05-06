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
      this.store.markDownloaded(updateInfo, null, "Update downloaded and waiting for a safe install window.");
    });

    this.updater.on("error", (error) => {
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
}

export function createUpdaterAdapter(options = {}) {
  return new UpdaterAdapter(options);
}
