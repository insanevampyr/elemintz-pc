function renderAccordionSection({ id, title, preview, bodyHtml, open = false }) {
  return `
    <details class="panel how-to-play-accordion" data-how-to-play-section="${id}" ${open ? "open" : ""}>
      <summary class="how-to-play-accordion__summary">
        <div class="how-to-play-accordion__summary-copy">
          <h3 class="section-title how-to-play-accordion__title">${title}</h3>
          <p class="how-to-play-accordion__preview">${preview}</p>
        </div>
        <span class="how-to-play-accordion__chevron" aria-hidden="true">+</span>
      </summary>
      <div class="how-to-play-accordion__body how-to-play-copy stack-sm">
        ${bodyHtml}
      </div>
    </details>
  `;
}

const HOW_TO_PLAY_SECTIONS = [
  {
    id: "quick-start",
    title: "Quick Start",
    preview: "Choose an element, win matchups, survive WAR, and finish with the stronger board.",
    open: true,
    bodyHtml: `
      <ul class="how-to-play-list">
        <li>Choose one element card each round.</li>
        <li>Your opponent chooses one at the same time.</li>
        <li>Winning matchups keep your card and capture the other card.</li>
        <li>Matching elements trigger WAR and build a shared pile.</li>
        <li>Win the match by ending with more captured cards or by outlasting the other side when the match closes out.</li>
      </ul>
    `
  },
  {
    id: "element-rules",
    title: "Element Rules",
    preview: "Each element beats one other element. Same element starts WAR. Some pairings are No Effect.",
    open: true,
    bodyHtml: `
      <div class="how-to-play-rule-grid">
        <p><strong>Fire</strong> beats Earth</p>
        <p><strong>Earth</strong> beats Wind</p>
        <p><strong>Wind</strong> beats Water</p>
        <p><strong>Water</strong> beats Fire</p>
      </div>
      <ul class="how-to-play-list">
        <li>Same element vs same element = WAR.</li>
        <li>If neither element beats the other, the round is No Effect.</li>
      </ul>
    `
  },
  {
    id: "round-outcomes",
    title: "Round Outcomes",
    preview: "Wins steal cards, No Effect returns both cards, and ties push the round into WAR.",
    bodyHtml: `
      <ul class="how-to-play-list">
        <li><strong>Win Round:</strong> the winner keeps their card and captures the opponent card.</li>
        <li><strong>Lose Round:</strong> your card is captured and the opponent keeps theirs.</li>
        <li><strong>No Effect:</strong> both cards return and no one captures anything.</li>
        <li><strong>Tie:</strong> WAR starts immediately.</li>
      </ul>
      <p><strong>Simple example:</strong> Fire vs Earth is a win for Fire. Fire vs Wind is No Effect.</p>
    `
  },
  {
    id: "war",
    title: "WAR",
    preview: "WAR turns matching elements into a high-stakes pile that the next winner claims.",
    bodyHtml: `
      <ul class="how-to-play-list">
        <li>Choosing the same element at the same time starts WAR.</li>
        <li>The tied cards move into the WAR pile.</li>
        <li>The next decisive winning result claims the full pile.</li>
        <li>One WAR can flip momentum fast, especially late in a match.</li>
      </ul>
    `
  },
  {
    id: "game-modes",
    title: "Game Modes",
    preview: "Practice, Gauntlet, Featured Rival, Local PvP, and Online each ask for a slightly different mindset.",
    bodyHtml: `
      <ul class="how-to-play-list">
        <li><strong>Practice / AI Difficulty:</strong> Learn matchups or test habits against Easy, Normal, and Hard AI.</li>
        <li><strong>Gauntlet Mode:</strong> Chain wins together against rotating rivals and protect your streak.</li>
        <li><strong>Featured Rival:</strong> Fight a showcase boss-style opponent with its own identity and presentation.</li>
        <li><strong>Local PvP:</strong> Two players share the same device with pass-screen privacy between turns.</li>
        <li><strong>Online Play:</strong> Create or join rooms and battle another player live.</li>
      </ul>
    `
  },
  {
    id: "rewards",
    title: "Rewards",
    preview: "Matches feed XP, tokens, chests, and challenge progress without changing the core rules.",
    bodyHtml: `
      <ul class="how-to-play-list">
        <li><strong>XP</strong> helps you level up and unlock progression rewards.</li>
        <li><strong>Tokens</strong> are spent in the Store on cosmetics.</li>
        <li><strong>Chests</strong> can award cosmetic-style rewards and progression value.</li>
        <li><strong>Daily Login, daily goals, weekly goals, and achievements</strong> add extra long-term progress.</li>
      </ul>
    `
  },
  {
    id: "cosmetics-loadouts",
    title: "Cosmetics + Loadouts",
    preview: "Style your identity, card art, and profile flex without changing battle power.",
    bodyHtml: `
      <ul class="how-to-play-list">
        <li>Customize <strong>avatars, titles, badges, backgrounds, card backs,</strong> and <strong>elemental card variants</strong>.</li>
        <li>The <strong>Store</strong> groups cosmetics into collections so you can chase matching themes.</li>
        <li><strong>Loadouts</strong> let you save a full look and load it again quickly later.</li>
        <li>Your profile, card style preview, and trophy-style showcases help show off what you have collected.</li>
      </ul>
    `
  },
  {
    id: "strategy-hints",
    title: "Strategy Hints",
    preview: "Mix your patterns, use No Effect wisely, and treat WAR as both danger and opportunity.",
    bodyHtml: `
      <ul class="how-to-play-list">
        <li>Watch opponent habits and do not become predictable yourself.</li>
        <li>No Effect rounds can be useful for stalling, scouting, or resetting tempo.</li>
        <li>WAR is risky, but winning one at the right time can swing the whole match.</li>
        <li>In Gauntlet, protect your card balance and avoid autopiloting early wins.</li>
        <li>Harder AI and stronger players punish repeated habits quickly.</li>
      </ul>
    `
  }
];

export const howToPlayScreen = {
  render(context) {
    return `
      <section class="screen screen-how-to-play">
        <div class="panel stack-md">
          <div class="screen-topbar">
            <h2 class="view-title">How to Play EleMintz</h2>
            <button id="how-to-play-back-btn" class="btn screen-back-btn">Back</button>
          </div>
          <div class="how-to-play-guide stack-sm">
            ${HOW_TO_PLAY_SECTIONS.map((section) => renderAccordionSection(section)).join("")}
          </div>
        </div>
      </section>
    `;
  },
  bind(context) {
    document.getElementById("how-to-play-back-btn").addEventListener("click", context.actions.back);
  }
};
