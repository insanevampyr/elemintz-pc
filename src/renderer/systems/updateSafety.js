function hasActiveOnlineRoom(state) {
  const room = state?.onlinePlayState?.room;
  return Boolean(room && room.status === "full" && !room.matchComplete);
}

function hasOnlineWarActive(state) {
  return Boolean(state?.onlinePlayState?.room?.warActive);
}

function hasReconnectPaused(state) {
  const room = state?.onlinePlayState?.room;
  return Boolean(
    room &&
      room.status === "paused" &&
      room.disconnectState?.active &&
      room.disconnectState?.expiresAt
  );
}

function hasPendingAdminNotice(state) {
  return Boolean(
    state?.activeAdminGrantNoticeId ||
      (Array.isArray(state?.onlinePlayState?.pendingAdminGrantNotices) &&
        state.onlinePlayState.pendingAdminGrantNotices.length > 0)
  );
}

function hasPendingOnlineRoomAction(state) {
  const pendingActions = state?.onlinePlayState?.room?.pendingActions;
  return Boolean(pendingActions?.host || pendingActions?.guest);
}

function hasPendingOnlineRewardSettlement(state) {
  const room = state?.onlinePlayState?.room;
  if (!room?.matchComplete) {
    return false;
  }

  const settlement = room?.rewardSettlement;
  return Boolean(settlement && settlement.granted !== true);
}

function hasActiveDailyLoginClaimForUpdateSafety(state) {
  if (typeof state?.hasActiveDailyLoginAutoClaimForUpdateSafety === "function") {
    return Boolean(state.hasActiveDailyLoginAutoClaimForUpdateSafety());
  }

  return Boolean(state?.dailyLoginAutoClaimPromise);
}

export function getUpdateSafetyState(state = {}) {
  const reasons = [];
  const viewModel = state?.gameController?.getViewModel?.() ?? null;

  if (viewModel?.status === "active") {
    reasons.push("active_match");
  }

  if (hasActiveOnlineRoom(state)) {
    reasons.push("active_online_match");
  }

  if (viewModel?.warActive || hasOnlineWarActive(state)) {
    reasons.push("active_war");
  }

  if (state?.roundPresentation?.busy) {
    reasons.push("round_presentation_busy");
  }

  if (state?.pendingMatchCompletePayload) {
    reasons.push("pending_match_complete_flow");
  }

  if (state?.profileChestOpenInFlight) {
    reasons.push("chest_open_in_flight");
  }

  if (state?.profileMilestoneChestNoticeOpen) {
    reasons.push("milestone_chest_notice_open");
  }

  if (hasPendingAdminNotice(state)) {
    reasons.push("pending_admin_grant_notice");
  }

  if (state?.onlineReconnectReminder || hasReconnectPaused(state)) {
    reasons.push("reconnect_paused_or_reminder_active");
  }

  if (state?.hasActiveQuitConfirmationModal?.()) {
    reasons.push("quit_confirmation_modal_active");
  }

  if (state?.hasActiveMatchCompleteModal?.()) {
    reasons.push("match_complete_modal_active");
  }

  if (hasPendingOnlineRoomAction(state)) {
    reasons.push("pending_online_room_action");
  }

  if (hasPendingOnlineRewardSettlement(state)) {
    reasons.push("pending_reward_settlement");
  }

  if (hasActiveDailyLoginClaimForUpdateSafety(state)) {
    reasons.push("daily_login_claim_in_flight");
  }

  if (state?.onlinePlayProfileRefreshPromise) {
    reasons.push("online_profile_refresh_in_flight");
  }

  return {
    safe: reasons.length === 0,
    reasons,
    checkedAt: new Date().toISOString()
  };
}

export function isSafeForUpdateRestart(state = {}) {
  return getUpdateSafetyState(state).safe;
}
