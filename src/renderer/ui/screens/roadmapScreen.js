import { buildThemedSurfaceClassName } from "../shared/themedSurfaceShared.js";

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
        description: "New rivals, streak goals, themed arenas, taunts, and special rewards."
      },
      {
        title: "Event Chests",
        description: "Limited-time reward chests with themed cosmetics and special pools."
      },
      {
        title: "Alpha Season Track",
        description: "Complete missions and matches to unlock seasonal rewards."
      },
      {
        title: "Friends List + Invite to Match",
        description: "Add friends from matches or searched profiles, then invite them directly from your Friends List."
      },
      {
        title: "More Achievements",
        description: "New goals for Gauntlet, Online Play, Featured Rivals, and cosmetics."
      },
      {
        title: "More Gauntlet Events",
        description: "Special Gauntlet runs with event rivals, unique rules, and completion rewards."
      },
      {
        title: "Password Recovery",
        description: "Reset forgotten passwords through verified email."
      }
    ]
  }
];

export const roadmapScreen = {
  render(context) {
    return `
      <section class="screen screen-roadmap">
        <section class="${buildThemedSurfaceClassName({ backgroundImage: context.backgroundImage ?? "" })}" style="background-image: url('${context.backgroundImage ?? ""}')">
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
