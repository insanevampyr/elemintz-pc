function buildBaseState() {
  const now = new Date().toISOString();
  return {
    status: "idle",
    message: "",
    error: null,
    updateInfo: null,
    downloadProgress: null,
    restartRequested: false,
    deferredUntilSafe: false,
    lastCheckedAt: null,
    updatedAt: now
  };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export class UpdateLifecycleStore {
  constructor(initialState = null) {
    this.subscribers = new Set();
    this.state = {
      ...buildBaseState(),
      ...(initialState && typeof initialState === "object" ? clone(initialState) : {})
    };
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }

    this.subscribers.add(listener);
    listener(this.getState());
    return () => {
      this.subscribers.delete(listener);
    };
  }

  getState() {
    return clone(this.state);
  }

  setState(patch = {}) {
    const nextPatch = patch && typeof patch === "object" ? patch : {};
    this.state = {
      ...this.state,
      ...clone(nextPatch),
      updatedAt: new Date().toISOString()
    };
    const snapshot = this.getState();
    for (const listener of this.subscribers) {
      listener(snapshot);
    }
    return snapshot;
  }

  markChecking(message = "Update checks are not implemented yet.") {
    const now = new Date().toISOString();
    return this.setState({
      status: "checking",
      message,
      error: null,
      lastCheckedAt: now
    });
  }

  markUpdateAvailable(updateInfo = null, message = "Update available.") {
    return this.setState({
      status: "available",
      message,
      error: null,
      updateInfo: updateInfo ? clone(updateInfo) : null,
      downloadProgress: null
    });
  }

  markNoUpdateAvailable(message = "No updates available.") {
    return this.setState({
      status: "idle",
      message,
      error: null,
      downloadProgress: null
    });
  }

  markDownloading(downloadProgress = null, message = "Update download in progress.") {
    return this.setState({
      status: "downloading",
      message,
      error: null,
      downloadProgress: downloadProgress ? clone(downloadProgress) : null
    });
  }

  markDownloaded(updateInfo = null, downloadProgress = null, message = "Update downloaded and ready when safe.") {
    return this.setState({
      status: "downloaded",
      message,
      error: null,
      updateInfo: updateInfo ? clone(updateInfo) : this.state.updateInfo,
      downloadProgress: downloadProgress ? clone(downloadProgress) : this.state.downloadProgress
    });
  }

  markError(error, message = null) {
    const normalizedError =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message
          }
        : error == null
          ? null
          : {
              message: String(error)
            };

    return this.setState({
      status: "error",
      message: message ?? normalizedError?.message ?? "Update check failed.",
      error: normalizedError
    });
  }

  markInstallDeferred(message = "Update install requested. Waiting for a safe restart window.") {
    return this.setState({
      status: this.state.status === "downloaded" ? "deferred" : this.state.status,
      message,
      restartRequested: true,
      deferredUntilSafe: true,
      error: null
    });
  }

  clearDeferredInstall(message = "Deferred update install cleared.") {
    return this.setState({
      status: this.state.status === "deferred" ? "downloaded" : this.state.status,
      message,
      restartRequested: false,
      deferredUntilSafe: false,
      error: null
    });
  }

  markMockDownloaded({
    version = "mock-version",
    notes = "Mock downloaded update for coordination testing."
  } = {}) {
    return this.setState({
      status: "downloaded",
      message: "Mock update marked as downloaded.",
      error: null,
      updateInfo: {
        version,
        notes,
        mock: true
      },
      downloadProgress: {
        percent: 100,
        transferred: 1,
        total: 1,
        bytesPerSecond: 0,
        mock: true
      }
    });
  }
}

export function createUpdateLifecycleStore(initialState = null) {
  return new UpdateLifecycleStore(initialState);
}
