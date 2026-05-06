import { getUpdateSafetyState } from "./updateSafety.js";

export function buildUpdateCoordinatorState({
  lifecycleState = null,
  safetyState = null
} = {}) {
  const lifecycle =
    lifecycleState && typeof lifecycleState === "object"
      ? lifecycleState
      : {
          status: "idle",
          message: "",
          error: null,
          updateInfo: null,
          downloadProgress: null,
          restartRequested: false,
          deferredUntilSafe: false,
          lastCheckedAt: null,
          updatedAt: null
        };

  const safety =
    safetyState && typeof safetyState === "object"
      ? safetyState
      : {
          safe: true,
          reasons: [],
          checkedAt: new Date().toISOString()
        };

  const installRequested = Boolean(lifecycle.restartRequested || lifecycle.deferredUntilSafe);
  const lifecycleAllowsInstall = ["downloaded", "deferred", "readyToInstall"].includes(
    String(lifecycle.status ?? "").trim()
  );
  const installAllowedNow = Boolean(installRequested && lifecycleAllowsInstall && safety.safe);

  return {
    lifecycleState: lifecycle,
    safetyState: safety,
    installAllowedNow,
    blockedReasons: installAllowedNow ? [] : [...(safety.reasons ?? [])],
    deferredUntilSafe: Boolean(lifecycle.deferredUntilSafe)
  };
}

export async function refreshUpdateCoordinatorState(controller) {
  const lifecycleState = (await globalThis.window?.elemintz?.updates?.getState?.()) ?? null;
  const safetyState =
    controller?.getUpdateSafetyState?.() ??
    getUpdateSafetyState(controller ?? {});
  return buildUpdateCoordinatorState({
    lifecycleState,
    safetyState
  });
}

export function buildUpdateDiagnosticsSnapshot(coordinatorState = null) {
  const nextState =
    coordinatorState && typeof coordinatorState === "object"
      ? coordinatorState
      : buildUpdateCoordinatorState();
  const lifecycleState =
    nextState?.lifecycleState && typeof nextState.lifecycleState === "object"
      ? nextState.lifecycleState
      : {};

  return {
    lifecycleStatus: String(lifecycleState.status ?? "idle"),
    message: String(lifecycleState.message ?? ""),
    error: lifecycleState.error ?? null,
    updateInfo: lifecycleState.updateInfo ?? null,
    downloadProgress: lifecycleState.downloadProgress ?? null,
    deferredUntilSafe: Boolean(nextState?.deferredUntilSafe),
    restartRequested: Boolean(lifecycleState.restartRequested),
    installAllowedNow: Boolean(nextState?.installAllowedNow),
    blockedReasons: Array.isArray(nextState?.blockedReasons) ? [...nextState.blockedReasons] : []
  };
}
