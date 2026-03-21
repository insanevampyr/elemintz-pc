function formatReset(ms, includeDays = false) {
  const safe = Math.max(0, Number(ms) || 0);
  const totalMinutes = Math.floor(safe / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const remaining = totalMinutes - days * 24 * 60;
  const hours = Math.floor(remaining / 60);
  const minutes = remaining % 60;

  if (includeDays && days > 0) {
    return `${days}d ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  return `${String(days * 24 + hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function renderChallenge(challenge, iconText) {
  const status = challenge.completed ? "\u2714 Completed" : "In Progress";
  const cardClass = challenge.completed
    ? "achievement-card unlocked challenge-complete"
    : "achievement-card locked";

  return `
    <article class="${cardClass}">
      <div class="achievement-badge missing challenge-icon">${iconText}</div>
      <div>
        <p><strong>${challenge.name}</strong></p>
        <p>${challenge.description}</p>
        <p>Reward: +${challenge.rewardTokens} token${challenge.rewardTokens === 1 ? "" : "s"}, +${challenge.rewardXp ?? 0} XP</p>
        <p>Progress: ${challenge.progress} / ${challenge.goal}</p>
        <p>${status}</p>
      </div>
    </article>
  `;
}

function getChallengeSummary(bucket) {
  const challenges = bucket?.challenges ?? [];
  const total = challenges.length;
  const completed = challenges.filter((challenge) => challenge?.completed).length;
  return `${completed}/${total}`;
}

function renderSection({ title, iconText, bucket, includeDays }) {
  const challenges = bucket?.challenges ?? [];
  return `
    <section class="stack-sm">
      <h3 class="section-title">${title}</h3>
      <p><strong>${title.replace(" Challenges", "")} - ${getChallengeSummary(bucket)}</strong></p>
      <p>Resets in: <strong>${formatReset(bucket?.msUntilReset ?? 0, includeDays)}</strong></p>
      <div class="achievement-grid">
        ${challenges.map((challenge) => renderChallenge(challenge, iconText)).join("")}
      </div>
    </section>
  `;
}

export const dailyChallengesScreen = {
  render(context) {
    const daily = context.daily ?? { challenges: [], msUntilReset: 0 };
    const weekly = context.weekly ?? { challenges: [], msUntilReset: 0 };

    return `
      <section class="screen screen-daily-challenges">
        <div class="panel">
          <div class="screen-topbar">
            <h2 class="view-title">Challenges</h2>
            <button id="daily-challenges-back-btn" class="btn screen-back-btn">Back to Menu</button>
          </div>
          <p>Tokens: <strong>${context.tokens ?? 0}</strong></p>
          ${renderSection({
            title: "Daily Challenges",
            iconText: "\u2B50",
            bucket: daily,
            includeDays: false
          })}
          ${renderSection({
            title: "Weekly Challenges",
            iconText: "\uD83C\uDFC6",
            bucket: weekly,
            includeDays: true
          })}
        </div>
      </section>
    `;
  },
  bind(context) {
    document
      .getElementById("daily-challenges-back-btn")
      .addEventListener("click", context.actions.back);
  }
};
