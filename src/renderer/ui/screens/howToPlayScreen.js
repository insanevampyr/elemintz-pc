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
    preview: "Pick a card. Read the matchup. Win cards. Survive WAR.",
    open: true,
    bodyHtml: `
      <ul class="how-to-play-list">
        <li>Pick one element card each round.</li>
        <li>Your opponent picks at the same time.</li>
        <li>A winning matchup keeps your card and captures theirs.</li>
        <li>Matching elements trigger WAR, where tied cards are set aside until someone wins them.</li>
        <li>Win by outlasting your opponent or finishing with more cards.</li>
      </ul>
    `
  },
  {
    id: "element-rules",
    title: "Element Rules",
    preview: "Each element beats one other element. Same cards start WAR.",
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
    id: "elemint-fatigue",
    title: "Elemint Fatigue",
    preview: "Repeating the same Elemint too often forces a short rest.",
    bodyHtml: `
      <p>If you play the same Elemint twice in a row, that Elemint must rest for one turn.</p>
      <p>You must choose a different Elemint if you have one available.</p>
      <p>If it is your only playable Elemint, you may still use it.</p>
    `
  },
  {
    id: "round-outcomes",
    title: "Round Outcomes",
    preview: "Win cards, lose cards, or go to WAR.",
    bodyHtml: `
      <ul class="how-to-play-list">
        <li><strong>Win Round:</strong> keep your card and capture your opponent's card.</li>
        <li><strong>No Effect:</strong> both cards return. Nobody captures anything.</li>
        <li><strong>Tie:</strong> WAR starts immediately.</li>
      </ul>
      <p><strong>Example:</strong> Fire beats Earth.</p>
      <p><strong>Example:</strong> Fire vs Wind is No Effect.</p>
    `
  },
  {
    id: "war",
    title: "WAR",
    preview: "WAR turns a tie into a high-stakes pile.",
    bodyHtml: `
      <ul class="how-to-play-list">
        <li>Matching elements start WAR.</li>
        <li>Tied cards go into the WAR pile.</li>
        <li>The next winning result claims the whole pile.</li>
        <li>No Effect during WAR adds more cards to the pile.</li>
        <li>One big WAR can flip the match fast.</li>
      </ul>
    `
  },
  {
    id: "game-modes",
    title: "Game Modes",
    preview: "Different modes, different pressure.",
    bodyHtml: `
      <ul class="how-to-play-list">
        <li><strong>Practice / AI Difficulty:</strong> learn the rules or test yourself against Easy, Normal, and Hard AI.</li>
        <li><strong>Gauntlet Mode:</strong> fight rotating rivals, build a streak, and see how long you can survive.</li>
        <li><strong>Featured Rival:</strong> face a special boss-style opponent with its own look and identity.</li>
        <li><strong>Local PvP:</strong> two players share one device and pass between turns.</li>
        <li><strong>Online Play:</strong> create or join a room and play another person live.</li>
      </ul>
    `
  },
  {
    id: "rewards",
    title: "Rewards",
    preview: "Play matches, earn rewards, and flex your profile.",
    bodyHtml: `
      <ul class="how-to-play-list">
        <li><strong>XP</strong> helps you level up.</li>
        <li><strong>Tokens</strong> are used in the Store for cosmetics.</li>
        <li><strong>Chests</strong> can unlock cosmetics and extra progression value.</li>
        <li><strong>Daily Login, daily goals, weekly goals, and achievements</strong> add more ways to progress.</li>
        <li>Some modes or events may offer special reward chances.</li>
      </ul>
    `
  },
  {
    id: "cosmetics-loadouts",
    title: "Cosmetics + Loadouts",
    preview: "Build your look without changing your power.",
    bodyHtml: `
      <ul class="how-to-play-list">
        <li>Customize <strong>avatars, titles, badges, backgrounds, card backs,</strong> and <strong>elemental card variants</strong>.</li>
        <li>Store collections help you build a matching style.</li>
        <li><strong>Loadouts</strong> let you save a full setup and swap back to it quickly.</li>
        <li>Your profile and card previews show off what you have collected.</li>
        <li>Cosmetics are for style, flex, and identity - not combat power.</li>
      </ul>
    `
  },
  {
    id: "strategy-hints",
    title: "Strategy Hints",
    preview: "Mix your habits. Scout smart. Respect WAR.",
    bodyHtml: `
      <ul class="how-to-play-list">
        <li>Watch what your opponent repeats.</li>
        <li>Do not rely on one favorite element every round.</li>
        <li>No Effect can buy time, slow the pace, or reveal habits.</li>
        <li>WAR is risky, but one good win can swing the whole match.</li>
        <li>In Gauntlet, protect your balance. Burning one element too fast can hurt later.</li>
        <li>Harder AI and real players punish predictable choices.</li>
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
