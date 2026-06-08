function renderRoadmapSection(title, items) {
  return `
    <section class="panel stack-sm">
      <h3 class="section-title">${title}</h3>
      <ul class="how-to-play-list">
        ${items
          .map(
            (item) => `
              <li>
                <strong>${item.title}</strong>
                <br />
                <span>${item.description}</span>
              </li>
            `
          )
          .join("")}
      </ul>
    </section>
  `;
}

const ROADMAP_SECTIONS = [
  {
    id: "planned-ideas",
    title: "PLANNED IDEAS",
    items: [
      {
        title: "More Gauntlet Rivals",
        description: "New rivals, streak goals, and special Gauntlet rewards."
      },
      {
        title: "Collection Albums",
        description: "Track themed cosmetic sets and earn completion rewards."
      },
      {
        title: "Alpha Season Track",
        description: "Play matches and complete missions to unlock seasonal rewards."
      },
      {
        title: "Blood Moon Mode",
        description: "A future Vampire vs Lycan vs Player chaos mode."
      },
      {
        title: "Friends List",
        description: "Add friends from matches or searched profiles."
      },
      {
        title: "More Achievements",
        description: "New long-term goals for Gauntlet, Online Play, cosmetics, and Featured Rivals."
      },
      {
        title: "Limited-Time Events",
        description: "Temporary reward tracks, special cosmetics, and themed challenges."
      },
      {
        title: "More Affordable Cosmetics",
        description: "More Common and Rare avatars, titles, card backs, and variants."
      }
    ]
  }
];

export const roadmapScreen = {
  render(context) {
    return `
      <section class="screen screen-roadmap">
        <section class="arena-board screen-themed-surface" style="background-image: url('${context.backgroundImage ?? ""}')">
          <div class="panel themed-screen-panel stack-md">
            <div class="screen-topbar">
              <h2 class="view-title">EleMintz Roadmap</h2>
              <button id="roadmap-back-btn" class="btn screen-back-btn">Back</button>
            </div>
            <p class="muted">
              These are planned ideas and active development goals. They are not listed in release order, and some may change as EleMintz grows.
            </p>
            <div class="stack-sm">
              ${ROADMAP_SECTIONS.map((section) => renderRoadmapSection(section.title, section.items)).join("")}
            </div>
          </div>
        </section>
      </section>
    `;
  },
  bind(context) {
    document.getElementById("roadmap-back-btn").addEventListener("click", context.actions.back);
  }
};
