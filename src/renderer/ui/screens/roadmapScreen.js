function renderRoadmapSection(title, items) {
  return `
    <section class="panel stack-sm">
      <h3 class="section-title">${title}</h3>
      <ul class="how-to-play-list">
        ${items.map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </section>
  `;
}

const ROADMAP_SECTIONS = [
  {
    id: "coming-soon",
    title: "COMING SOON",
    items: [
      "New cosmetic drops",
      "More Gauntlet rivals",
      "Challenge reward improvements",
      "Quality-of-life polish"
    ]
  },
  {
    id: "later",
    title: "LATER",
    items: [
      "Alpha Season Track",
      "Referral bonuses",
      "Leaderboards",
      "Tournaments",
      "Deck Builder experiments"
    ]
  }
];

export const roadmapScreen = {
  render(context) {
    return `
      <section class="screen screen-roadmap">
        <div class="panel stack-md">
          <div class="screen-topbar">
            <h2 class="view-title">EleMintz Roadmap</h2>
            <button id="roadmap-back-btn" class="btn screen-back-btn">Back</button>
          </div>
          <p class="muted">
            A look at features planned or being explored. Details may change as EleMintz grows.
          </p>
          <div class="stack-sm">
            ${ROADMAP_SECTIONS.map((section) => renderRoadmapSection(section.title, section.items)).join("")}
          </div>
        </div>
      </section>
    `;
  },
  bind(context) {
    document.getElementById("roadmap-back-btn").addEventListener("click", context.actions.back);
  }
};
