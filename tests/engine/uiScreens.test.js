import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { achievementsScreen } from "../../src/renderer/ui/screens/achievementsScreen.js";
import { aiDifficultyScreen } from "../../src/renderer/ui/screens/aiDifficultyScreen.js";
import { cosmeticsScreen } from "../../src/renderer/ui/screens/cosmeticsScreen.js";
import { dailyChallengesScreen } from "../../src/renderer/ui/screens/dailyChallengesScreen.js";
import { buildGameHudPrimaryLine, buildGameLiveUpdateSignature, gameScreen } from "../../src/renderer/ui/screens/gameScreen.js";
import { howToPlayScreen } from "../../src/renderer/ui/screens/howToPlayScreen.js";
import { loginScreen } from "../../src/renderer/ui/screens/loginScreen.js";
import { localSetupScreen } from "../../src/renderer/ui/screens/localSetupScreen.js";
import { menuScreen } from "../../src/renderer/ui/screens/menuScreen.js";
import { onlinePlayScreen } from "../../src/renderer/ui/screens/onlinePlayScreen.js";
import { profileScreen, selectTrophyShelfItems } from "../../src/renderer/ui/screens/profileScreen.js";
import { roadmapScreen } from "../../src/renderer/ui/screens/roadmapScreen.js";
import { settingsScreen } from "../../src/renderer/ui/screens/settingsScreen.js";
import { storeScreen } from "../../src/renderer/ui/screens/storeScreen.js";
import { bindCosmeticHoverPreview } from "../../src/renderer/ui/shared/cosmeticHoverPreview.js";
import { AppController } from "../../src/renderer/systems/appController.js";
import { MATCH_MODE } from "../../src/renderer/systems/gameController.js";
import { ModalManager } from "../../src/renderer/systems/modalManager.js";
import { getArenaBackground, getAvatarImage, getBadgeImage, getCardBackImage, getVariantCardImages } from "../../src/renderer/utils/assets.js";
import { ACHIEVEMENT_DEFINITIONS } from "../../src/state/achievementSystem.js";
import { COSMETIC_CATALOG, getCosmeticCatalogForProfile } from "../../src/state/cosmeticSystem.js";
import { getStoreViewForProfile } from "../../src/state/storeSystem.js";

function createClassList() {
  const values = new Set();
  return {
    add: (...tokens) => tokens.forEach((token) => values.add(token)),
    remove: (...tokens) => tokens.forEach((token) => values.delete(token)),
    contains: (token) => values.has(token)
  };
}

function createFakeButton(cardIndex = "0") {
  const listeners = new Map();
  const attributes = new Map([["data-card-index", cardIndex], ["data-card-owner", "active"]]);
  const classList = createClassList();

  return {
    isConnected: true,
    listeners,
    classList,
    addEventListener: (type, handler) => listeners.set(type, handler),
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    hasAttribute: (name) => attributes.has(name),
    removeAttribute: (name) => attributes.delete(name)
  };
}

function createFakeElement() {
  const listeners = new Map();
  const attributes = new Map();
  const classList = createClassList();

  return {
    offsetWidth: 1,
    hidden: true,
    innerHTML: "",
    textContent: "",
    listeners,
    classList,
    addEventListener: (type, handler) => listeners.set(type, handler),
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value))
  };
}

function createRendererController() {
  return new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: () => {},
      hide: () => {}
    },
    toastManager: {
      show: () => {}
    }
  });
}

function createProfileScreenContext(overrides = {}) {
  return {
    profile: {
      username: "ChestUser",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      chests: { basic: 0, milestone: 0, epic: 0, legendary: 0 },
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: {
          fire: "default_fire_card",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    basicChestVisualState: {
      basicOpen: false,
      milestoneOpen: false,
      epicOpen: false,
      legendaryOpen: false
    },
    titleIcon: null,
    backgroundImage: "assets/EleMintzIcon.png",
    searchQuery: "",
    searchResults: [],
    profileAchievementsExpanded: true,
    viewedProfileAchievementsExpanded: false,
    viewedProfile: null,
    actions: {
      openBasicChest: () => {},
      openMilestoneChest: () => {},
      openEpicChest: () => {},
      openLegendaryChest: () => {},
      searchProfiles: () => {},
      viewProfile: () => {},
      clearViewed: () => {},
      back: () => {}
    },
    ...overrides
  };
}

function createFakeCheckbox({ checked = false, attributeMap = {} } = {}) {
  const listeners = new Map();
  return {
    checked,
    hidden: false,
    style: {},
    classList: { toggle() {} },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    getAttribute(name) {
      return attributeMap[name] ?? null;
    },
    trigger(type) {
      const handler = listeners.get(type);
      if (handler) {
        handler({ target: this });
      }
    }
  };
}

function createSortableItem(attributeMap) {
  return {
    hidden: false,
    style: {},
    classList: { toggle() {} },
    getAttribute(name) {
      return attributeMap[name] ?? null;
    }
  };
}

function createFakeGrid(items) {
  return {
    items,
    querySelectorAll(selector) {
      if (selector === "[data-store-item]" || selector === ".cosmetic-item") {
        return this.items;
      }
      return [];
    },
    appendChild(item) {
      this.items = this.items.filter((entry) => entry !== item);
      this.items.push(item);
    }
  };
}

test("ui: settings screen renders PvE AI difficulty and style options with easy warning", () => {
  const html = settingsScreen.render({
    settings: {
      gameplay: { timerSeconds: 20 },
      aiDifficulty: "normal",
      aiOpponentStyle: "random",
      ui: { reducedMotion: false },
      audio: { enabled: true }
    }
  });

  assert.match(html, /AI Difficulty/);
  assert.match(html, /Adjusts PvE and local PvP turn timing only\./);
  assert.match(
    html,
    /Online Play always uses a server-controlled 20-second turn timer and is not affected by local timer or speed settings\./
  );

  assert.match(html, /Practice Mode\. No rewards, stats, achievements, or challenge progress\./);
  assert.match(html, /Easy AI is practice-only and grants no XP, tokens, or chest drops\./);
  assert.match(html, /Standard rewards and progression\./);
  assert.match(html, /Smarter AI\. Win for \+5 XP, \+5 tokens, and improved basic chest chance\./);
  assert.match(html, /AI Opponent Style/);
  assert.match(html, /Randomize AI avatar, title, and card back from the global cosmetic pool each PvE match/);
});

test("ui: settings screen persists AI difficulty and opponent style selections", async () => {
  const previousDocument = global.document;
  const previousFormData = global.FormData;
  const saves = [];
  const elements = new Map();
  const form = {
    values: new Map([
      ["timerSeconds", "45"],
      ["reducedMotion", "on"],
      ["soundEnabled", "on"],
      ["aiDifficulty", "easy"],
      ["aiOpponentStyle", "random"]
    ])
  };

  elements.set("settings-form", {
    addEventListener: (_type, handler) => {
      form.submit = handler;
    }
  });
  elements.set("settings-back-btn", {
    addEventListener: () => {}
  });

  global.document = {
    getElementById: (id) => elements.get(id)
  };
  global.FormData = class {
    constructor(target) {
      this.target = target;
    }

    get(key) {
      return this.target.values.get(key) ?? null;
    }
  };

  settingsScreen.bind({
    actions: {
      save: async (patch) => saves.push(patch),
      back: () => {}
    }
  });

  try {
    await form.submit({
      preventDefault: () => {},
      currentTarget: form
    });

    assert.deepEqual(saves[0], {
      gameplay: { timerSeconds: 45 },
      aiDifficulty: "easy",
      aiOpponentStyle: "random",
      ui: { reducedMotion: true },
      audio: { enabled: true }
    });
  } finally {
    global.document = previousDocument;
    global.FormData = previousFormData;
  }
});

test("ui: cosmetic catalog preserves approved collection labels for mapped entries only", () => {
  assert.equal(
    COSMETIC_CATALOG.cardBack.find((item) => item.id === "cardback_founder_ember")?.collection,
    "Ember"
  );
  assert.equal(
    COSMETIC_CATALOG.cardBack.find((item) => item.id === "cardback_goldbound_relic")?.collection,
    "Goldbound Relics"
  );
  assert.equal(
    COSMETIC_CATALOG.title.find((item) => item.id === "title_pretty_problem")?.collection,
    "Cutesy"
  );
  assert.equal(
    COSMETIC_CATALOG.title.find((item) => item.id === "title_goldbound")?.collection,
    "Goldbound Relics"
  );
  assert.equal(
    COSMETIC_CATALOG.avatar.find((item) => item.id === "fireavatarF")?.collection,
    undefined
  );
});

test("ui: store screen renders collection chips for mapped items and omits them for unmapped items", () => {
  const html = storeScreen.render({
    store: {
      tokens: 1000,
      supporterPass: false,
      catalog: {
        avatar: [
          {
            id: "avatar_smirk_ember",
            name: "Smirk Ember",
            image: "avatars/avatar_smirk_ember.png",
            rarity: "Common",
            price: 150,
            purchasable: true,
            owned: false,
            collection: "Ember"
          },
          {
            id: "fireavatarF",
            name: "Fire Avatar Classic (F)",
            image: "avatars/fireavatarF.png",
            rarity: "Common",
            price: 150,
            purchasable: true,
            owned: false
          }
        ],
        title: [],
        badge: [],
        cardBack: [],
        background: [],
        elementCardVariant: []
      }
    },
    viewState: {}
  });

  assert.match(html, /cosmetic-collection-chip">Ember Collection<\/span>/);
  assert.equal(html.match(/cosmetic-collection-chip/g)?.length ?? 0, 1);
  assert.match(html, /Type: Avatar/);
  assert.match(html, /Price: 150 Tokens/);
  assert.match(html, /Rarity: <span class="cosmetic-rarity-label[^"]*">Common<\/span>/);
});

test("ui: store and owned cosmetics screens render Goldbound Relics metadata without crashing", () => {
  const storeHtml = storeScreen.render({
    store: {
      tokens: 5000,
      supporterPass: false,
      catalog: {
        avatar: [
          {
            id: "avatar_aurelian_archon",
            name: "Aurelian Archon",
            image: "avatars/avatar_aurelian_archon.png",
            rarity: "Legendary",
            price: 900,
            purchasable: true,
            owned: false,
            collection: "Goldbound Relics",
            isNew: true,
            releaseTag: "goldbound_relics_01"
          }
        ],
        title: [],
        badge: [],
        cardBack: [],
        background: [],
        elementCardVariant: []
      }
    },
    viewState: {}
  });

  const ownedHtml = cosmeticsScreen.render({
    cosmetics: {
      preferences: { randomizeAfterEachMatch: {} },
      loadouts: [],
      catalog: {
        avatar: [],
        cardBack: [],
        background: [],
        badge: [],
        title: [
          {
            id: "title_goldbound",
            name: "Goldbound",
            image: "titles/title_goldbound.png",
            owned: true,
            equipped: true,
            rarity: "Epic",
            collection: "Goldbound Relics",
            isNew: true,
            releaseTag: "goldbound_relics_01"
          }
        ],
        elementCardVariant: [
          {
            id: "fire_variant_goldbound_relics",
            name: "Molten Goldfire",
            image: "cards/fire_variant_goldbound_relics.png",
            element: "fire",
            owned: true,
            equipped: true,
            rarity: "Epic",
            collection: "Goldbound Relics",
            isNew: true,
            releaseTag: "goldbound_relics_01"
          }
        ]
      }
    },
    viewState: {}
  });

  assert.match(storeHtml, /Goldbound Relics Collection/);
  assert.match(storeHtml, /Type: Avatar/);
  assert.match(storeHtml, /Rarity: <span class="cosmetic-rarity-label[^"]*">Legendary<\/span>/);
  assert.match(ownedHtml, /Goldbound Relics Collection/);
  assert.match(ownedHtml, /Type: Title/);
  assert.match(ownedHtml, /Type: Fire Variant/);
  assert.match(ownedHtml, /Goldbound/);
  assert.match(ownedHtml, /Molten Goldfire/);
});

test("ui: store render clears stale Goldbound Relics collection filters when the collection disappears", () => {
  const viewState = {
    searchText: "",
    categories: new Set(["avatar", "background", "cardBack", "elementCardVariant", "title", "badge"]),
    rarities: new Set(["Common", "Rare", "Epic", "Legendary"]),
    collections: new Set(["Goldbound Relics"]),
    showNewFirst: true
  };
  const html = storeScreen.render({
    store: {
      tokens: 500,
      supporterPass: false,
      catalog: {
        avatar: [
          {
            id: "avatar_voidbound_entity",
            name: "Voidbound Entity",
            image: "avatars/avatar_voidbound_entity.png",
            rarity: "Legendary",
            price: 900,
            purchasable: true,
            owned: false,
            collection: "Voidbound"
          }
        ],
        title: [],
        badge: [],
        cardBack: [],
        background: [],
        elementCardVariant: []
      }
    },
    viewState
  });

  assert.equal(viewState.collections.size, 0);
  assert.match(html, /Voidbound/);
  assert.doesNotMatch(html, /data-store-collection-filter="Goldbound Relics"/);
});

test("ui: cosmetics render clears stale invisible collection filters when owned collections disappear", () => {
  const viewState = {
    categories: new Set(["avatar"]),
    rarities: new Set(["Common", "Legendary"]),
    collections: new Set(["Goldbound Relics"]),
    showNewFirst: true
  };
  const html = cosmeticsScreen.render({
    cosmetics: {
      preferences: { randomizeAfterEachMatch: {} },
      loadouts: [],
      catalog: {
        avatar: [
          {
            id: "avatar_voidbound_entity",
            name: "Voidbound Entity",
            image: "avatars/avatar_voidbound_entity.png",
            owned: true,
            equipped: false,
            rarity: "Legendary",
            collection: "Voidbound"
          }
        ],
        title: [],
        badge: [],
        cardBack: [],
        background: [],
        elementCardVariant: []
      }
    },
    viewState,
    profile: {
      cosmeticRandomizeAfterMatch: {}
    }
  });

  assert.equal(viewState.collections.size, 0);
  assert.match(html, /Voidbound/);
  assert.doesNotMatch(html, /data-cosmetic-collection-filter="Goldbound Relics"/);
});

test("ui: store screen renders a featured rotation section above filters when active featured items exist", () => {
  const html = storeScreen.render({
    store: {
      tokens: 1000,
      supporterPass: false,
      catalog: {
        avatar: [
          {
            id: "avatar_voidbound_entity",
            name: "Voidbound Entity",
            image: "avatars/avatar_voidbound_entity.png",
            rarity: "Legendary",
            price: 900,
            purchasable: true,
            owned: false,
            collection: "Void"
          }
        ],
        title: [],
        badge: [],
        cardBack: [],
        background: [],
        elementCardVariant: []
      }
    },
    featuredRotation: {
      activeRotationId: "void-week-01",
      title: "Void Week",
      message: "Void Collection cosmetics are featured this week.",
      endsAt: "2026-05-20T18:00:00.000Z",
      featuredItems: [
        {
          id: "avatar_voidbound_entity",
          type: "avatar",
          item: {
            id: "avatar_voidbound_entity",
            name: "Voidbound Entity",
            image: "avatars/avatar_voidbound_entity.png",
            rarity: "Legendary",
            price: 900,
            purchasable: true,
            owned: false,
            collection: "Void"
          }
        }
      ]
    },
    viewState: {}
  });

  assert.match(html, /data-store-featured-section/);
  assert.match(html, /Featured Rotation/);
  assert.match(html, /Void Week/);
  assert.match(html, /Void Collection cosmetics are featured this week\./);
  assert.match(html, /Ends:/);
  assert.match(html, /Voidbound Entity/);
  assert.match(html, /Type: Avatar/);
  assert.match(html, /cosmetic-grid cosmetic-grid-featured/);
  assert.ok(html.indexOf("data-store-featured-section") < html.indexOf("store-toolbar"));
});

test("ui: cosmetics screen keeps owned rotationOnly cosmetics visible and equippable", () => {
  const html = cosmeticsScreen.render({
    cosmetics: {
      preferences: { randomizeAfterEachMatch: {} },
      loadouts: [],
      catalog: getCosmeticCatalogForProfile({
        username: "RotationOwner",
        ownedCosmetics: {
          avatar: ["default_avatar", "avatar_voidbound_entity"],
          background: ["default_background"],
          cardBack: ["default_card_back", "void_card_back"],
          elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
          badge: ["none"],
          title: ["Initiate"]
        },
        equippedCosmetics: {
          avatar: "avatar_voidbound_entity",
          background: "default_background",
          cardBack: "void_card_back",
          elementCardVariant: {
            fire: "default_fire_card",
            water: "default_water_card",
            earth: "default_earth_card",
            wind: "default_wind_card"
          },
          badge: "none",
          title: "Initiate"
        }
      })
    },
    viewState: {}
  });

  assert.match(html, /Voidbound Entity/);
  assert.match(html, /Void Card Back/);
  assert.match(html, /Type: Avatar/);
  assert.match(html, /Type: Card Back/);
  assert.match(html, /Equipped: Yes/);
});

test("ui: featured rotation strip styling keeps the featured row horizontal and non-wrapping", () => {
  const layoutCss = fs.readFileSync(
    "C:\\Users\\mxz\\Desktop\\Projects\\Codex EleMintz PC\\src\\renderer\\styles\\layout.css",
    "utf8"
  );

  assert.match(layoutCss, /\.store-featured-rotation \.cosmetic-grid-featured \{/);
  assert.match(layoutCss, /flex-wrap:\s*nowrap;/);
  assert.match(layoutCss, /overflow-x:\s*auto;/);
  assert.match(layoutCss, /\.store-featured-rotation \.cosmetic-grid-featured > \.cosmetic-item \{/);
  assert.match(layoutCss, /flex:\s*0 0 clamp\(236px,\s*24vw,\s*290px\);/);
});

test("ui: cosmetics screen renders collection chips for mapped owned items and omits them for unmapped items", () => {
  const html = cosmeticsScreen.render({
    cosmetics: {
      preferences: { randomizeAfterEachMatch: {} },
      loadouts: [],
      catalog: {
        avatar: [
          {
            id: "avatar_rose_riot",
            name: "Rose Riot",
            image: "avatars/avatar_rose_riot.png",
            owned: true,
            equipped: false,
            rarity: "Legendary",
            collection: "Velvet & Rose"
          },
          {
            id: "default_avatar",
            name: "Default Avatar",
            image: "avatars/default.png",
            owned: true,
            equipped: true,
            rarity: "Common"
          }
        ],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        badge: [],
        title: []
      }
    },
    viewState: {}
  });

  assert.match(html, /cosmetic-collection-chip">Velvet (&amp;|&) Rose Collection<\/span>/);
  assert.equal(html.match(/cosmetic-collection-chip/g)?.length ?? 0, 1);
  assert.match(html, /Type: Avatar/);
  assert.match(html, /Equipped: Yes/);
  assert.match(html, /cosmetic-rarity-label rarity-legendary/);
});

test("ui: store and cosmetics render element-specific variant type labels when the element is known", () => {
  const storeHtml = storeScreen.render({
    store: {
      tokens: 1000,
      supporterPass: false,
      catalog: {
        avatar: [],
        cardBack: [],
        background: [],
        title: [],
        badge: [],
        elementCardVariant: [
          {
            id: "fire_variant_crownfire",
            name: "Crownfire",
            image: "cards/fire_variant_crownfire.png",
            rarity: "Legendary",
            price: 700,
            purchasable: true,
            owned: false,
            element: "fire",
            collection: "Flame King"
          }
        ]
      }
    },
    viewState: {}
  });

  const cosmeticsHtml = cosmeticsScreen.render({
    cosmetics: {
      preferences: { randomizeAfterEachMatch: {} },
      loadouts: [],
      catalog: {
        avatar: [],
        cardBack: [],
        background: [],
        title: [],
        badge: [],
        elementCardVariant: [
          {
            id: "fire_variant_crownfire",
            name: "Crownfire",
            image: "cards/fire_variant_crownfire.png",
            rarity: "Legendary",
            owned: true,
            equipped: true,
            element: "fire",
            collection: "Flame King"
          }
        ]
      }
    },
    viewState: {}
  });

  assert.match(storeHtml, /Type: Fire Variant/);
  assert.match(cosmeticsHtml, /Type: Fire Variant/);
  assert.match(storeHtml, /Price: 700 Tokens/);
  assert.match(cosmeticsHtml, /Equipped: Yes/);
});

test("ui: store and cosmetics render short collection filter labels when collection items exist", () => {
  const storeHtml = storeScreen.render({
    store: {
      tokens: 1000,
      supporterPass: false,
      catalog: {
        avatar: [
          {
            id: "avatar_astral_archon",
            name: "Astral Archon",
            image: "avatars/avatar_astral_archon.png",
            rarity: "Legendary",
            price: 900,
            purchasable: true,
            owned: false,
            collection: "Celestial"
          }
        ],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        title: [],
        badge: []
      }
    },
    viewState: {}
  });
  const cosmeticsHtml = cosmeticsScreen.render({
    cosmetics: {
      preferences: { randomizeAfterEachMatch: {} },
      loadouts: [],
      catalog: {
        avatar: [
          {
            id: "avatar_astral_archon",
            name: "Astral Archon",
            image: "avatars/avatar_astral_archon.png",
            rarity: "Legendary",
            owned: true,
            equipped: false,
            collection: "Celestial"
          }
        ],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        badge: [],
        title: []
      }
    },
    viewState: {}
  });

  assert.match(storeHtml, /<legend>Collections<\/legend>/);
  assert.match(storeHtml, /class="store-filter-options store-filter-options--collections"/);
  assert.match(storeHtml, /data-store-collection-filter="Celestial"/);
  assert.match(storeHtml, /<span>Celestial<\/span>/);
  assert.doesNotMatch(storeHtml, /Celestial Collection<\/span><\/label>/);

  assert.match(cosmeticsHtml, /<legend>Collections<\/legend>/);
  assert.match(cosmeticsHtml, /class="store-filter-options store-filter-options--collections"/);
  assert.match(cosmeticsHtml, /data-cosmetic-collection-filter="Celestial"/);
  assert.match(cosmeticsHtml, /<span>Celestial<\/span>/);
  assert.doesNotMatch(cosmeticsHtml, /Celestial Collection<\/span><\/label>/);
});

test("ui: Neon Arcana items render collection filters, owned cosmetics visibility, and correct type labels without NEW badges", () => {
  const storeHtml = storeScreen.render({
    store: {
      tokens: 1000,
      supporterPass: false,
      catalog: {
        avatar: [
          {
            id: "avatar_neon_pyre_entity",
            name: "Neon Pyre Entity",
            image: "avatars/avatar_neon_pyre_entity.png",
            rarity: "Epic",
            price: 600,
            purchasable: true,
            owned: false,
            isNew: false,
            collection: "Neon Arcana"
          }
        ],
        cardBack: [
          {
            id: "cardback_neon_arcana",
            name: "Neon Arcana Card Back",
            image: "card_backs/cardback_neon_arcana.png",
            rarity: "Legendary",
            price: 800,
            purchasable: true,
            owned: false,
            isNew: false,
            collection: "Neon Arcana"
          }
        ],
        background: [],
        title: [
          {
            id: "title_spellwired",
            name: "Spellwired",
            image: "titles/title_spellwired.png",
            rarity: "Legendary",
            price: 850,
            purchasable: true,
            owned: false,
            isNew: false,
            collection: "Neon Arcana"
          }
        ],
        badge: [],
        elementCardVariant: [
          {
            id: "fire_variant_neon_arcana",
            name: "Neon Arcana Fire",
            image: "cards/fire_variant_neon_arcana.png",
            rarity: "Rare",
            price: 250,
            purchasable: true,
            owned: false,
            isNew: false,
            element: "fire",
            collection: "Neon Arcana"
          },
          {
            id: "water_variant_neon_arcana",
            name: "Neon Arcana Water",
            image: "cards/water_variant_neon_arcana.png",
            rarity: "Rare",
            price: 250,
            purchasable: true,
            owned: false,
            isNew: false,
            element: "water",
            collection: "Neon Arcana"
          },
          {
            id: "earth_variant_neon_arcana",
            name: "Neon Arcana Earth",
            image: "cards/earth_variant_neon_arcana.png",
            rarity: "Rare",
            price: 250,
            purchasable: true,
            owned: false,
            isNew: false,
            element: "earth",
            collection: "Neon Arcana"
          },
          {
            id: "wind_variant_neon_arcana",
            name: "Neon Arcana Wind",
            image: "cards/wind_variant_neon_arcana.png",
            rarity: "Rare",
            price: 250,
            purchasable: true,
            owned: false,
            isNew: false,
            element: "wind",
            collection: "Neon Arcana"
          }
        ]
      }
    },
    viewState: {}
  });

  const cosmeticsHtml = cosmeticsScreen.render({
    cosmetics: {
      preferences: { randomizeAfterEachMatch: {} },
      loadouts: [],
      catalog: {
        avatar: [
          {
            id: "avatar_neon_pyre_entity",
            name: "Neon Pyre Entity",
            image: "avatars/avatar_neon_pyre_entity.png",
            rarity: "Epic",
            owned: true,
            equipped: true,
            isNew: false,
            collection: "Neon Arcana"
          }
        ],
        cardBack: [
          {
            id: "cardback_neon_arcana",
            name: "Neon Arcana Card Back",
            image: "card_backs/cardback_neon_arcana.png",
            rarity: "Legendary",
            owned: true,
            equipped: false,
            isNew: false,
            collection: "Neon Arcana"
          }
        ],
        background: [],
        title: [
          {
            id: "title_spellwired",
            name: "Spellwired",
            image: "titles/title_spellwired.png",
            rarity: "Legendary",
            owned: true,
            equipped: false,
            isNew: false,
            collection: "Neon Arcana"
          }
        ],
        badge: [],
        elementCardVariant: [
          {
            id: "fire_variant_neon_arcana",
            name: "Neon Arcana Fire",
            image: "cards/fire_variant_neon_arcana.png",
            rarity: "Rare",
            owned: true,
            equipped: false,
            isNew: false,
            element: "fire",
            collection: "Neon Arcana"
          },
          {
            id: "water_variant_neon_arcana",
            name: "Neon Arcana Water",
            image: "cards/water_variant_neon_arcana.png",
            rarity: "Rare",
            owned: true,
            equipped: false,
            isNew: false,
            element: "water",
            collection: "Neon Arcana"
          },
          {
            id: "earth_variant_neon_arcana",
            name: "Neon Arcana Earth",
            image: "cards/earth_variant_neon_arcana.png",
            rarity: "Rare",
            owned: true,
            equipped: false,
            isNew: false,
            element: "earth",
            collection: "Neon Arcana"
          },
          {
            id: "wind_variant_neon_arcana",
            name: "Neon Arcana Wind",
            image: "cards/wind_variant_neon_arcana.png",
            rarity: "Rare",
            owned: true,
            equipped: false,
            isNew: false,
            element: "wind",
            collection: "Neon Arcana"
          }
        ]
      }
    },
    viewState: {}
  });

  assert.match(storeHtml, /data-store-collection-filter="Neon Arcana"/);
  assert.match(cosmeticsHtml, /data-cosmetic-collection-filter="Neon Arcana"/);
  assert.match(storeHtml, /Neon Arcana Collection/);
  assert.match(cosmeticsHtml, /Neon Arcana Collection/);
  assert.doesNotMatch(storeHtml, /store-item-badge-new">NEW<\/span>/);
  assert.doesNotMatch(cosmeticsHtml, /store-item-badge store-item-badge-new">NEW/);
  assert.match(storeHtml, /Type: Avatar/);
  assert.match(storeHtml, /Type: Title/);
  assert.match(storeHtml, /Type: Card Back/);
  assert.match(storeHtml, /Type: Fire Variant/);
  assert.match(storeHtml, /Type: Water Variant/);
  assert.match(storeHtml, /Type: Earth Variant/);
  assert.match(storeHtml, /Type: Wind Variant/);
  assert.match(cosmeticsHtml, /Neon Pyre Entity/);
  assert.match(cosmeticsHtml, /Spellwired/);
  assert.match(cosmeticsHtml, /Neon Arcana Card Back/);
  assert.match(cosmeticsHtml, /Equipped: Yes/);
});

test("ui: Frostveil Court items render collection filters, owned cosmetics visibility, and correct type labels without NEW badges", () => {
  const storeHtml = storeScreen.render({
    store: {
      tokens: 1000,
      supporterPass: false,
      catalog: {
        avatar: [
          {
            id: "avatar_frostveil_heir",
            name: "Frostveil Heir",
            image: "avatars/avatar_frostveil_heir.png",
            rarity: "Legendary",
            price: 900,
            purchasable: true,
            owned: false,
            isNew: false,
            releaseTag: "frostveil_court_2026_05",
            collection: "Frostveil Court"
          }
        ],
        cardBack: [
          {
            id: "cardback_glacier_sigil",
            name: "Glacier Sigil",
            image: "card_backs/cardback_glacier_sigil.png",
            rarity: "Legendary",
            price: 800,
            purchasable: true,
            owned: false,
            isNew: false,
            releaseTag: "frostveil_court_2026_05",
            collection: "Frostveil Court"
          }
        ],
        background: [],
        title: [
          {
            id: "title_shiverborne",
            name: "Shiverborne",
            image: "titles/title_shiverborne.png",
            rarity: "Epic",
            price: 500,
            purchasable: true,
            owned: false,
            isNew: false,
            releaseTag: "frostveil_court_2026_05",
            collection: "Frostveil Court"
          }
        ],
        badge: [],
        elementCardVariant: [
          {
            id: "fire_variant_aurora_flare",
            name: "Aurora Flare Fire",
            image: "cards/fire_variant_aurora_flare.png",
            rarity: "Epic",
            price: 450,
            purchasable: true,
            owned: false,
            isNew: false,
            element: "fire",
            releaseTag: "frostveil_court_2026_05",
            collection: "Frostveil Court"
          },
          {
            id: "earth_variant_icebound_crag",
            name: "Icebound Crag Earth",
            image: "cards/earth_variant_icebound_crag.png",
            rarity: "Epic",
            price: 450,
            purchasable: true,
            owned: false,
            isNew: false,
            element: "earth",
            releaseTag: "frostveil_court_2026_05",
            collection: "Frostveil Court"
          },
          {
            id: "wind_variant_sleet_spiral",
            name: "Sleet Spiral Wind",
            image: "cards/wind_variant_sleet_spiral.png",
            rarity: "Epic",
            price: 450,
            purchasable: true,
            owned: false,
            isNew: false,
            element: "wind",
            releaseTag: "frostveil_court_2026_05",
            collection: "Frostveil Court"
          },
          {
            id: "water_variant_frostbloom",
            name: "Frostbloom Water",
            image: "cards/water_variant_frostbloom.png",
            rarity: "Epic",
            price: 450,
            purchasable: true,
            owned: false,
            isNew: false,
            element: "water",
            releaseTag: "frostveil_court_2026_05",
            collection: "Frostveil Court"
          }
        ]
      }
    },
    viewState: {}
  });

  const cosmeticsHtml = cosmeticsScreen.render({
    cosmetics: {
      preferences: { randomizeAfterEachMatch: {} },
      loadouts: [],
      catalog: {
        avatar: [
          {
            id: "avatar_frostveil_heir",
            name: "Frostveil Heir",
            image: "avatars/avatar_frostveil_heir.png",
            rarity: "Legendary",
            owned: true,
            equipped: true,
            isNew: false,
            collection: "Frostveil Court"
          }
        ],
        cardBack: [
          {
            id: "cardback_glacier_sigil",
            name: "Glacier Sigil",
            image: "card_backs/cardback_glacier_sigil.png",
            rarity: "Legendary",
            owned: true,
            equipped: false,
            isNew: false,
            collection: "Frostveil Court"
          }
        ],
        background: [],
        title: [
          {
            id: "title_shiverborne",
            name: "Shiverborne",
            image: "titles/title_shiverborne.png",
            rarity: "Epic",
            owned: true,
            equipped: false,
            isNew: false,
            collection: "Frostveil Court"
          }
        ],
        badge: [],
        elementCardVariant: [
          {
            id: "fire_variant_aurora_flare",
            name: "Aurora Flare Fire",
            image: "cards/fire_variant_aurora_flare.png",
            rarity: "Epic",
            owned: true,
            equipped: false,
            isNew: false,
            element: "fire",
            collection: "Frostveil Court"
          },
          {
            id: "earth_variant_icebound_crag",
            name: "Icebound Crag Earth",
            image: "cards/earth_variant_icebound_crag.png",
            rarity: "Epic",
            owned: true,
            equipped: false,
            isNew: false,
            element: "earth",
            collection: "Frostveil Court"
          },
          {
            id: "wind_variant_sleet_spiral",
            name: "Sleet Spiral Wind",
            image: "cards/wind_variant_sleet_spiral.png",
            rarity: "Epic",
            owned: true,
            equipped: false,
            isNew: false,
            element: "wind",
            collection: "Frostveil Court"
          },
          {
            id: "water_variant_frostbloom",
            name: "Frostbloom Water",
            image: "cards/water_variant_frostbloom.png",
            rarity: "Epic",
            owned: true,
            equipped: false,
            isNew: false,
            element: "water",
            collection: "Frostveil Court"
          }
        ]
      }
    },
    viewState: {}
  });

  assert.match(storeHtml, /data-store-collection-filter="Frostveil Court"/);
  assert.match(cosmeticsHtml, /data-cosmetic-collection-filter="Frostveil Court"/);
  assert.match(storeHtml, /Frostveil Court Collection/);
  assert.match(cosmeticsHtml, /Frostveil Court Collection/);
  assert.doesNotMatch(storeHtml, /store-item-badge-new">NEW<\/span>/);
  assert.doesNotMatch(cosmeticsHtml, /store-item-badge store-item-badge-new">NEW/);
  assert.match(storeHtml, /Type: Avatar/);
  assert.match(storeHtml, /Type: Title/);
  assert.match(storeHtml, /Type: Card Back/);
  assert.match(storeHtml, /Type: Fire Variant/);
  assert.match(storeHtml, /Type: Earth Variant/);
  assert.match(storeHtml, /Type: Wind Variant/);
  assert.match(storeHtml, /Type: Water Variant/);
  assert.match(cosmeticsHtml, /Frostveil Heir/);
  assert.match(cosmeticsHtml, /Shiverborne/);
  assert.match(cosmeticsHtml, /Equipped: Yes/);
});

test("ui: Vampire Elegance and Lycan Power items render NEW badges, collection filters, owned cosmetics visibility, and Lycan background support", () => {
  const storeHtml = storeScreen.render({
    store: {
      tokens: 4000,
      supporterPass: false,
      catalog: {
        avatar: [
          {
            id: "avatar_vampire_female",
            name: "Vampire Female",
            image: "avatars/avatar_vampire_female.png",
            rarity: "Legendary",
            price: 900,
            purchasable: true,
            owned: false,
            isNew: true,
            releaseTag: "vampire_elegance_2026_05",
            collection: "Vampire Elegance"
          },
          {
            id: "avatar_lycan_female",
            name: "Lycan Female",
            image: "avatars/avatar_lycan_female.png",
            rarity: "Legendary",
            price: 900,
            purchasable: true,
            owned: false,
            isNew: true,
            releaseTag: "lycan_power_2026_05",
            collection: "Lycan Power"
          }
        ],
        cardBack: [
          {
            id: "cardback_blood_gem",
            name: "Blood Gem",
            image: "card_backs/cardback_blood_gem.png",
            rarity: "Legendary",
            price: 800,
            purchasable: true,
            owned: false,
            isNew: true,
            releaseTag: "vampire_elegance_2026_05",
            collection: "Vampire Elegance"
          },
          {
            id: "cardback_lycan_pack",
            name: "Lycan Pack",
            image: "card_backs/cardback_lycan_pack.png",
            rarity: "Legendary",
            price: 800,
            purchasable: true,
            owned: false,
            isNew: true,
            releaseTag: "lycan_power_2026_05",
            collection: "Lycan Power"
          }
        ],
        background: [
          {
            id: "background_bg_lycan_law",
            name: "Lycan Law",
            image: "backgrounds/background_bg_lycan_law.png",
            rarity: "Epic",
            price: 700,
            purchasable: true,
            owned: false,
            isNew: true,
            releaseTag: "lycan_power_2026_05",
            collection: "Lycan Power"
          }
        ],
        title: [],
        badge: [],
        elementCardVariant: [
          {
            id: "fire_variant_flame_wings",
            name: "Flame Wings Fire",
            image: "cards/fire_variant_flame_wings.png",
            rarity: "Epic",
            price: 450,
            purchasable: true,
            owned: false,
            isNew: true,
            element: "fire",
            releaseTag: "vampire_elegance_2026_05",
            collection: "Vampire Elegance"
          },
          {
            id: "wind_variant_lycan_duo",
            name: "Lycan Duo Wind",
            image: "cards/wind_variant_lycan_duo.png",
            rarity: "Epic",
            price: 450,
            purchasable: true,
            owned: false,
            isNew: true,
            element: "wind",
            releaseTag: "lycan_power_2026_05",
            collection: "Lycan Power"
          }
        ]
      }
    },
    viewState: {}
  });

  const cosmeticsHtml = cosmeticsScreen.render({
    cosmetics: {
      preferences: { randomizeAfterEachMatch: {} },
      loadouts: [],
      catalog: {
        avatar: [
          { id: "avatar_vampire_female", name: "Vampire Female", image: "avatars/avatar_vampire_female.png", rarity: "Legendary", owned: true, equipped: true, isNew: true, collection: "Vampire Elegance" },
          { id: "avatar_lycan_female", name: "Lycan Female", image: "avatars/avatar_lycan_female.png", rarity: "Legendary", owned: true, equipped: false, isNew: true, collection: "Lycan Power" }
        ],
        cardBack: [
          { id: "cardback_blood_gem", name: "Blood Gem", image: "card_backs/cardback_blood_gem.png", rarity: "Legendary", owned: true, equipped: false, isNew: true, collection: "Vampire Elegance" },
          { id: "cardback_lycan_pack", name: "Lycan Pack", image: "card_backs/cardback_lycan_pack.png", rarity: "Legendary", owned: true, equipped: false, isNew: true, collection: "Lycan Power" }
        ],
        background: [
          { id: "background_bg_lycan_law", name: "Lycan Law", image: "backgrounds/background_bg_lycan_law.png", rarity: "Epic", owned: true, equipped: false, isNew: true, collection: "Lycan Power" }
        ],
        title: [],
        badge: [],
        elementCardVariant: [
          { id: "fire_variant_flame_wings", name: "Flame Wings Fire", image: "cards/fire_variant_flame_wings.png", rarity: "Epic", owned: true, equipped: false, isNew: true, element: "fire", collection: "Vampire Elegance" },
          { id: "wind_variant_lycan_duo", name: "Lycan Duo Wind", image: "cards/wind_variant_lycan_duo.png", rarity: "Epic", owned: true, equipped: false, isNew: true, element: "wind", collection: "Lycan Power" }
        ]
      }
    },
    viewState: {}
  });

  assert.match(storeHtml, /data-store-collection-filter="Vampire Elegance"/);
  assert.match(storeHtml, /data-store-collection-filter="Lycan Power"/);
  assert.match(cosmeticsHtml, /data-cosmetic-collection-filter="Vampire Elegance"/);
  assert.match(cosmeticsHtml, /data-cosmetic-collection-filter="Lycan Power"/);
  assert.match(storeHtml, /Vampire Elegance Collection/);
  assert.match(storeHtml, /Lycan Power Collection/);
  assert.match(cosmeticsHtml, /Vampire Elegance Collection/);
  assert.match(cosmeticsHtml, /Lycan Power Collection/);
  assert.match(storeHtml, /Type: Background/);
  assert.match(storeHtml, /Type: Fire Variant/);
  assert.match(storeHtml, /Type: Wind Variant/);
  assert.match(cosmeticsHtml, /Lycan Law/);
  assert.match(cosmeticsHtml, /Equipped: Yes/);
  assert.ok((storeHtml.match(/store-item-badge-new">NEW<\/span>/g) ?? []).length >= 4);
});

test("ui: settings screen defaults to normal AI, random cosmetics, and a 20 second timer when fields are missing", () => {
  const html = settingsScreen.render({
    settings: {
      gameplay: {},
      ui: { reducedMotion: false },
      audio: { enabled: true }
    }
  });

  assert.match(html, /value="20"/);
  assert.match(html, /id="ai-difficulty-normal"[^>]*checked/);
  assert.match(html, /id="ai-style-random"[^>]*checked/);
});

test("ui: achievements screen renders locked and unlocked states", () => {
  const html = achievementsScreen.render({
    achievements: [
      {
        id: "first_flame",
        name: "First Flame",
        description: "Win your first match.",
        image: "badges/firstFlame.png",
        repeatable: false,
        unlocked: true,
        count: 1
      },
      {
        id: "matches_played_500",
        name: "Enduring Contender",
        description: "Play 500 matches.",
        image: "badges/marathonGamer.png",
        repeatable: false,
        unlocked: false,
        count: 0,
        progress: {
          current: 412,
          target: 500,
          label: "412 / 500",
          kind: "numeric"
        }
      },
      {
        id: "war_machine",
        name: "War Machine",
        description: "Win 3 WARs in a single match.",
        image: "badges/warMachine.png",
        repeatable: true,
        unlocked: false,
        count: 0
      }
    ]
  });

  assert.match(html, /Status: Unlocked/);
  assert.match(html, /Status: Locked/);
  assert.match(html, /Progress: 412 \/ 500/);
  assert.match(html, /assets\/badges\/firstFlame\.png/);
  assert.doesNotMatch(html, /Progress: 1 \/ 1/);
  assert.doesNotMatch(html, /War Machine[\s\S]*Progress:/);
});

test("ui: store screen uses cardback catalog names and rarities for wired shop entries", () => {
  const store = getStoreViewForProfile({
    tokens: 2000,
    supporterPass: false,
    ownedCosmetics: {
      avatar: ["default_avatar"],
      cardBack: ["default_card_back"],
      background: ["default_background"],
      elementCardVariant: [
        "default_fire_card",
        "default_water_card",
        "default_earth_card",
        "default_wind_card"
      ],
      badge: ["none"],
      title: ["title_initiate"]
    },
    equippedCosmetics: {
      avatar: "default_avatar",
      cardBack: "default_card_back",
      background: "default_background",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      },
      badge: "none",
      title: "title_initiate"
    }
  });

  const html = storeScreen.render({ store, viewState: {} });
  const swiftExecution = store.catalog.cardBack.find((item) => item.id === "wont_take_long_cardback");
  const tinyButMighty = store.catalog.cardBack.find((item) => item.id === "cardback_tiny_but_mighty");
  const elementalOverlord = store.catalog.cardBack.find((item) => item.id === "cardback_elemental_overlord");
  const tooEasyV2 = store.catalog.cardBack.find((item) => item.id === "cardback_too_easy");
  const cryAboutItV2 = store.catalog.cardBack.find((item) => item.id === "cardback_cry_about_it_v2");
  const voidTease = store.catalog.cardBack.find((item) => item.id === "cardback_void_tease");
  const luckyYou = store.catalog.cardBack.find((item) => item.id === "cardback_lucky_you");
  const kingEnergy = store.catalog.cardBack.find((item) => item.id === "cardback_king_energy");

  assert.match(html, /I Don't Lose - Transparent/);
  assert.match(html, /I Don't Lose/);
  assert.match(html, /Infernal Mockery/);
  assert.match(html, /Tiny But Mighty/);
  assert.match(html, /Nature Bites Back/);
  assert.match(html, /Cry About It V2/);
  assert.match(html, /Flame Tyrant/);
  assert.match(html, /Elemental Overlord/);
  assert.match(html, /Sweet But Deadly/);
  assert.match(html, /Too Easy V2/);
  assert.match(html, /Stay Mad/);
  assert.match(html, /Void Tease/);
  assert.match(html, /Lucky You/);
  assert.match(html, /King Energy/);
  assert.ok(swiftExecution);
  assert.ok(tinyButMighty);
  assert.ok(elementalOverlord);
  assert.ok(tooEasyV2);
  assert.ok(cryAboutItV2);
  assert.ok(voidTease);
  assert.ok(luckyYou);
  assert.ok(kingEnergy);
  assert.equal(swiftExecution.rarity, "Epic");
  assert.equal(swiftExecution.price, 500);
  assert.equal(tinyButMighty.rarity, "Rare");
  assert.equal(tinyButMighty.price, 250);
  assert.equal(elementalOverlord.rarity, "Legendary");
  assert.equal(elementalOverlord.price, 800);
  assert.equal(tooEasyV2.rarity, "Common");
  assert.equal(tooEasyV2.price, 120);
  assert.equal(cryAboutItV2.rarity, "Epic");
  assert.equal(cryAboutItV2.price, 500);
  assert.equal(voidTease.rarity, "Epic");
  assert.equal(voidTease.price, 500);
  assert.equal(luckyYou.rarity, "Common");
  assert.equal(luckyYou.price, 120);
  assert.equal(kingEnergy.rarity, "Legendary");
  assert.equal(kingEnergy.price, 800);
  assert.match(html, /cosmetic-rarity-label[^>]*>Epic<\/span>/);
  assert.ok(
    getCardBackImage("i_dont_lose_transparent_cardback").includes(
      "i_dont_lose_transparent_cardback.png"
    )
  );
  assert.ok(getCardBackImage("cardback_tiny_but_mighty").includes("cardback_tiny_but_mighty.png"));
  assert.ok(getCardBackImage("cardback_elemental_overlord").includes("cardback_elemental_overlord.png"));
  assert.ok(getCardBackImage("cardback_too_easy").includes("cardback_too_easy.png"));
  assert.ok(getCardBackImage("cardback_stay_mad").includes("cardback_stay_mad.png"));
  assert.ok(getCardBackImage("cardback_void_tease").includes("cardback_void_tease.png"));
  assert.ok(getCardBackImage("cardback_lucky_you").includes("cardback_lucky_you.png"));
  assert.ok(getCardBackImage("cardback_king_energy").includes("cardback_king_energy.png"));
  assert.match(html, /Magma Warlord/);
  assert.doesNotMatch(html, /Voidbound Entity/);
  assert.match(html, /Arcane Gambler/);
  assert.match(html, /Fairy Prince/);
  assert.match(html, /Fairy Princess/);
  assert.match(html, /Infernal Rift/);
  assert.doesNotMatch(html, /Celestial Observatory/);
  assert.match(html, /Verdant Overgrowth/);
  assert.match(html, /cosmetic-item-cardBack cosmetic-item-framed rarity-epic/);
  assert.match(html, /cosmetic-item-avatar cosmetic-item-framed rarity-epic/);
  assert.match(html, /cosmetic-rarity-label rarity-epic/);
  assert.ok(getAvatarImage("avatar_astral_archon").includes("avatar_astral_archon.png"));
  assert.ok(getAvatarImage("avatar_wind_wraith").includes("avatar_wind_wraith.png"));
  assert.ok(getAvatarImage("avatar_fairy_m").includes("avatar_fairy_m.png"));
  assert.ok(getAvatarImage("avatar_fairy_f").includes("avatar_fairy_f.png"));
  assert.ok(getArenaBackground("bg_celestial_observatory").includes("bg_celestial_observatory.png"));
  assert.ok(getArenaBackground("bg_sunken_ruins").includes("bg_sunken_ruins.png"));
});

test("ui: store screen renders NEW badges only for cosmetics marked as new", () => {
  const html = storeScreen.render({
    store: {
      tokens: 1000,
      supporterPass: false,
      catalog: {
        avatar: [
          {
            id: "avatar_smirk_ember",
            name: "Smirk Ember",
            image: "avatars/avatar_smirk_ember.png",
            rarity: "Common",
            price: 150,
            purchasable: true,
            owned: false,
            isNew: true
          },
          {
            id: "fireavatarF",
            name: "Fire Avatar Classic (F)",
            image: "avatars/fireavatarF.png",
            rarity: "Common",
            price: 150,
            purchasable: true,
            owned: false
          }
        ],
        title: [
          {
            id: "title_chaos_gremlin",
            name: "Chaos Gremlin",
            image: "titles/title_chaos_gremlin.png",
            rarity: "Common",
            price: 100,
            purchasable: true,
            owned: false,
            isNew: true
          }
        ],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        badge: []
      }
    },
    viewState: {}
  });

  const newBadges = html.match(/store-item-badge-new">NEW<\/span>/g) ?? [];
  assert.equal(newBadges.length, 2);
  assert.match(html, /Smirk Ember/);
  assert.match(html, /Chaos Gremlin/);
  const legacyAvatarCard =
    (html.match(/<article[\s\S]*?<\/article>/g) ?? []).find((article) =>
      article.includes('data-buy-id="fireavatarF"')
    ) ?? "";
  assert.match(legacyAvatarCard, /Fire Avatar Classic \(F\)/);
  assert.doesNotMatch(legacyAvatarCard, /store-item-badge-new">NEW<\/span>/);
});

test("ui: Simple Backgrounds render as collectionless purchasable NEW backgrounds in Store and Owned Cosmetics", () => {
  const simpleBackgroundIds = [
    "background_breezewild_meadow",
    "background_broken_yard",
    "background_crystal_ruins",
    "background_ember_pit",
    "background_glowtide_flats",
    "background_moonshade_grove"
  ];
  const simpleBackgroundNames = [
    "Breezewild Meadow",
    "Broken Yard",
    "Crystal Ruins",
    "Ember Pit",
    "Glowtide Flats",
    "Moonshade Grove"
  ];
  const storeView = getStoreViewForProfile({
    username: "SimpleBackgroundStoreUser",
    tokens: 1000,
    ownedCosmetics: {
      avatar: ["default_avatar"],
      cardBack: ["default_card_back"],
      background: ["default_background"],
      elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
      badge: ["none"],
      title: ["Initiate"]
    }
  });
  const storeHtml = storeScreen.render({
    store: {
      ...storeView,
      catalog: {
        avatar: [],
        cardBack: [],
        background: storeView.catalog.background.filter((item) => simpleBackgroundIds.includes(item.id)),
        elementCardVariant: [],
        badge: [],
        title: []
      }
    },
    viewState: {}
  });
  const ownedCatalog = getCosmeticCatalogForProfile({
    username: "SimpleBackgroundOwner",
    ownedCosmetics: {
      avatar: ["default_avatar"],
      cardBack: ["default_card_back"],
      background: ["default_background", ...simpleBackgroundIds],
      elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
      badge: ["none"],
      title: ["Initiate"]
    },
    equippedCosmetics: {
      avatar: "default_avatar",
      cardBack: "default_card_back",
      background: "background_glowtide_flats",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      },
      badge: "none",
      title: "Initiate"
    }
  });
  const cosmeticsHtml = cosmeticsScreen.render({
    cosmetics: {
      preferences: { randomizeAfterEachMatch: {} },
      loadouts: [],
      catalog: {
        avatar: [],
        cardBack: [],
        background: ownedCatalog.background.filter((item) => simpleBackgroundIds.includes(item.id)),
        elementCardVariant: [],
        badge: [],
        title: []
      }
    },
    viewState: {
      categories: new Set(["background"]),
      rarities: new Set(["Common"]),
      collections: new Set(),
      showNewFirst: true
    }
  });

  for (const name of simpleBackgroundNames) {
    assert.match(storeHtml, new RegExp(name));
    assert.match(cosmeticsHtml, new RegExp(name));
  }

  assert.equal((storeHtml.match(/store-item-badge-new">NEW<\/span>/g) ?? []).length, 6);
  assert.equal((storeHtml.match(/Type: Background/g) ?? []).length, 6);
  assert.equal((storeHtml.match(/Price: 90 Tokens/g) ?? []).length, 6);
  assert.equal((storeHtml.match(/Rarity: <span class="cosmetic-rarity-label[^"]*">Common<\/span>/g) ?? []).length, 6);
  assert.doesNotMatch(storeHtml, /Simple Backgrounds Collection|n\/a Collection|None Collection/);
  assert.doesNotMatch(storeHtml, /data-store-collection-filter=/);
  assert.doesNotMatch(cosmeticsHtml, /Simple Backgrounds Collection|n\/a Collection|None Collection/);
  assert.doesNotMatch(cosmeticsHtml, /data-cosmetic-collection-filter=/);
  assert.match(cosmeticsHtml, /Glowtide Flats[\s\S]*Equipped: Yes|Equipped: Yes[\s\S]*Glowtide Flats/);
});

test("ui: Simple Backgrounds resolver drives own and read-only profile background display", () => {
  const expectedBackground = getArenaBackground("background_glowtide_flats");
  const escapedBackground = new RegExp(expectedBackground.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const ownHtml = profileScreen.render(
    createProfileScreenContext({
      profile: {
        ...createProfileScreenContext().profile,
        equippedCosmetics: {
          ...createProfileScreenContext().profile.equippedCosmetics,
          background: "background_glowtide_flats"
        }
      },
      backgroundImage: expectedBackground
    })
  );
  const viewedHtml = profileScreen.renderViewedProfileModalBody({
    username: "SimpleBackgroundViewer",
    title: "Initiate",
    tokens: 0,
    wins: 0,
    losses: 0,
    gamesPlayed: 0,
    achievements: {},
    equippedCosmetics: {
      avatar: "default_avatar",
      title: "Initiate",
      badge: "none",
      background: "background_glowtide_flats",
      cardBack: "default_card_back",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    }
  });

  assert.match(getArenaBackground("background_breezewild_meadow"), /assets\/backgrounds\/background_breezewild_meadow\.png/);
  assert.match(expectedBackground, /assets\/backgrounds\/background_glowtide_flats\.png/);
  assert.match(ownHtml, escapedBackground);
  assert.match(viewedHtml, escapedBackground);
  assert.match(viewedHtml, /Read-only player profile/);
});

test("ui: screen back buttons render inside the shared topbar", () => {
  const achievementsHtml = achievementsScreen.render({ achievements: [] });
  const cosmeticsHtml = cosmeticsScreen.render({
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: {
          fire: "default_fire_card",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        badge: [],
        title: []
      },
      preferences: {},
      loadouts: []
    }
  });
  const dailyHtml = dailyChallengesScreen.render({
    tokens: 0,
    daily: { msUntilReset: 0, challenges: [] },
    weekly: { msUntilReset: 0, challenges: [] }
  });
  const localSetupHtml = localSetupScreen.render({ defaultNames: { p1: "", p2: "" } });
  const settingsHtml = settingsScreen.render({
    settings: {
      gameplay: { timerSeconds: 30 },
      aiDifficulty: "normal",
      aiOpponentStyle: "default",
      ui: { reducedMotion: false },
      audio: { enabled: true }
    }
  });
  const onlineHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "",
    multiplayer: {
      connectionStatus: "disconnected",
      statusMessage: "Offline"
    },
    actions: {}
  });
  const profileHtml = profileScreen.render({
    profile: {
      username: "BackButtonUser",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      chests: { basic: 0 },
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: {
          fire: "default_fire_card",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    basicChestVisualState: { basicOpen: false },
    backgroundImage: "assets/EleMintzIcon.png",
    searchQuery: "",
    searchResults: [],
    viewedProfile: null,
    actions: {}
  });
  const storeHtml = storeScreen.render({
    store: {
      tokens: 0,
      supporterPass: false,
      catalog: {
        avatar: [],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        title: [],
        badge: []
      }
    }
  });

  for (const html of [
    achievementsHtml,
    cosmeticsHtml,
    dailyHtml,
    localSetupHtml,
    settingsHtml,
    onlineHtml,
    profileHtml,
    storeHtml
  ]) {
    assert.match(html, /class="screen-topbar(?: [^"]+)?"/);
    assert.match(html, /class="btn screen-back-btn"/);
    assert.ok(html.indexOf('screen-topbar') < html.indexOf('class="view-title"'));
    assert.ok(html.indexOf('screen-topbar') < html.indexOf('screen-back-btn'));
  }
});

test("ui: profile and online back topbars render outside the themed arena wrapper", () => {
  const profileHtml = profileScreen.render({
    profile: {
      username: "BackButtonUser",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      chests: { basic: 0 },
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: {
          fire: "default_fire_card",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    basicChestVisualState: { basicOpen: false },
    backgroundImage: "assets/EleMintzIcon.png",
    searchQuery: "",
    searchResults: [],
    viewedProfile: null,
    actions: {}
  });
  const onlineHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "",
    multiplayer: {
      connectionStatus: "disconnected",
      statusMessage: "Offline"
    },
    actions: {}
  });

  assert.ok(profileHtml.indexOf('class="screen-topbar"') < profileHtml.indexOf('class="arena-board screen-themed-surface"'));
  assert.ok(onlineHtml.indexOf('class="screen-topbar"') < onlineHtml.indexOf('class="arena-board screen-themed-surface"'));
});

test("ui: daily challenges screen renders completed status when hydrated progress already satisfies the goal", () => {
  const html = dailyChallengesScreen.render({
    tokens: 200,
    daily: {
      msUntilReset: 60_000,
      challenges: [
        {
          id: "daily_win_2_matches",
          name: "Win 2 Matches",
          description: "Win 2 completed matches in one day.",
          rewardTokens: 3,
          rewardXp: 7,
          progress: 2,
          goal: 2,
          completed: true
        }
      ]
    },
    weekly: {
      msUntilReset: 120_000,
      challenges: []
    }
  });

  assert.match(html, /Win 2 Matches/);
  assert.match(html, /Progress: 2 \/ 2/);
  assert.match(html, /\u2714 Completed/);
  assert.doesNotMatch(html, /In Progress/);
});

test("ui: daily challenges screen renders rotating bonus quest names from the active payload and not retired legacy quests", () => {
  const html = dailyChallengesScreen.render({
    tokens: 200,
    daily: {
      msUntilReset: 60_000,
      challenges: [
        {
          id: "daily_play_5_matches",
          name: "Complete 5 Matches",
          description: "Complete 5 matches.",
          rewardTokens: 3,
          rewardXp: 6,
          progress: 0,
          goal: 5,
          completed: false
        },
        {
          id: "daily_online_match_1",
          name: "Complete 1 Online Match",
          description: "Complete 1 Online match.",
          rewardTokens: 4,
          rewardXp: 8,
          progress: 0,
          goal: 1,
          completed: false
        },
        {
          id: "daily_no_quit_3",
          name: "Finish 3 Matches",
          description: "Complete 3 matches without quitting.",
          rewardTokens: 3,
          rewardXp: 6,
          progress: 0,
          goal: 3,
          completed: false
        },
        {
          id: "daily_win_with_water",
          name: "Water Takes the Round",
          description: "Win a completed match where Water wins at least one round.",
          rewardTokens: 3,
          rewardXp: 6,
          progress: 0,
          goal: 1,
          completed: false
        }
      ]
    },
    weekly: {
      msUntilReset: 120_000,
      challenges: [
        {
          id: "weekly_online_matches_5",
          name: "Complete 5 Online Matches",
          description: "Complete 5 Online matches.",
          rewardTokens: 12,
          rewardXp: 28,
          progress: 0,
          goal: 5,
          completed: false
        }
      ]
    }
  });

  assert.match(html, /Complete 1 Online Match/);
  assert.match(html, /Finish 3 Matches/);
  assert.match(html, /Water Takes the Round/);
  assert.match(html, /Complete 5 Online Matches/);
  assert.doesNotMatch(html, /Win 2 WARs/);
  assert.doesNotMatch(html, /Trigger 2 WARs/);
  assert.doesNotMatch(html, /Capture 24 opponent cards/);
});

test("ui: Store screen keeps the title left and renders the token balance in right-side topbar controls with buy/equip actions", () => {
  const html = storeScreen.render({
    store: {
      tokens: 120,
      supporterPass: false,
      catalog: {
        avatar: [
          {
            id: "fire_avatar_f",
            name: "Fire Avatar",
            image: "avatars/fireavatarF.png",
            owned: false,
            equipped: false,
            purchasable: true,
            price: 150,
            rarity: "Common",
            unlockSource: { type: "store" }
          }
        ],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        title: [],
        badge: []
      }
    }
  });

  assert.match(
    html,
    /<div class="screen-topbar store-topbar">[\s\S]*<div class="store-topbar-heading">[\s\S]*<h2 class="view-title">Store<\/h2>[\s\S]*<div class="store-topbar-controls">[\s\S]*data-store-banner-balance="true"[\s\S]*id="store-token-balance" class="store-banner-balance-value">120<\/strong>[\s\S]*id="store-back-btn"/
  );
  assert.ok(html.indexOf('class="store-topbar-heading"') < html.indexOf('class="store-topbar-controls"'));
  assert.ok(html.indexOf('data-store-banner-balance="true"') < html.indexOf('id="store-back-btn"'));
  assert.doesNotMatch(html, /<p>Tokens: <strong>/);
  assert.match(html, /data-buy-type="avatar"/);
  assert.match(html, /cosmetic-rarity-label[^>]*>Common<\/span>/);
  assert.match(html, /Founder \/ Supporter: <strong>Not Active<\/strong>/);
  assert.doesNotMatch(html, /Activate Founder Pass \(Local\)/);
});

test("ui: store screen hides owned cosmetics while keeping unowned listings visible", () => {
  const html = storeScreen.render({
    store: {
      tokens: 120,
      supporterPass: false,
      catalog: {
        avatar: [
          {
            id: "owned_avatar",
            name: "Owned Avatar",
            image: "avatars/owned.png",
            owned: true,
            equipped: false,
            purchasable: true,
            price: 150,
            rarity: "Common",
            unlockSource: { type: "store" }
          },
          {
            id: "shop_avatar",
            name: "Shop Avatar",
            image: "avatars/shop.png",
            owned: false,
            equipped: false,
            purchasable: true,
            price: 300,
            rarity: "Rare",
            unlockSource: { type: "store" }
          }
        ],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        title: [],
        badge: []
      }
    }
  });

  assert.doesNotMatch(html, /Owned Avatar/);
  assert.doesNotMatch(html, /data-buy-id="owned_avatar"/);
  assert.match(html, /Shop Avatar/);
  assert.match(html, /data-buy-id="shop_avatar"/);
});

test("ui: shop and cosmetics render hover preview hooks and rarity classes for cosmetic art categories", () => {
  const storeHtml = storeScreen.render({
    store: {
      tokens: 120,
      supporterPass: false,
      catalog: {
        avatar: [
          {
            id: "fire_avatar_f",
            name: "Fire Avatar",
            image: "avatars/fireavatarF.png",
            owned: false,
            equipped: false,
            purchasable: true,
            price: 150,
            rarity: "Rare",
            unlockSource: { type: "store" }
          }
        ],
        cardBack: [
          {
            id: "default_card_back",
            name: "Default Card Back",
            image: "card_backs/default_back.jpg",
            owned: false,
            equipped: false,
            purchasable: true,
            price: 250,
            rarity: "Epic",
            unlockSource: { type: "store" }
          }
        ],
        background: [
          {
            id: "default_background",
            name: "EleMintz Table",
            image: "backgrounds/default_bg.jpg",
            owned: false,
            equipped: false,
            purchasable: true,
            price: 350,
            rarity: "Legendary",
            unlockSource: { type: "store" }
          }
        ],
        elementCardVariant: [
          {
            id: "default_fire_card",
            name: "Core Fire",
            image: "cards/fireCard.jpg",
            owned: false,
            equipped: false,
            purchasable: true,
            price: 120,
            rarity: "Common",
            element: "fire",
            unlockSource: { type: "store" }
          }
        ],
        title: [],
        badge: []
      }
    }
  });

  const cosmeticsHtml = cosmeticsScreen.render({
    cosmetics: {
      preferences: {},
      loadouts: [],
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", image: "avatars/default.png", owned: true, equipped: true, rarity: "Epic" }],
        cardBack: [{ id: "default_card_back", name: "Default Card Back", image: "card_backs/default_back.jpg", owned: true, equipped: true, rarity: "Rare" }],
        background: [{ id: "default_background", name: "EleMintz Table", image: "backgrounds/default_bg.jpg", owned: true, equipped: true, rarity: "Common" }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", image: "cards/fireCard.jpg", owned: true, equipped: true, rarity: "Legendary", element: "fire" }],
        badge: [{ id: "none", name: "No Badge", owned: true, equipped: true, rarity: "Common" }],
        title: [{ id: "title_initiate", name: "Initiate", owned: true, equipped: true, rarity: "Common" }]
      }
    }
  });

  assert.match(storeHtml, /data-hover-preview="true" data-preview-type="avatar"/);
  assert.match(storeHtml, /data-hover-preview="true" data-preview-type="cardBack"/);
  assert.match(storeHtml, /data-hover-preview="true" data-preview-type="background"/);
  assert.match(storeHtml, /data-hover-preview="true" data-preview-type="elementCardVariant"/);
  assert.match(storeHtml, /class="cosmetic-item cosmetic-item-background cosmetic-item-framed rarity-legendary locked"/);
  assert.match(storeHtml, /cosmetic-rarity-label rarity-legendary/);
  assert.match(cosmeticsHtml, /data-hover-preview="true" data-preview-type="avatar"/);
  assert.match(cosmeticsHtml, /data-hover-preview="true" data-preview-type="cardBack"/);
  assert.match(cosmeticsHtml, /data-hover-preview="true" data-preview-type="background"/);
  assert.match(cosmeticsHtml, /data-hover-preview="true" data-preview-type="elementCardVariant"/);
  assert.match(cosmeticsHtml, /data-hover-preview="true" data-preview-type="badge"/);
  assert.match(cosmeticsHtml, /data-hover-preview="true" data-preview-type="title"/);
  assert.match(cosmeticsHtml, /class="cosmetic-item cosmetic-item-badge cosmetic-item-framed rarity-common owned"/);
  assert.match(cosmeticsHtml, /class="cosmetic-item cosmetic-item-title cosmetic-item-framed rarity-common owned"/);
});

test("ui: store screen renders supporter unlock text for founder deluxe card back", () => {
  const html = storeScreen.render({
    store: {
      tokens: 120,
      supporterPass: false,
      catalog: {
        avatar: [],
        cardBack: [
          {
            id: "founder_deluxe_card_back",
            name: "Founder Deluxe Card Back",
            image: "card_backs/founder_deluxe_card_back.png",
            owned: false,
            equipped: false,
            purchasable: false,
            price: 800,
            rarity: "Legendary",
            unlockSource: { type: "supporter" }
          }
        ],
        background: [],
        elementCardVariant: [],
        title: [],
        badge: []
      }
    }
  });

  assert.match(html, /Unlock: Buy Founder \/ Supporter to receive/);
  assert.match(html, /Price: Not Purchasable/);
});

test("ui: store screen renders cosmetic search and category/rarity filters", () => {
  const html = storeScreen.render({
    store: {
      tokens: 120,
      supporterPass: false,
      catalog: {
        avatar: [],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        title: [],
        badge: []
      }
    }
  });

  assert.match(html, /id="store-search-input"/);
  assert.match(html, /data-store-category-filter="avatar"/);
  assert.match(html, /data-store-category-filter="background"/);
  assert.match(html, /data-store-category-filter="cardBack"/);
  assert.match(html, /data-store-category-filter="elementCardVariant"/);
  assert.match(html, /data-store-category-filter="title"/);
  assert.match(html, /data-store-category-filter="badge"/);
  assert.match(html, /data-store-rarity-filter="Common"/);
  assert.match(html, /data-store-rarity-filter="Legendary"/);
  assert.match(html, /data-store-element-filter="fire"/);
  assert.match(html, /data-store-element-filter="water"/);
  assert.match(html, /data-store-element-filter="earth"/);
  assert.match(html, /data-store-element-filter="wind"/);
});

test("ui: store screen shows the Show NEW First control by default", () => {
  const html = storeScreen.render({
    store: {
      tokens: 120,
      supporterPass: false,
      catalog: {
        avatar: [],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        title: [],
        badge: []
      }
    },
    viewState: {
      searchText: "",
      categories: new Set(["avatar", "title"]),
      rarities: new Set(["Common", "Rare"]),
      showNewFirst: true
    },
    actions: {}
  });

  assert.match(html, /Show NEW First/);
  assert.match(html, /id="store-show-new-first" checked/);
});

test("ui: store screen renders the current featured collections banner above controls", () => {
  const html = storeScreen.render({
    store: {
      tokens: 120,
      supporterPass: false,
      catalog: {
        avatar: [
          {
            id: "avatar_smirk_ember",
            name: "Smirk Ember",
            image: "avatars/avatar_smirk_ember.png",
            owned: false,
            equipped: false,
            purchasable: true,
            price: 150,
            rarity: "Common",
            isNew: true,
            unlockSource: { type: "store" }
          }
        ],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        title: [
          {
            id: "title_chaos_gremlin",
            name: "Chaos Gremlin",
            image: "titles/title_chaos_gremlin.png",
            owned: false,
            equipped: false,
            purchasable: true,
            price: 100,
            rarity: "Common",
            isNew: true,
            unlockSource: { type: "store" }
          }
        ],
        badge: []
      }
    },
    viewState: {
      showNewFirst: true
    }
  });

  assert.match(html, /New Collections in the Store/);
  assert.match(html, /Vampires vs\. Lycans — what side will you choose\?/);
  assert.match(html, /Show NEW First/);
  assert.match(html, /store-item-badge-new">NEW<\/span>/);
  assert.match(html, /Price: 150 Tokens/);
  assert.match(html, /cosmetic-rarity-label[^>]*>Common<\/span>/);
  assert.ok(html.indexOf("New Collections in the Store") < html.indexOf("Show NEW First"));
});

test("ui: Store screen keeps Founder / Supporter status visible without exposing the local activation button", () => {
  const html = storeScreen.render({
    store: {
      tokens: 120,
      supporterPass: false,
      catalog: {
        avatar: [],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        title: [],
        badge: []
      }
    },
    viewState: {}
  });

  assert.match(html, /Founder \/ Supporter: <strong>Not Active<\/strong>/);
  assert.doesNotMatch(html, /Activate Founder Pass \(Local\)/);
  assert.match(html, /Show NEW First/);
  assert.match(html, /Search Cosmetics/);
});

test("ui: store search and filters update visible cosmetics without mutating catalog output", () => {
  const previousDocument = global.document;
  const createClassList = () => {
    const tokens = new Set();
    return {
      add: (...values) => values.forEach((value) => tokens.add(value)),
      remove: (...values) => values.forEach((value) => tokens.delete(value)),
      toggle: (value, force) => {
        if (force === undefined) {
          if (tokens.has(value)) {
            tokens.delete(value);
            return false;
          }
          tokens.add(value);
          return true;
        }

        if (force) {
          tokens.add(value);
          return true;
        }

        tokens.delete(value);
        return false;
      },
      contains: (value) => tokens.has(value)
    };
  };

  function createControl(attrs = {}) {
    const listeners = new Map();
    return {
      hidden: false,
      checked: true,
      value: "",
      style: {},
      classList: createClassList(),
      listeners,
      addEventListener: (type, handler) => listeners.set(type, handler),
      getAttribute: (name) => attrs[name] ?? null
    };
  }

  function createStoreItem({ type, rarity, name }) {
    const attrs = {
      "data-store-type": type,
      "data-store-rarity": rarity,
      "data-store-name": name
    };
    return {
      hidden: false,
      style: {},
      classList: createClassList(),
      getAttribute: (key) => attrs[key] ?? null
    };
  }

  function createSection(items) {
    const grid = {
      querySelectorAll: (selector) => (selector === "[data-store-item]" ? items : []),
      appendChild: () => {}
    };
    return {
      hidden: false,
      style: {},
      classList: createClassList(),
      querySelector: (selector) => (selector === ".cosmetic-grid" ? grid : null),
      querySelectorAll: (selector) => (selector === "[data-store-item]" ? items : [])
    };
  }

  const backButton = createControl();
  const searchInput = createControl();
  const emptyState = { hidden: true, style: {}, classList: createClassList() };
  const avatarItem = createStoreItem({ type: "avatar", rarity: "Common", name: "fire avatar" });
  const cardBackItem = createStoreItem({ type: "cardBack", rarity: "Common", name: "ember card back" });
  const backgroundItem = createStoreItem({ type: "background", rarity: "Rare", name: "storm peak" });
  const titleItem = createStoreItem({ type: "title", rarity: "Epic", name: "war master" });
  const badgeItem = createStoreItem({ type: "badge", rarity: "Legendary", name: "founder badge" });
  const items = [avatarItem, cardBackItem, backgroundItem, titleItem, badgeItem];
  const sections = [
    createSection([avatarItem]),
    createSection([cardBackItem]),
    createSection([backgroundItem]),
    createSection([titleItem]),
    createSection([badgeItem])
  ];
  const categoryAvatar = createControl({ "data-store-category-filter": "avatar" });
  const categoryBackground = createControl({ "data-store-category-filter": "background" });
  const categoryCardBack = createControl({ "data-store-category-filter": "cardBack" });
  const categoryVariant = createControl({ "data-store-category-filter": "elementCardVariant" });
  const categoryTitle = createControl({ "data-store-category-filter": "title" });
  const categoryBadge = createControl({ "data-store-category-filter": "badge" });
  const rarityCommon = createControl({ "data-store-rarity-filter": "Common" });
  const rarityRare = createControl({ "data-store-rarity-filter": "Rare" });
  const rarityEpic = createControl({ "data-store-rarity-filter": "Epic" });
  const rarityLegendary = createControl({ "data-store-rarity-filter": "Legendary" });
  const root = {
    querySelectorAll: (selector) => {
      switch (selector) {
        case "[data-buy-type]":
        case "[data-equip-type]":
          return [];
        case "[data-store-item]":
          return items;
        case "[data-store-section]":
          return sections;
        case "[data-store-category-filter]":
          return [categoryAvatar, categoryBackground, categoryCardBack, categoryVariant, categoryTitle, categoryBadge];
        case "[data-store-rarity-filter]":
          return [rarityCommon, rarityRare, rarityEpic, rarityLegendary];
        default:
          return [];
      }
    }
  };

  global.document = {
    getElementById: (id) =>
      ({
        "store-back-btn": backButton,
        "store-search-input": searchInput,
        "store-empty-state": emptyState
      })[id] ?? null,
    querySelector: (selector) => (selector === ".screen-store" ? root : null),
    querySelectorAll: root.querySelectorAll
  };

  try {
    storeScreen.bind({
      actions: {
        back: () => {},
        buy: async () => {},
        equip: async () => {}
      }
    });

    assert.equal(avatarItem.hidden, false);
    assert.equal(cardBackItem.hidden, false);
    assert.equal(backgroundItem.hidden, false);
    assert.equal(titleItem.hidden, false);

    searchInput.value = "ember";
    searchInput.listeners.get("input")();

    assert.equal(cardBackItem.hidden, false);
    assert.equal(avatarItem.hidden, true);
    assert.equal(backgroundItem.hidden, true);
    assert.equal(titleItem.hidden, true);
    assert.equal(badgeItem.hidden, true);
    assert.equal(cardBackItem.style.display, "");
    assert.equal(avatarItem.style.display, "none");
    assert.equal(sections[1].hidden, false);
    assert.equal(sections[0].hidden, true);
    assert.equal(sections[1].style.display, "");
    assert.equal(sections[0].style.display, "none");

    searchInput.value = "";
    searchInput.listeners.get("input")();
    categoryCardBack.checked = false;
    categoryCardBack.listeners.get("change")();

    assert.equal(cardBackItem.hidden, true);
    assert.equal(avatarItem.hidden, false);

    rarityCommon.checked = false;
    rarityCommon.listeners.get("change")();

    assert.equal(avatarItem.hidden, true);
    assert.equal(backgroundItem.hidden, false);
    assert.equal(titleItem.hidden, false);
    assert.equal(badgeItem.hidden, false);
    assert.equal(emptyState.hidden, true);

    categoryAvatar.checked = false;
    categoryAvatar.listeners.get("change")();
    categoryBackground.checked = false;
    categoryBackground.listeners.get("change")();
    categoryVariant.checked = false;
    categoryVariant.listeners.get("change")();
    categoryTitle.checked = false;
    categoryTitle.listeners.get("change")();
    categoryBadge.checked = false;
    categoryBadge.listeners.get("change")();

    assert.equal(avatarItem.hidden, true);
    assert.equal(cardBackItem.hidden, true);
    assert.equal(backgroundItem.hidden, true);
    assert.equal(titleItem.hidden, true);
    assert.equal(badgeItem.hidden, true);
    assert.equal(emptyState.hidden, false);
    assert.equal(emptyState.style.display, "");

    categoryBadge.checked = true;
    categoryBadge.listeners.get("change")();
    rarityRare.checked = false;
    rarityRare.listeners.get("change")();
    rarityEpic.checked = false;
    rarityEpic.listeners.get("change")();
    rarityLegendary.checked = false;
    rarityLegendary.listeners.get("change")();

    assert.equal(badgeItem.hidden, true);
    assert.equal(emptyState.hidden, false);
    assert.equal(emptyState.style.display, "");
  } finally {
    global.document = previousDocument;
  }
});

test("ui: ai difficulty screen renders Easy, Normal, Hard, Gauntlet, and Featured Rival choices", () => {
  const html = aiDifficultyScreen.render({
    selectedDifficulty: "normal",
    actions: {}
  });

  assert.match(html, /Choose AI Challenge/);
  assert.match(html, /Easy Practice/);
  assert.match(html, /Normal AI/);
  assert.match(html, /Hard AI/);
  assert.match(html, /Gauntlet Mode/);
  assert.match(html, /Featured Rival/);
});

test("ui: ai difficulty screen places Gauntlet Mode after Hard and before Featured Rival", () => {
  const html = aiDifficultyScreen.render({
    selectedDifficulty: "normal",
    actions: {}
  });

  assert.ok(html.indexOf("Hard AI") < html.indexOf("Gauntlet Mode"));
  assert.ok(html.indexOf("Gauntlet Mode") < html.indexOf("Featured Rival"));
});

test("ui: ai difficulty screen renders the Gauntlet placeholder card details", () => {
  const html = aiDifficultyScreen.render({
    selectedDifficulty: "normal",
    actions: {}
  });

  assert.match(html, /menu_tiles\/tile_gauntlet_mode\.png/);
  assert.match(html, /Gauntlet Mode/);
  assert.match(html, /Build a win streak against rival AIs\./);
});

test("ui: game screen renders active Gauntlet streak and rival details when present", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: {
      name: "Hero",
      avatarId: "default_avatar",
      titleId: "Initiate",
      badgeId: "badge_element_initiate",
      title: "Initiate",
      titleIcon: null,
      featuredBadge: getBadgeImage("badge_element_initiate"),
      avatar: "assets/avatars/default.png"
    },
    opponentDisplay: {
      name: "Stone March",
      avatarId: "assets/gauntlet/avatars/avatar_gauntlet_stone_march.png",
      titleId: null,
      badgeId: null,
      title: "Mountain Step",
      avatar: "assets/gauntlet/avatars/avatar_gauntlet_stone_march.png"
    },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "AI" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    gauntlet: {
      active: true,
      currentStreak: 4,
      rivalName: "Stone March",
      rivalTitle: "Mountain Step",
      rivalHint: "Repeats a heavy Earth pattern with occasional elemental shifts."
    },
    cardImages: {
      p1: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" },
      p2: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" }
    },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      mode: "pve",
      status: "active",
      winner: null,
      endReason: null,
      hotseatTurn: "p1",
      hotseatPending: false,
      playerHand: ["fire", "water"],
      opponentHand: ["earth", "wind"],
      warActive: false,
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      warPileSizes: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    }
  });

  assert.match(html, /Gauntlet Mode/);
  assert.match(html, /Current Streak: 4/);
  assert.match(html, /Stone March/);
  assert.match(html, /Mountain Step/);
  assert.match(html, /Repeats a heavy Earth pattern with occasional elemental shifts\./);
});

test("ui: game screen does not render Gauntlet labels for normal PvE or Featured Rival matches", () => {
  const baseContext = {
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: {
      name: "Hero",
      avatarId: "default_avatar",
      titleId: "Initiate",
      badgeId: "badge_element_initiate",
      title: "Initiate",
      titleIcon: null,
      featuredBadge: getBadgeImage("badge_element_initiate"),
      avatar: "assets/avatars/default.png"
    },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "AI" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" },
      p2: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" }
    },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      mode: "pve",
      status: "active",
      winner: null,
      endReason: null,
      hotseatTurn: "p1",
      hotseatPending: false,
      playerHand: ["fire", "water"],
      opponentHand: ["earth", "wind"],
      warActive: false,
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      warPileSizes: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    }
  };
  const normalHtml = gameScreen.render({
    ...baseContext,
    opponentDisplay: {
      name: "Elemental AI",
      avatarId: "default_avatar",
      titleId: null,
      badgeId: null,
      title: "Arena Rival",
      avatar: "assets/avatars/default.png"
    },
    gauntlet: null
  });
  const featuredHtml = gameScreen.render({
    ...baseContext,
    opponentDisplay: {
      name: "Crownfire Duelist",
      avatarId: "assets/rivals/Crownfire/rival_crownfire_duelist_avatar.png",
      titleId: null,
      badgeId: null,
      title: "Inferno Regent",
      avatar: "assets/rivals/Crownfire/rival_crownfire_duelist_avatar.png"
    },
    gauntlet: null
  });

  assert.doesNotMatch(normalHtml, /Current Streak:/);
  assert.doesNotMatch(normalHtml, /Gauntlet Mode/);
  assert.doesNotMatch(featuredHtml, /Current Streak:/);
  assert.doesNotMatch(featuredHtml, /Gauntlet Mode/);
});

test("ui: ai difficulty screen renders the Crownfire featured rival card details", () => {
  const html = aiDifficultyScreen.render({
    selectedDifficulty: "normal",
    actions: {}
  });

  assert.match(html, /tile_featured_rival_crownfire\.png/);
  assert.match(html, /Crownfire Duelist/);
  assert.match(html, /Inferno Regent/);
  assert.match(html, /Featured Rival \/ Boss Battle/);
  assert.match(html, /Your Deck: 8 cards/);
  assert.match(html, /Rival Deck: 12 cards/);
  assert.match(html, /Normal EleMintz rules apply/);
  assert.match(html, /Daily First Win Bonus: \+30 XP \/ \+15 Tokens/);
  assert.match(html, /Warning: Crownfire is intentionally difficult\./);
});

test("ui: ai difficulty screen includes Easy practice suppression wording", () => {
  const html = aiDifficultyScreen.render({
    selectedDifficulty: "easy",
    actions: {}
  });

  assert.match(html, /Practice mode\. No stats, quests, achievements, rewards, or chest progress\./);
  assert.match(html, /does not count toward progression/i);
});

test("ui: ai difficulty screen includes Hard bonus wording", () => {
  const html = aiDifficultyScreen.render({
    selectedDifficulty: "hard",
    actions: {}
  });

  assert.match(html, /Smarter, tougher AI\. Win for \+5 XP, \+5 tokens, and improved chest chance\./);
});

test("ui: ai difficulty screen binds start and back actions", async () => {
  const previousDocument = global.document;
  const previousFormData = global.FormData;
  const starts = [];
  let backCalls = 0;
  const form = {
    values: new Map([["pveOpponentChoice", "hard"]])
  };
  const elements = new Map();

  elements.set("ai-difficulty-form", {
    addEventListener: (_type, handler) => {
      form.submit = handler;
    }
  });
  elements.set("ai-difficulty-back-btn", {
    addEventListener: (_type, handler) => {
      form.back = handler;
    }
  });

  global.document = {
    getElementById: (id) => elements.get(id)
  };
  global.FormData = class {
    constructor(target) {
      this.target = target;
    }

    get(key) {
      return this.target.values.get(key) ?? null;
    }
  };

  try {
    aiDifficultyScreen.bind({
      actions: {
        start: async (payload) => starts.push(payload),
        back: () => {
          backCalls += 1;
        }
      }
    });

    await form.submit({
      preventDefault: () => {},
      currentTarget: form
    });
    form.back();

    assert.deepEqual(starts, [{ aiDifficulty: "hard" }]);
    assert.equal(backCalls, 1);
  } finally {
    global.document = previousDocument;
    global.FormData = previousFormData;
  }
});

test("ui: ai difficulty screen binds the featured rival start payload", async () => {
  const previousDocument = global.document;
  const previousFormData = global.FormData;
  const starts = [];
  const form = {
    values: new Map([["pveOpponentChoice", "featured_rival_crownfire"]])
  };
  const elements = new Map();

  elements.set("ai-difficulty-form", {
    addEventListener: (_type, handler) => {
      form.submit = handler;
    }
  });
  elements.set("ai-difficulty-back-btn", {
    addEventListener: () => {}
  });

  global.document = {
    getElementById: (id) => elements.get(id)
  };
  global.FormData = class {
    constructor(target) {
      this.target = target;
    }

    get(key) {
      return this.target.values.get(key) ?? null;
    }
  };

  try {
    aiDifficultyScreen.bind({
      actions: {
        start: async (payload) => starts.push(payload),
        back: () => {}
      }
    });

    await form.submit({
      preventDefault: () => {},
      currentTarget: form
    });

    assert.deepEqual(starts, [{ featuredRivalId: "crownfire_duelist" }]);
  } finally {
    global.document = previousDocument;
    global.FormData = previousFormData;
  }
});

test("ui: ai difficulty screen binds the Gauntlet start payload", async () => {
  const previousDocument = global.document;
  const previousFormData = global.FormData;
  const starts = [];
  const form = {
    values: new Map([["pveOpponentChoice", "gauntlet_mode"]])
  };
  const elements = new Map();

  elements.set("ai-difficulty-form", {
    addEventListener: (_type, handler) => {
      form.submit = handler;
    }
  });
  elements.set("ai-difficulty-back-btn", {
    addEventListener: () => {}
  });

  global.document = {
    getElementById: (id) => elements.get(id)
  };
  global.FormData = class {
    constructor(target) {
      this.target = target;
    }

    get(key) {
      return this.target.values.get(key) ?? null;
    }
  };

  try {
    aiDifficultyScreen.bind({
      actions: {
        start: async (payload) => starts.push(payload),
        back: () => {}
      }
    });

    await form.submit({
      preventDefault: () => {},
      currentTarget: form
    });

    assert.deepEqual(starts, [{ gauntletMode: true }]);
  } finally {
    global.document = previousDocument;
    global.FormData = previousFormData;
  }
});

test("ui: auth choice screen renders Sign In, Create Account, and version badge", () => {
  const html = loginScreen.render({
    mode: "choice",
    version: "2.1.20"
  });

  assert.match(html, /EleMintz Login/);
  assert.match(html, />Sign In</);
  assert.match(html, />Create Account</);
  assert.match(html, />v2\.1\.20</);
});

test("ui: sign in screen renders Email, Password, and the keep-signed-in controls", () => {
  const html = loginScreen.render({
    mode: "login",
    defaults: { email: "player@example.com" }
  });

  assert.match(html, /<h2 class="view-title">Sign In<\/h2>/);
  assert.match(html, /Sign in with your email and password\./);
  assert.doesNotMatch(html, /Username/);
  assert.match(html, /Email/);
  assert.match(html, /Password/);
  assert.match(html, /Keep me signed in for 30 days/);
  assert.match(html, /Stay signed in after closing the game\. Logging out clears this\./);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /checked/);
});

test("ui: create account screen renders Username, Email, and Password", () => {
  const html = loginScreen.render({
    mode: "register",
    defaults: { username: "PlayerOne", email: "player@example.com" }
  });

  assert.match(html, /<h2 class="view-title">Create Account<\/h2>/);
  assert.match(html, /Create your EleMintz account with a username, email, and password\./);
  assert.match(html, /Username/);
  assert.match(html, /Email/);
  assert.match(html, /Password/);
  assert.match(html, /Keep me signed in for 30 days/);
});

test("ui: auth forms submit the remember-session preference", async () => {
  const previousDocument = global.document;
  const previousAnimationFrame = global.requestAnimationFrame;
  const requests = [];
  let loginSubmit = null;
  let registerSubmit = null;

  global.requestAnimationFrame = (handler) => handler();

  try {
    global.document = {
      getElementById: (id) => {
        if (id === "login-form") {
          return {
            addEventListener: (_type, handler) => {
              loginSubmit = handler;
            }
          };
        }
        if (id === "email-input") {
          return { value: "player@example.com", focus: () => {}, select: () => {} };
        }
        if (id === "password-input") {
          return { value: "password123" };
        }
        if (id === "remember-session-input") {
          return { checked: true };
        }
        if (id === "login-back-btn") {
          return { addEventListener: () => {} };
        }
        return null;
      }
    };

    loginScreen.bind({
      mode: "login",
      actions: {
        back: () => {},
        showMode: () => {},
        login: async (payload) => requests.push(payload)
      }
    });

    await loginSubmit({ preventDefault: () => {} });

    global.document = {
      getElementById: (id) => {
        if (id === "login-form") {
          return {
            addEventListener: (_type, handler) => {
              registerSubmit = handler;
            }
          };
        }
        if (id === "username-input") {
          return { value: "NewPlayer", focus: () => {}, select: () => {} };
        }
        if (id === "email-input") {
          return { value: "new@example.com", focus: () => {}, select: () => {} };
        }
        if (id === "password-input") {
          return { value: "password123" };
        }
        if (id === "remember-session-input") {
          return { checked: false };
        }
        if (id === "register-back-btn") {
          return { addEventListener: () => {} };
        }
        return null;
      }
    };

    loginScreen.bind({
      mode: "register",
      actions: {
        back: () => {},
        showMode: () => {},
        login: async (payload) => requests.push(payload)
      }
    });

    await registerSubmit({ preventDefault: () => {} });

    assert.deepEqual(requests, [
      {
        mode: "login",
        username: "",
        email: "player@example.com",
        password: "password123",
        rememberSession: true
      },
      {
        mode: "register",
        username: "NewPlayer",
        email: "new@example.com",
        password: "password123",
        rememberSession: false
      }
    ]);
  } finally {
    global.document = previousDocument;
    global.requestAnimationFrame = previousAnimationFrame;
  }
});

test("ui: auth choice and form back buttons bind to the expected actions", () => {
  const previousDocument = global.document;
  const signInCalls = [];
  const createAccountCalls = [];
  let backCalls = 0;
  const elements = new Map();

  elements.set("auth-choice-sign-in-btn", {
    addEventListener: (_type, handler) => {
      elements.get("auth-choice-sign-in-btn").click = handler;
    }
  });
  elements.set("auth-choice-create-account-btn", {
    addEventListener: (_type, handler) => {
      elements.get("auth-choice-create-account-btn").click = handler;
    }
  });
  elements.set("login-form", { addEventListener: () => {} });
  elements.set("email-input", { focus: () => {}, select: () => {} });
  elements.set("password-input", {});
  elements.set("login-back-btn", {
    addEventListener: (_type, handler) => {
      elements.get("login-back-btn").click = handler;
    }
  });

  global.document = {
    getElementById: (id) => elements.get(id)
  };

  const previousAnimationFrame = global.requestAnimationFrame;
  global.requestAnimationFrame = (handler) => handler();

  try {
    loginScreen.bind({
      mode: "choice",
      actions: {
        openSignIn: () => signInCalls.push("sign-in"),
        openCreateAccount: () => createAccountCalls.push("create-account")
      }
    });

    elements.get("auth-choice-sign-in-btn").click();
    elements.get("auth-choice-create-account-btn").click();

    loginScreen.bind({
      mode: "login",
      actions: {
        back: () => {
          backCalls += 1;
        }
      }
    });

    elements.get("login-back-btn").click();

    assert.deepEqual(signInCalls, ["sign-in"]);
    assert.deepEqual(createAccountCalls, ["create-account"]);
    assert.equal(backCalls, 1);
  } finally {
    global.document = previousDocument;
    global.requestAnimationFrame = previousAnimationFrame;
  }
});

test("ui: sign in and create account validation show clear inline errors", async () => {
  const previousDocument = global.document;
  const previousAnimationFrame = global.requestAnimationFrame;
  const errors = [];

  global.requestAnimationFrame = (handler) => handler();

  try {
    let formSubmit = null;
    global.document = {
      getElementById: (id) => {
        if (id === "login-form") {
          return {
            addEventListener: (_type, handler) => {
              formSubmit = handler;
            }
          };
        }
        if (id === "email-input") {
          return { value: "", focus: () => {}, select: () => {} };
        }
        if (id === "password-input") {
          return { value: "" };
        }
        if (id === "login-back-btn") {
          return { addEventListener: () => {} };
        }
        return null;
      }
    };

    loginScreen.bind({
      mode: "login",
      actions: {
        back: () => {},
        showMode: ({ errorMessage }) => errors.push(errorMessage),
        login: async () => {}
      }
    });

    await formSubmit({ preventDefault: () => {} });

    let registerSubmit = null;
    global.document = {
      getElementById: (id) => {
        if (id === "login-form") {
          return {
            addEventListener: (_type, handler) => {
              registerSubmit = handler;
            }
          };
        }
        if (id === "username-input") {
          return { value: "A", focus: () => {}, select: () => {} };
        }
        if (id === "email-input") {
          return { value: "new@example.com", focus: () => {}, select: () => {} };
        }
        if (id === "password-input") {
          return { value: "password123" };
        }
        if (id === "register-back-btn") {
          return { addEventListener: () => {} };
        }
        return null;
      }
    };

    loginScreen.bind({
      mode: "register",
      actions: {
        back: () => {},
        showMode: ({ errorMessage }) => errors.push(errorMessage),
        login: async () => {}
      }
    });

    await registerSubmit({ preventDefault: () => {} });

    assert.deepEqual(errors, [
      "Email and password are required to sign in.",
      "Username must be at least 2 characters long."
    ]);
  } finally {
    global.document = previousDocument;
    global.requestAnimationFrame = previousAnimationFrame;
  }
});

test("ui: create account validation shows a clear inline error when required fields are missing", async () => {
  const previousDocument = global.document;
  const previousAnimationFrame = global.requestAnimationFrame;
  const errors = [];
  let registerSubmit = null;

  global.requestAnimationFrame = (handler) => handler();
  global.document = {
    getElementById: (id) => {
      if (id === "login-form") {
        return {
          addEventListener: (_type, handler) => {
            registerSubmit = handler;
          }
        };
      }
      if (id === "username-input") {
        return { value: "", focus: () => {}, select: () => {} };
      }
      if (id === "email-input") {
        return { value: "" };
      }
      if (id === "password-input") {
        return { value: "" };
      }
      if (id === "register-back-btn") {
        return { addEventListener: () => {} };
      }
      return null;
    }
  };

  try {
    loginScreen.bind({
      mode: "register",
      actions: {
        back: () => {},
        showMode: ({ errorMessage }) => errors.push(errorMessage),
        login: async () => {}
      }
    });

    await registerSubmit({ preventDefault: () => {} });

    assert.deepEqual(errors, ["Username, email, and password are required to create an account."]);
  } finally {
    global.document = previousDocument;
    global.requestAnimationFrame = previousAnimationFrame;
  }
});

test("ui: store collection filters combine with search category and rarity while hiding unmapped items when active", () => {
  const previousDocument = global.document;

  const emberAvatar = createSortableItem({
    "data-store-name": "smirk ember",
    "data-store-type": "avatar",
    "data-store-rarity": "Common",
    "data-store-element": "",
    "data-store-collection": "Ember",
    "data-store-is-new": "true",
    "data-store-original-index": "0"
  });
  const fireVariant = createSortableItem({
    "data-store-name": "ember blaze",
    "data-store-type": "elementCardVariant",
    "data-store-rarity": "Common",
    "data-store-element": "fire",
    "data-store-collection": "Ember",
    "data-store-is-new": "false",
    "data-store-original-index": "1"
  });
  const waterVariant = createSortableItem({
    "data-store-name": "tidal bloom",
    "data-store-type": "elementCardVariant",
    "data-store-rarity": "Common",
    "data-store-element": "water",
    "data-store-collection": "Celestial",
    "data-store-is-new": "false",
    "data-store-original-index": "2"
  });
  const celestialAvatar = createSortableItem({
    "data-store-name": "astral archon",
    "data-store-type": "avatar",
    "data-store-rarity": "Legendary",
    "data-store-element": "",
    "data-store-collection": "Celestial",
    "data-store-is-new": "false",
    "data-store-original-index": "3"
  });
  const ungroupedAvatar = createSortableItem({
    "data-store-name": "fire avatar classic",
    "data-store-type": "avatar",
    "data-store-rarity": "Common",
    "data-store-element": "",
    "data-store-collection": "",
    "data-store-is-new": "false",
    "data-store-original-index": "4"
  });
  const grid = createFakeGrid([emberAvatar, fireVariant, waterVariant, celestialAvatar, ungroupedAvatar]);
  const section = {
    hidden: false,
    style: {},
    classList: { toggle() {} },
    querySelector: (selector) => (selector === ".cosmetic-grid" ? grid : null),
    querySelectorAll: (selector) => (selector === "[data-store-item]" ? grid.items : []),
    getAttribute: () => "avatar"
  };
  const categoryInput = createFakeCheckbox({ checked: true, attributeMap: { "data-store-category-filter": "avatar" } });
  const categoryVariantInput = createFakeCheckbox({
    checked: true,
    attributeMap: { "data-store-category-filter": "elementCardVariant" }
  });
  const rarityCommon = createFakeCheckbox({ checked: true, attributeMap: { "data-store-rarity-filter": "Common" } });
  const rarityLegendary = createFakeCheckbox({ checked: true, attributeMap: { "data-store-rarity-filter": "Legendary" } });
  const elementFire = createFakeCheckbox({ checked: false, attributeMap: { "data-store-element-filter": "fire" } });
  const elementWater = createFakeCheckbox({ checked: false, attributeMap: { "data-store-element-filter": "water" } });
  const elementEarth = createFakeCheckbox({ checked: true, attributeMap: { "data-store-element-filter": "earth" } });
  const elementWind = createFakeCheckbox({ checked: true, attributeMap: { "data-store-element-filter": "wind" } });
  const collectionEmber = createFakeCheckbox({ checked: false, attributeMap: { "data-store-collection-filter": "Ember" } });
  const collectionCelestial = createFakeCheckbox({ checked: false, attributeMap: { "data-store-collection-filter": "Celestial" } });
  const searchInput = createFakeElement();
  const showNewFirstInput = createFakeCheckbox({ checked: true });
  const backButton = { addEventListener() {} };
  const emptyState = { hidden: true, style: {}, classList: { toggle() {} } };
  const root = {
    querySelectorAll(selector) {
      if (selector === "[data-store-item]") return grid.items;
      if (selector === "[data-store-section]") return [section];
      if (selector === "[data-store-category-filter]") return [categoryInput, categoryVariantInput];
      if (selector === "[data-store-rarity-filter]") return [rarityCommon, rarityLegendary];
      if (selector === "[data-store-element-filter]") return [elementFire, elementWater, elementEarth, elementWind];
      if (selector === "[data-store-collection-filter]") return [collectionEmber, collectionCelestial];
      if (selector === "[data-buy-type]" || selector === "[data-equip-type]") return [];
      return [];
    }
  };

  global.document = {
    querySelector: (selector) => (selector === ".screen-store" ? root : null),
    getElementById: (id) => {
      if (id === "store-search-input") return searchInput;
      if (id === "store-show-new-first") return showNewFirstInput;
      if (id === "store-back-btn") return backButton;
      if (id === "store-empty-state") return emptyState;
      return null;
    }
  };

  try {
    const viewState = {
      searchText: "",
      categories: new Set(["avatar", "elementCardVariant"]),
      rarities: new Set(["Common", "Legendary"]),
      elements: new Set(["fire", "water", "earth", "wind"]),
      collections: new Set(),
      showNewFirst: true
    };
    storeScreen.bind({
      viewState,
      actions: { back: () => {}, buy: async () => {}, equip: async () => {} }
    });

    assert.equal(emberAvatar.hidden, false);
    assert.equal(fireVariant.hidden, false);
    assert.equal(waterVariant.hidden, false);
    assert.equal(celestialAvatar.hidden, false);
    assert.equal(ungroupedAvatar.hidden, false);

    elementWater.checked = false;
    elementWater.trigger("change");
    elementEarth.checked = false;
    elementEarth.trigger("change");
    elementWind.checked = false;
    elementWind.trigger("change");

    assert.equal(fireVariant.hidden, false);
    assert.equal(waterVariant.hidden, true);
    assert.equal(emberAvatar.hidden, false);
    assert.equal(celestialAvatar.hidden, false);

    collectionEmber.checked = true;
    collectionEmber.trigger("change");

    assert.equal(emberAvatar.hidden, false);
    assert.equal(fireVariant.hidden, false);
    assert.equal(waterVariant.hidden, true);
    assert.equal(celestialAvatar.hidden, true);
    assert.equal(ungroupedAvatar.hidden, true);

    searchInput.value = "blaze";
    searchInput.listeners.get("input")();
    assert.equal(emberAvatar.hidden, true);
    assert.equal(fireVariant.hidden, false);

    rarityCommon.checked = false;
    rarityCommon.trigger("change");
    assert.equal(fireVariant.hidden, true);
    assert.equal(emptyState.hidden, false);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: featured store rotation respects category rarity collection and search filters, and collapses when no featured items match", () => {
  const previousDocument = global.document;

  const featuredVoidCard = createSortableItem({
    "data-store-name": "void inferno",
    "data-store-type": "elementCardVariant",
    "data-store-rarity": "Legendary",
    "data-store-element": "fire",
    "data-store-collection": "Void",
    "data-store-is-new": "false",
    "data-store-original-index": "0"
  });
  const featuredUngroupedCard = createSortableItem({
    "data-store-name": "tidal veil",
    "data-store-type": "elementCardVariant",
    "data-store-rarity": "Common",
    "data-store-element": "water",
    "data-store-collection": "",
    "data-store-is-new": "false",
    "data-store-original-index": "1"
  });
  const mainVoidCard = createSortableItem({
    "data-store-name": "void tease",
    "data-store-type": "cardBack",
    "data-store-rarity": "Epic",
    "data-store-element": "",
    "data-store-collection": "Void",
    "data-store-is-new": "true",
    "data-store-original-index": "0"
  });
  const featuredGrid = createFakeGrid([featuredVoidCard, featuredUngroupedCard]);
  const mainGrid = createFakeGrid([mainVoidCard]);
  const featuredSection = {
    hidden: false,
    style: {},
    classList: { toggle() {} },
    querySelector: (selector) => (selector === ".cosmetic-grid" ? featuredGrid : null),
    querySelectorAll: (selector) => (selector === "[data-store-item]" ? featuredGrid.items : []),
    getAttribute: () => "featured"
  };
  const mainSection = {
    hidden: false,
    style: {},
    classList: { toggle() {} },
    querySelector: (selector) => (selector === ".cosmetic-grid" ? mainGrid : null),
    querySelectorAll: (selector) => (selector === "[data-store-item]" ? mainGrid.items : []),
    getAttribute: () => "cardBack"
  };
  const categoryVariant = createFakeCheckbox({ checked: true, attributeMap: { "data-store-category-filter": "elementCardVariant" } });
  const categoryCardBack = createFakeCheckbox({ checked: true, attributeMap: { "data-store-category-filter": "cardBack" } });
  const rarityCommon = createFakeCheckbox({ checked: true, attributeMap: { "data-store-rarity-filter": "Common" } });
  const rarityLegendary = createFakeCheckbox({ checked: true, attributeMap: { "data-store-rarity-filter": "Legendary" } });
  const rarityEpic = createFakeCheckbox({ checked: true, attributeMap: { "data-store-rarity-filter": "Epic" } });
  const elementFire = createFakeCheckbox({ checked: true, attributeMap: { "data-store-element-filter": "fire" } });
  const elementWater = createFakeCheckbox({ checked: true, attributeMap: { "data-store-element-filter": "water" } });
  const elementEarth = createFakeCheckbox({ checked: true, attributeMap: { "data-store-element-filter": "earth" } });
  const elementWind = createFakeCheckbox({ checked: true, attributeMap: { "data-store-element-filter": "wind" } });
  const collectionVoid = createFakeCheckbox({ checked: false, attributeMap: { "data-store-collection-filter": "Void" } });
  const searchInput = createFakeElement();
  const showNewFirstInput = createFakeCheckbox({ checked: true });
  const backButton = { addEventListener() {} };
  const emptyState = { hidden: true, style: {}, classList: { toggle() {} } };
  const root = {
    querySelector(selector) {
      if (selector === "[data-store-featured-section]") return featuredSection;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-store-item]") return [...featuredGrid.items, ...mainGrid.items];
      if (selector === "[data-store-section]") return [mainSection];
      if (selector === "[data-store-category-filter]") return [categoryVariant, categoryCardBack];
      if (selector === "[data-store-rarity-filter]") return [rarityCommon, rarityLegendary, rarityEpic];
      if (selector === "[data-store-element-filter]") return [elementFire, elementWater, elementEarth, elementWind];
      if (selector === "[data-store-collection-filter]") return [collectionVoid];
      if (selector === "[data-buy-type]" || selector === "[data-equip-type]") return [];
      return [];
    }
  };

  global.document = {
    querySelector: (selector) => (selector === ".screen-store" ? root : null),
    getElementById: (id) => {
      if (id === "store-search-input") return searchInput;
      if (id === "store-show-new-first") return showNewFirstInput;
      if (id === "store-back-btn") return backButton;
      if (id === "store-empty-state") return emptyState;
      return null;
    }
  };

  try {
    storeScreen.bind({
      viewState: {
        searchText: "",
        categories: new Set(["elementCardVariant", "cardBack"]),
        rarities: new Set(["Common", "Legendary", "Epic"]),
        elements: new Set(["fire", "water", "earth", "wind"]),
        collections: new Set(),
        showNewFirst: true
      },
      actions: { back: () => {}, buy: async () => {}, equip: async () => {} }
    });

    assert.equal(featuredSection.hidden, false);
    assert.equal(featuredVoidCard.hidden, false);
    assert.equal(featuredUngroupedCard.hidden, false);

    elementWater.checked = false;
    elementWater.trigger("change");
    elementEarth.checked = false;
    elementEarth.trigger("change");
    elementWind.checked = false;
    elementWind.trigger("change");

    assert.equal(featuredVoidCard.hidden, false);
    assert.equal(featuredUngroupedCard.hidden, true);
    assert.equal(mainVoidCard.hidden, false);
    assert.equal(featuredSection.hidden, false);

    collectionVoid.checked = true;
    collectionVoid.trigger("change");

    assert.equal(featuredVoidCard.hidden, false);
    assert.equal(featuredUngroupedCard.hidden, true);
    assert.equal(mainVoidCard.hidden, false);
    assert.equal(featuredSection.hidden, false);

    searchInput.value = "tease";
    searchInput.listeners.get("input")();

    assert.equal(featuredVoidCard.hidden, true);
    assert.equal(mainVoidCard.hidden, false);
    assert.equal(featuredSection.hidden, true);
    assert.equal(featuredSection.style.display, "none");

    searchInput.value = "";
    searchInput.listeners.get("input")();
    categoryVariant.checked = false;
    categoryVariant.trigger("change");

    assert.equal(featuredVoidCard.hidden, true);
    assert.equal(mainVoidCard.hidden, false);
    assert.equal(featuredSection.hidden, true);

    categoryVariant.checked = true;
    categoryVariant.trigger("change");
    rarityLegendary.checked = false;
    rarityLegendary.trigger("change");

    assert.equal(featuredVoidCard.hidden, true);
    assert.equal(featuredSection.hidden, true);
    assert.equal(mainVoidCard.hidden, false);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: cosmetics collection filters hide no-collection items only when a specific collection is selected", () => {
  const previousDocument = global.document;

  const defaultAvatar = createSortableItem({
    "data-cosmetic-rarity": "Common",
    "data-cosmetic-collection": "",
    "data-cosmetic-is-new": "false",
    "data-cosmetic-original-index": "0"
  });
  const roseAvatar = createSortableItem({
    "data-cosmetic-rarity": "Legendary",
    "data-cosmetic-collection": "Velvet & Rose",
    "data-cosmetic-is-new": "false",
    "data-cosmetic-original-index": "1"
  });
  const grid = createFakeGrid([defaultAvatar, roseAvatar]);
  const section = {
    hidden: false,
    style: {},
    classList: { toggle() {} },
    querySelector: (selector) => (selector === ".cosmetic-grid" ? grid : null),
    querySelectorAll: (selector) => (selector === ".cosmetic-item" ? grid.items : []),
    getAttribute: () => "avatar"
  };
  const categoryInput = createFakeCheckbox({ checked: true, attributeMap: { "data-cosmetic-category-filter": "avatar" } });
  const rarityCommon = createFakeCheckbox({ checked: true, attributeMap: { "data-cosmetic-rarity-filter": "Common" } });
  const rarityLegendary = createFakeCheckbox({ checked: true, attributeMap: { "data-cosmetic-rarity-filter": "Legendary" } });
  const collectionRose = createFakeCheckbox({ checked: false, attributeMap: { "data-cosmetic-collection-filter": "Velvet & Rose" } });
  const showNewFirstInput = createFakeCheckbox({ checked: true });
  const backButton = { addEventListener() {} };
  const emptyState = { hidden: true, style: {}, classList: { toggle() {} } };

  global.document = {
    querySelector: (selector) =>
      selector === ".screen-cosmetics"
        ? {
            querySelectorAll(innerSelector) {
              if (innerSelector === "[data-cosmetic-section]") return [section];
              if (innerSelector === "[data-cosmetic-category-filter]") return [categoryInput];
              if (innerSelector === "[data-cosmetic-rarity-filter]") return [rarityCommon, rarityLegendary];
              if (innerSelector === "[data-cosmetic-collection-filter]") return [collectionRose];
              if (
                innerSelector === "[data-randomize-after-match]" ||
                innerSelector === "[data-equip-type]" ||
                innerSelector === "[data-loadout-save]" ||
                innerSelector === "[data-loadout-apply]" ||
                innerSelector === "[data-loadout-rename]"
              ) {
                return [];
              }
              return [];
            }
          }
        : null,
    getElementById: (id) => {
      if (id === "cosmetics-show-new-first") return showNewFirstInput;
      if (id === "cosmetics-back-btn") return backButton;
      if (id === "cosmetics-empty-state") return emptyState;
      return null;
    },
    querySelectorAll: () => []
  };

  try {
    const viewState = {
      categories: new Set(["avatar"]),
      rarities: new Set(["Common", "Legendary"]),
      collections: new Set(),
      showNewFirst: true
    };
    cosmeticsScreen.bind({
      viewState,
      actions: {
        back: () => {},
        updateRandomizationPreferences: async () => {},
        randomizeNow: async () => {},
        equip: async () => {},
        saveLoadout: async () => {},
        applyLoadout: async () => {},
        renameLoadout: async () => {}
      }
    });

    assert.equal(defaultAvatar.hidden, false);
    assert.equal(roseAvatar.hidden, false);

    collectionRose.checked = true;
    collectionRose.trigger("change");

  assert.equal(defaultAvatar.hidden, true);
  assert.equal(roseAvatar.hidden, false);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: Elemental Street collectionless items stay visible without a collection filter, hide under unrelated collection filters, and never create a None collection entry", () => {
  const storeHtml = storeScreen.render({
    store: {
      tokens: 2000,
      supporterPass: false,
      catalog: {
        avatar: [
          {
            id: "avatar_fire_street_duelist",
            name: "Fire Street Duelist",
            image: "avatars/avatar_fire_street_duelist.png",
            rarity: "Common",
            price: 150,
            purchasable: true,
            owned: false,
            isNew: true,
            releaseTag: "elemental_street_2026_06"
          }
        ],
        title: [
          {
            id: "title_spark",
            name: "Spark",
            image: "titles/title_spark.png",
            rarity: "Common",
            price: 100,
            purchasable: true,
            owned: false,
            isNew: true,
            releaseTag: "elemental_street_2026_06"
          }
        ],
        cardBack: [
          {
            id: "cardback_four_element_street_emblem",
            name: "Four Element Street Emblem",
            image: "card_backs/cardback_four_element_street_emblem.png",
            rarity: "Rare",
            price: 250,
            purchasable: true,
            owned: false,
            isNew: true,
            releaseTag: "elemental_street_2026_06"
          }
        ],
        background: [],
        badge: [],
        elementCardVariant: [
          {
            id: "fire_variant_street",
            name: "Street Fire",
            image: "cards/fire_variant_street.png",
            rarity: "Rare",
            price: 250,
            purchasable: true,
            owned: false,
            isNew: true,
            element: "fire",
            releaseTag: "elemental_street_2026_06"
          }
        ]
      }
    },
    viewState: {}
  });

  const cosmeticsHtml = cosmeticsScreen.render({
    cosmetics: {
      preferences: { randomizeAfterEachMatch: {} },
      loadouts: [],
      catalog: {
        avatar: [
          { id: "avatar_fire_street_duelist", name: "Fire Street Duelist", image: "avatars/avatar_fire_street_duelist.png", rarity: "Common", owned: true, equipped: true, isNew: true }
        ],
        title: [
          { id: "title_spark", name: "Spark", image: "titles/title_spark.png", rarity: "Common", owned: true, equipped: false, isNew: true }
        ],
        cardBack: [
          { id: "cardback_four_element_street_emblem", name: "Four Element Street Emblem", image: "card_backs/cardback_four_element_street_emblem.png", rarity: "Rare", owned: true, equipped: false, isNew: true }
        ],
        background: [],
        badge: [],
        elementCardVariant: [
          { id: "fire_variant_street", name: "Street Fire", image: "cards/fire_variant_street.png", rarity: "Rare", owned: true, equipped: false, isNew: true, element: "fire" }
        ]
      }
    },
    viewState: {}
  });

  assert.match(storeHtml, /Fire Street Duelist/);
  assert.match(storeHtml, /Spark/);
  assert.match(storeHtml, /Four Element Street Emblem/);
  assert.match(storeHtml, /Street Fire/);
  assert.match(cosmeticsHtml, /Fire Street Duelist/);
  assert.match(cosmeticsHtml, /Spark/);
  assert.match(cosmeticsHtml, /Equipped: Yes/);
  assert.doesNotMatch(storeHtml, /data-store-collection-filter="None"/);
  assert.doesNotMatch(cosmeticsHtml, /data-cosmetic-collection-filter="None"/);
  assert.doesNotMatch(storeHtml, /Elemental Street Collection/);
  assert.doesNotMatch(cosmeticsHtml, /Elemental Street Collection/);
  assert.doesNotMatch(storeHtml, /data-store-collection="[^"]+"/);
  assert.doesNotMatch(cosmeticsHtml, /data-cosmetic-collection="[^"]+"/);
});

test("ui: cosmetics screen renders element filter controls", () => {
  const html = cosmeticsScreen.render({
    cosmetics: {
      preferences: { randomizeAfterEachMatch: {} },
      loadouts: [],
      catalog: {
        avatar: [],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        title: [],
        badge: []
      }
    },
    actions: {}
  });

  assert.match(html, /data-cosmetic-element-filter="fire"/);
  assert.match(html, /data-cosmetic-element-filter="water"/);
  assert.match(html, /data-cosmetic-element-filter="earth"/);
  assert.match(html, /data-cosmetic-element-filter="wind"/);
});

test("ui: cosmetics element filter hides non-matching owned variants without affecting non-variant owned items", () => {
  const previousDocument = global.document;

  const avatar = createSortableItem({
    "data-cosmetic-rarity": "Common",
    "data-cosmetic-collection": "",
    "data-cosmetic-element": "",
    "data-cosmetic-is-new": "false",
    "data-cosmetic-original-index": "0"
  });
  const fireVariant = createSortableItem({
    "data-cosmetic-rarity": "Epic",
    "data-cosmetic-collection": "Neon Arcana",
    "data-cosmetic-element": "fire",
    "data-cosmetic-is-new": "true",
    "data-cosmetic-original-index": "1"
  });
  const waterVariant = createSortableItem({
    "data-cosmetic-rarity": "Epic",
    "data-cosmetic-collection": "Neon Arcana",
    "data-cosmetic-element": "water",
    "data-cosmetic-is-new": "false",
    "data-cosmetic-original-index": "2"
  });
  const avatarGrid = createFakeGrid([avatar]);
  const variantGrid = createFakeGrid([fireVariant, waterVariant]);
  const avatarSection = {
    hidden: false,
    style: {},
    classList: { toggle() {} },
    querySelector: (selector) => (selector === ".cosmetic-grid" ? avatarGrid : null),
    querySelectorAll: (selector) => (selector === ".cosmetic-item" ? avatarGrid.items : []),
    getAttribute: () => "avatar"
  };
  const variantSection = {
    hidden: false,
    style: {},
    classList: { toggle() {} },
    querySelector: (selector) => (selector === ".cosmetic-grid" ? variantGrid : null),
    querySelectorAll: (selector) => (selector === ".cosmetic-item" ? variantGrid.items : []),
    getAttribute: () => "elementCardVariant"
  };
  const categoryAvatar = createFakeCheckbox({ checked: true, attributeMap: { "data-cosmetic-category-filter": "avatar" } });
  const categoryVariant = createFakeCheckbox({
    checked: true,
    attributeMap: { "data-cosmetic-category-filter": "elementCardVariant" }
  });
  const rarityCommon = createFakeCheckbox({ checked: true, attributeMap: { "data-cosmetic-rarity-filter": "Common" } });
  const rarityEpic = createFakeCheckbox({ checked: true, attributeMap: { "data-cosmetic-rarity-filter": "Epic" } });
  const elementFire = createFakeCheckbox({ checked: true, attributeMap: { "data-cosmetic-element-filter": "fire" } });
  const elementWater = createFakeCheckbox({ checked: true, attributeMap: { "data-cosmetic-element-filter": "water" } });
  const elementEarth = createFakeCheckbox({ checked: true, attributeMap: { "data-cosmetic-element-filter": "earth" } });
  const elementWind = createFakeCheckbox({ checked: true, attributeMap: { "data-cosmetic-element-filter": "wind" } });
  const collectionNeon = createFakeCheckbox({
    checked: false,
    attributeMap: { "data-cosmetic-collection-filter": "Neon Arcana" }
  });
  const showNewFirstInput = createFakeCheckbox({ checked: true });
  const backButton = { addEventListener() {} };
  const emptyState = { hidden: true, style: {}, classList: { toggle() {} } };

  global.document = {
    querySelector: (selector) =>
      selector === ".screen-cosmetics"
        ? {
            querySelectorAll(innerSelector) {
              if (innerSelector === "[data-cosmetic-section]") return [avatarSection, variantSection];
              if (innerSelector === "[data-cosmetic-category-filter]") return [categoryAvatar, categoryVariant];
              if (innerSelector === "[data-cosmetic-rarity-filter]") return [rarityCommon, rarityEpic];
              if (innerSelector === "[data-cosmetic-element-filter]") {
                return [elementFire, elementWater, elementEarth, elementWind];
              }
              if (innerSelector === "[data-cosmetic-collection-filter]") return [collectionNeon];
              if (
                innerSelector === "[data-randomize-after-match]" ||
                innerSelector === "[data-equip-type]" ||
                innerSelector === "[data-loadout-save]" ||
                innerSelector === "[data-loadout-apply]" ||
                innerSelector === "[data-loadout-rename]"
              ) {
                return [];
              }
              return [];
            }
          }
        : null,
    getElementById: (id) => {
      if (id === "cosmetics-show-new-first") return showNewFirstInput;
      if (id === "cosmetics-back-btn") return backButton;
      if (id === "cosmetics-empty-state") return emptyState;
      return null;
    },
    querySelectorAll: () => []
  };

  try {
    const viewState = {
      categories: new Set(["avatar", "elementCardVariant"]),
      rarities: new Set(["Common", "Epic"]),
      elements: new Set(["fire", "water", "earth", "wind"]),
      collections: new Set(),
      showNewFirst: true
    };
    cosmeticsScreen.bind({
      viewState,
      actions: {
        back: () => {},
        updateRandomizationPreferences: async () => {},
        randomizeNow: async () => {},
        equip: async () => {},
        saveLoadout: async () => {},
        applyLoadout: async () => {},
        renameLoadout: async () => {}
      }
    });

    assert.equal(avatar.hidden, false);
    assert.equal(fireVariant.hidden, false);
    assert.equal(waterVariant.hidden, false);

    elementWater.checked = false;
    elementWater.trigger("change");
    elementEarth.checked = false;
    elementEarth.trigger("change");
    elementWind.checked = false;
    elementWind.trigger("change");

    assert.equal(avatar.hidden, false);
    assert.equal(fireVariant.hidden, false);
    assert.equal(waterVariant.hidden, true);

    collectionNeon.checked = true;
    collectionNeon.trigger("change");

    assert.equal(avatar.hidden, true);
    assert.equal(fireVariant.hidden, false);
    assert.equal(waterVariant.hidden, true);

    rarityEpic.checked = false;
    rarityEpic.trigger("change");

    assert.equal(fireVariant.hidden, true);
    assert.equal(emptyState.hidden, false);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: appController keeps local-only store purchase actions blocked behind the authority-only modal", async () => {
  const previousWindow = global.window;
  const shown = [];
  const modalCalls = [];
  const hiddenModals = [];
  const profile = {
    username: "StoreKeeper",
    randomizeBackgroundEachMatch: false,
    equippedCosmetics: {
      avatar: "default_avatar",
      cardBack: "default_card_back",
      background: "default_background",
      badge: "none",
      title: "Initiate",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    },
    ownedCosmetics: {
      avatar: ["default_avatar"],
      cardBack: ["default_card_back"],
      background: ["default_background"],
      elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
      badge: ["none"],
      title: ["Initiate"]
    }
  };
  const storeStates = [
    {
      tokens: 200,
      supporterPass: false,
      catalog: {
        avatar: [
          {
            id: "fire_avatar_f",
            name: "Fire Avatar",
            owned: false,
            equipped: false,
            purchasable: true,
            price: 75,
            rarity: "Common",
            unlockSource: { type: "store" }
          }
        ],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        title: [],
        badge: []
      }
    },
    {
      tokens: 200,
      supporterPass: false,
      catalog: {
        avatar: [],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        title: [],
        badge: []
      }
    },
    {
      tokens: 200,
      supporterPass: false,
      catalog: {
        avatar: [],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        title: [],
        badge: []
      }
    }
  ];
  let storeReadCount = 0;
  let buyCalls = 0;

  global.window = {
    elemintz: {
      state: {
        getStore: async () => storeStates[Math.min(storeReadCount++, storeStates.length - 1)],
        buyStoreItem: async () => {
          buyCalls += 1;
          return { profile };
        },
        equipCosmetic: async () => ({ profile })
      }
    }
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => hiddenModals.push(true)
    },
    toastManager: { show: () => {} }
  });

  try {
    app.username = "StoreKeeper";
    app.storeViewState.searchText = "fire";
    app.storeViewState.categories = new Set(["avatar", "background"]);
    app.storeViewState.rarities = new Set(["Common", "Rare"]);

    await app.showStore();
    assert.equal(shown[0].store.tokens, 200);

    await shown.at(-1).actions.buy("avatar", "fire_avatar_f");
    await shown.at(-1).actions.buy("avatar", "fire_avatar_f");

    assert.equal(buyCalls, 0);
    assert.equal(modalCalls.length, 2);
    assert.equal(modalCalls[0].title, "Online Authority Only");
    assert.match(modalCalls[0].body, /Local store purchases are unavailable/);

    await modalCalls[0].actions[0].onClick();

    assert.equal(shown.length, 1);
    assert.equal(hiddenModals.length, 1);

    const afterBlockedBuy = shown.at(-1).viewState;

    assert.equal(shown.at(-1).store.tokens, 200);
    assert.equal(afterBlockedBuy.searchText, "fire");
    assert.deepEqual([...afterBlockedBuy.categories], ["avatar", "background"]);
    assert.deepEqual([...afterBlockedBuy.rarities], ["Common", "Rare"]);

    await shown.at(-1).actions.equip("background", "default_background");
    const afterEquip = shown.at(-1).viewState;

    assert.equal(shown.at(-1).store.tokens, 200);
    assert.equal(afterEquip.searchText, "fire");
    assert.deepEqual([...afterEquip.categories], ["avatar", "background"]);
    assert.deepEqual([...afterEquip.rarities], ["Common", "Rare"]);
  } finally {
    global.window = previousWindow;
  }
});

test("ui: appController keeps the sticky shop banner token balance unchanged when local-only purchase authority is unavailable", async () => {
  const previousWindow = global.window;
  const shown = [];
  const modalCalls = [];
  const profile = {
    username: "StoreKeeper",
    tokens: 200,
    supporterPass: false,
    equippedCosmetics: {
      avatar: "default_avatar",
      background: "default_background",
      cardBack: "default_card_back",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      },
      badge: "none",
      title: "Initiate"
    },
    ownedCosmetics: {
      avatar: ["default_avatar"],
      background: ["default_background"],
      cardBack: ["default_card_back"],
      elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
      badge: ["none"],
      title: ["Initiate"]
    }
  };
  const store = {
    tokens: 200,
    supporterPass: false,
    catalog: {
      avatar: [
        {
          id: "fire_avatar_f",
          name: "Fire Avatar",
          owned: false,
          equipped: false,
          purchasable: true,
          price: 150,
          rarity: "Common",
          unlockSource: { type: "store" }
        }
      ],
      cardBack: [],
      background: [],
      elementCardVariant: [],
      title: [],
      badge: []
    }
  };

  global.window = {
    elemintz: {
      state: {
        getStore: async () => store,
        buyStoreItem: async () => {
          throw new Error("Not enough tokens.");
        },
        equipCosmetic: async () => ({ profile })
      }
    }
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  try {
    app.username = "StoreKeeper";
    await app.showStore();
    assert.equal(shown.length, 1);
    assert.equal(shown[0].store.tokens, 200);

    await shown[0].actions.buy("avatar", "fire_avatar_f");
    assert.equal(modalCalls.length, 1);
    assert.equal(modalCalls[0].title, "Online Authority Only");
    assert.match(modalCalls[0].body, /Local store purchases are unavailable/);

    assert.equal(shown.length, 1);
    assert.equal(shown[0].store.tokens, 200);
  } finally {
    global.window = previousWindow;
  }
});

test("ui: appController shows one-time loadout unlock notice with next unlock messaging", async () => {
  const previousWindow = global.window;
  const modalCalls = [];

  global.window = {
    elemintz: {
      state: {
        acknowledgeLoadoutUnlocks: async () => ({
          profile: { username: "LoadoutHero", playerLevel: 10 },
          newlyUnlockedSlots: [1],
          nextUnlockLevel: 20
        })
      }
    }
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => {
        modalCalls.push(payload);
        payload.actions?.[0]?.onClick?.();
      },
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  try {
    app.username = "LoadoutHero";
    app.profile = { username: "LoadoutHero", playerLevel: 10 };
    await app.maybeShowLoadoutUnlockNotice();
    assert.equal(modalCalls.length, 1);
    assert.equal(modalCalls[0].title, "New Loadout Slot Unlocked!");
    assert.equal(modalCalls[0].body, undefined);
    assert.match(modalCalls[0].bodyHtml, /loadout-unlock-modal/);
    assert.match(modalCalls[0].bodyHtml, /You can now save cosmetic presets in Profile \/ Cosmetics\./);
    assert.match(modalCalls[0].bodyHtml, /<li>Avatar<\/li>/);
    assert.match(modalCalls[0].bodyHtml, /<li>Card Variants<\/li>/);
    assert.match(modalCalls[0].bodyHtml, /<strong>Save to Slot<\/strong> <span>&mdash; stores your current setup<\/span>/);
    assert.match(modalCalls[0].bodyHtml, /<strong>Load<\/strong> <span>&mdash; switches to a saved setup<\/span>/);
    assert.match(modalCalls[0].bodyHtml, /Next unlock: Level 20/);
  } finally {
    global.window = previousWindow;
  }
});

test("ui: menu countdown refresh updates labels in place without rerendering or rebinding menu buttons", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousSetInterval = global.setInterval;
  const previousClearInterval = global.clearInterval;
  const shown = [];
  let intervalHandler = null;
  let profileOpenCount = 0;

  const dailyLoginLabel = createFakeElement();
  dailyLoginLabel.textContent = "Daily Login Reward: --:--";
  const dailyResetLabel = createFakeElement();
  dailyResetLabel.textContent = "Reset in: --:--";
  const weeklyResetLabel = createFakeElement();
  weeklyResetLabel.textContent = "Reset in: --:--";
  const dailyLoginPanel = createFakeElement();
  dailyLoginPanel.innerHTML = '<p class="muted">Daily Login Reward status unavailable.</p>';
  const dailyPreviewPanel = createFakeElement();
  dailyPreviewPanel.innerHTML = '<p class="muted">Challenges are loading...</p>';
  const weeklyPreviewPanel = createFakeElement();
  weeklyPreviewPanel.innerHTML = '<p class="muted">Challenges are loading...</p>';
  const profileButton = createFakeElement();
  const elements = {
    "menu-daily-login-status": dailyLoginLabel,
    "start-pve-btn": createFakeElement(),
    "start-local-btn": createFakeElement(),
    "online-play-btn": createFakeElement(),
    "profile-btn": profileButton,
    "achievements-btn": createFakeElement(),
    "open-daily-challenges-btn": createFakeElement(),
    "cosmetics-btn": createFakeElement(),
    "store-btn": createFakeElement(),
    "roadmap-btn": createFakeElement(),
    "settings-btn": createFakeElement(),
    "how-to-play-btn": createFakeElement(),
    "feedback-btn": createFakeElement(),
    "logout-btn": createFakeElement()
  };

  global.window = {
    elemintz: {
      state: {
        getDailyChallenges: async () => ({
          dailyLogin: { eligible: false, msUntilReset: 3660000 },
          daily: { challenges: [], msUntilReset: 3660000 },
          weekly: { challenges: [], msUntilReset: 3660000 }
        })
      }
    }
  };

  global.document = {
    getElementById: (id) => elements[id] ?? null,
    querySelector: (selector) => {
      if (selector === '[data-menu-daily-login-panel="true"]') {
        return dailyLoginPanel;
      }
      if (selector === '[data-menu-challenge-preview="daily"]') {
        return dailyPreviewPanel;
      }
      if (selector === '[data-menu-challenge-preview="weekly"]') {
        return weeklyPreviewPanel;
      }
      if (selector === '[data-menu-reset-label="daily"]') {
        return dailyResetLabel;
      }
      if (selector === '[data-menu-reset-label="weekly"]') {
        return weeklyResetLabel;
      }
      return null;
    }
  };

  global.setInterval = (handler) => {
    intervalHandler = handler;
    return { unref() {} };
  };
  global.clearInterval = () => {};

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (_screen, context) => shown.push(context)
    },
    modalManager: {
      show: () => {},
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  try {
    menuScreen.bind({
      actions: {
        startPveGame: () => {},
        startLocalGame: () => {},
        openOnlinePlay: async () => {},
        openProfile: async () => {
          profileOpenCount += 1;
        },
        openAchievements: async () => {},
        openDailyChallenges: async () => {},
        openCosmetics: async () => {},
        openStore: async () => {},
        openRoadmap: () => {},
        openSettings: async () => {},
        openHowToPlay: () => {},
        openFeedback: () => {},
        logout: () => {}
      }
    });

    app.username = "MenuClickUser";
    app.profile = {
      username: "MenuClickUser",
      cosmetics: { background: "default_background" },
      equippedCosmetics: { background: "default_background" }
    };

    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await Promise.resolve();

    assert.equal(shown.length, 1);
    assert.equal(typeof intervalHandler, "function");
    assert.equal(dailyLoginLabel.textContent, "Daily Login Reward: 01:01");
    assert.equal(dailyResetLabel.textContent, "Reset in: 01:01");
    assert.equal(weeklyResetLabel.textContent, "Reset in: 01:01");
    assert.match(dailyLoginPanel.innerHTML, /menu-daily-login/);
    assert.doesNotMatch(dailyPreviewPanel.innerHTML, /Challenges are loading/);
    assert.doesNotMatch(weeklyPreviewPanel.innerHTML, /Challenges are loading/);
    assert.match(dailyPreviewPanel.innerHTML, /No daily challenges available right now\./);
    assert.match(weeklyPreviewPanel.innerHTML, /No weekly challenges available right now\./);

    intervalHandler();

    assert.equal(shown.length, 1);
    assert.equal(dailyLoginLabel.textContent, "Daily Login Reward: 01:00");
    assert.equal(dailyResetLabel.textContent, "Reset in: 01:00");
    assert.equal(weeklyResetLabel.textContent, "Reset in: 01:00");
    assert.equal(typeof profileButton.listeners.get("click"), "function");

    await profileButton.listeners.get("click")();
    assert.equal(profileOpenCount, 1);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
    global.setInterval = previousSetInterval;
    global.clearInterval = previousClearInterval;
  }
});

test("ui: appController cosmetics actions route loadout save apply and rename through state", async () => {
  const previousWindow = global.window;
  const shown = [];
  const calls = {
    updatePreferences: [],
    randomizeNow: [],
    save: [],
    apply: [],
    rename: []
  };
  const baseProfile = {
    username: "CosmeticCaptain",
    playerLevel: 20,
    equippedCosmetics: {
      avatar: "default_avatar",
      cardBack: "default_card_back",
      background: "default_background",
      badge: "none",
      title: "Initiate",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    }
  };
  const cosmetics = {
    preferences: { randomizeBackgroundEachMatch: false },
    loadouts: [
      {
        index: 0,
        slotNumber: 1,
        unlockLevel: 10,
        unlocked: true,
        name: "Loadout 1",
        hasSavedLoadout: true,
        isActive: false
      }
    ],
    catalog: {
      avatar: [],
      cardBack: [],
      background: [],
      elementCardVariant: [],
      badge: [],
      title: []
    }
  };

  global.window = {
    elemintz: {
      state: {
        getCosmetics: async () => cosmetics,
        equipCosmetic: async () => ({ profile: baseProfile }),
        updateCosmeticPreferences: async (payload) => {
          calls.updatePreferences.push(payload);
          return {
            profile: {
              ...baseProfile,
              cosmeticRandomizeAfterMatch: {
                avatar: Boolean(payload.patch?.randomizeAfterEachMatch?.avatar),
                title: false,
                badge: false,
                elementCardVariant: false,
                cardBack: false,
                background: false
              }
            }
          };
        },
        randomizeOwnedCosmetics: async (payload) => {
          calls.randomizeNow.push(payload);
          return {
            profile: {
              ...baseProfile,
              equippedCosmetics: {
                ...baseProfile.equippedCosmetics,
                avatar: "fire_avatar_f"
              }
            }
          };
        },
        saveCosmeticLoadout: async (payload) => {
          calls.save.push(payload);
          return { profile: baseProfile, cosmetics };
        },
        applyCosmeticLoadout: async (payload) => {
          calls.apply.push(payload);
          return { profile: baseProfile, cosmetics };
        },
        renameCosmeticLoadout: async (payload) => {
          calls.rename.push(payload);
          return { profile: baseProfile, cosmetics };
        }
      }
    }
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: {
      show: (payload) => payload.actions?.[0]?.onClick?.(),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  try {
    app.username = "CosmeticCaptain";
    app.profile = baseProfile;
    await app.showCosmetics();
    await shown.at(-1).actions.updateRandomizationPreferences({ avatar: true });
    await shown.at(-1).actions.randomizeNow(["avatar", "background"]);
    assert.equal(app.profile.equippedCosmetics.avatar, "fire_avatar_f");
    await shown.at(-1).actions.saveLoadout(0);
    await shown.at(-1).actions.applyLoadout(0);
    await shown.at(-1).actions.renameLoadout(0, "Storm Fit");

    assert.deepEqual(calls.updatePreferences, [
      {
        username: "CosmeticCaptain",
        patch: {
          randomizeAfterEachMatch: {
            avatar: true
          }
        }
      }
    ]);
    assert.deepEqual(calls.randomizeNow, [
      {
        username: "CosmeticCaptain",
        categories: ["avatar", "background"]
      }
    ]);
    assert.deepEqual(calls.save, [{ username: "CosmeticCaptain", slotIndex: 0 }]);
    assert.deepEqual(calls.apply, [{ username: "CosmeticCaptain", slotIndex: 0 }]);
    assert.deepEqual(calls.rename, [{ username: "CosmeticCaptain", slotIndex: 0, name: "Storm Fit" }]);
  } finally {
    global.window = previousWindow;
  }
});

test("ui: applying a saved cosmetic loadout keeps owned cosmetics visible immediately and preserves valid filters", async () => {
  const previousWindow = global.window;
  const shown = [];
  const calls = {
    apply: []
  };
  const filteredAvatar = {
    id: "avatar_aurelian_archon",
    name: "Aurelian Archon",
    image: "avatars/avatar_aurelian_archon.png",
    rarity: "Legendary",
    collection: "Goldbound Relics",
    owned: true,
    equipped: false,
    unlockSource: { type: "store" }
  };
  const baseProfile = {
    username: "LoadoutCaptain",
    playerLevel: 20,
    equippedCosmetics: {
      avatar: "default_avatar",
      cardBack: "default_card_back",
      background: "default_background",
      badge: "none",
      title: "Initiate",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    }
  };
  const cosmetics = {
    preferences: { randomizeBackgroundEachMatch: false },
    loadouts: [
      {
        index: 0,
        slotNumber: 1,
        unlockLevel: 10,
        unlocked: true,
        name: "Goldbound Fit",
        hasSavedLoadout: true,
        isActive: false
      }
    ],
    catalog: {
      avatar: [filteredAvatar],
      cardBack: [],
      background: [],
      elementCardVariant: [],
      badge: [],
      title: []
    },
    owned: {
      avatar: ["avatar_aurelian_archon"]
    },
    equipped: {
      ...baseProfile.equippedCosmetics,
      elementCardVariant: { ...baseProfile.equippedCosmetics.elementCardVariant }
    }
  };

  global.window = {
    elemintz: {
      state: {
        getCosmetics: async () => cosmetics,
        applyCosmeticLoadout: async (payload) => {
          calls.apply.push(payload);
          return {
            profile: {
              ...baseProfile,
              equippedCosmetics: {
                ...baseProfile.equippedCosmetics,
                avatar: "avatar_aurelian_archon"
              }
            },
            cosmetics: {
              ...cosmetics,
              catalog: {
                ...cosmetics.catalog,
                avatar: [{ ...filteredAvatar, equipped: true }]
              },
              equipped: {
                ...cosmetics.equipped,
                avatar: "avatar_aurelian_archon"
              },
              snapshot: {
                owned: cosmetics.owned,
                equipped: {
                  ...cosmetics.equipped,
                  avatar: "avatar_aurelian_archon"
                },
                loadouts: cosmetics.loadouts,
                preferences: cosmetics.preferences
              }
            }
          };
        }
      }
    }
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { show: () => {} }
  });

  try {
    app.username = "LoadoutCaptain";
    app.profile = baseProfile;
    app.cosmeticsViewState = {
      categories: new Set(["avatar"]),
      rarities: new Set(["legendary"]),
      collections: new Set(["Goldbound Relics"]),
      showNewFirst: false
    };

    await app.showCosmetics();
    await shown.at(-1).actions.applyLoadout(0);

    const rerenderedContext = shown.at(-1);
    const html = cosmeticsScreen.render({
      cosmetics: rerenderedContext.cosmetics,
      viewState: rerenderedContext.viewState,
      actions: {}
    });
    const avatarSectionStart = html.indexOf('data-cosmetic-section="avatar"');
    const cardBackSectionStart = html.indexOf('data-cosmetic-section="cardBack"');
    const avatarSectionHtml =
      avatarSectionStart >= 0
        ? html.slice(
            avatarSectionStart,
            cardBackSectionStart >= 0 ? cardBackSectionStart : html.length
          )
        : html;

    assert.deepEqual(calls.apply, [{ username: "LoadoutCaptain", slotIndex: 0 }]);
    assert.equal(rerenderedContext.cosmetics.catalog.avatar.length, 1);
    assert.equal(rerenderedContext.cosmetics.catalog.avatar[0].owned, true);
    assert.equal(rerenderedContext.cosmetics.catalog.avatar[0].equipped, true);
    assert.equal(rerenderedContext.cosmetics.equipped.avatar, "avatar_aurelian_archon");
    assert.equal(rerenderedContext.viewState.collections.has("Goldbound Relics"), true);
    assert.match(avatarSectionHtml, /Aurelian Archon/);
    assert.doesNotMatch(avatarSectionHtml, /No owned items in this category yet\./);
  } finally {
    global.window = previousWindow;
  }
});

test("ui: store preview includes graceful fallback for missing images", () => {
  const html = storeScreen.render({
    store: {
      tokens: 120,
      supporterPass: false,
      catalog: {
        avatar: [],
        cardBack: [
          {
            id: "missing_back",
            name: "Missing Back",
            image: "card_backs/missing_back.png",
            owned: false,
            equipped: false,
            purchasable: true,
            rarity: "Rare",
            price: 100,
            unlockSource: { type: "store" }
          }
        ],
        background: [],
        elementCardVariant: [],
        title: [],
        badge: []
      }
    }
  });

  assert.match(html, /onerror="this\.style\.display='none'; this\.nextElementSibling\.style\.display='flex';"/);
  assert.match(html, /No Preview/);
});

test("ui: store renders moved background and card variant previews from current asset paths", () => {
  const html = storeScreen.render({
    store: {
      tokens: 500,
      supporterPass: false,
      catalog: {
        avatar: [],
        cardBack: [],
        background: [
          {
            id: "fire_background",
            name: "Fire Arena",
            image: "backgrounds/fireBattleArena.png",
            owned: false,
            equipped: false,
            purchasable: true,
            rarity: "Common",
            price: 90,
            unlockSource: { type: "store" }
          }
        ],
        elementCardVariant: [
          {
            id: "fire_variant_ember",
            name: "Ember Fire",
            image: "cards/fire_variant_ember.png",
            element: "fire",
            owned: false,
            equipped: false,
            purchasable: false,
            rarity: "Common",
            price: 0,
            unlockSource: { type: "level reward", level: 15 }
          },
          {
            id: "water_variant_crystal",
            name: "Crystal Water",
            image: "cards/water_variant_crystal.png",
            element: "water",
            owned: false,
            equipped: false,
            purchasable: false,
            rarity: "Rare",
            price: 250,
            unlockSource: { type: "level reward", level: 40 }
          },
          {
            id: "earth_variant_titan",
            name: "Titan Earth",
            image: "cards/earth_variant_titan.png",
            element: "earth",
            owned: false,
            equipped: false,
            purchasable: false,
            rarity: "Epic",
            price: 450,
            unlockSource: { type: "level reward", level: 70 }
          }
        ],
        title: [],
        badge: []
      }
    }
  });

  assert.match(html, /assets\/backgrounds\/fireBattleArena\.png/);
  assert.match(html, /assets\/cards\/fire_variant_ember\.png/);
  assert.match(html, /assets\/cards\/water_variant_crystal\.png/);
  assert.match(html, /assets\/cards\/earth_variant_titan\.png/);
});

test("ui: cosmetics screen shows owned items only", () => {
  const html = cosmeticsScreen.render({
    cosmetics: {
      preferences: {
        randomizeAfterEachMatch: {
          avatar: true,
          title: true,
          badge: false,
          elementCardVariant: true,
          cardBack: false,
          background: true
        }
      },
      loadouts: [
        {
          index: 0,
          slotNumber: 1,
          unlockLevel: 10,
          unlocked: true,
          name: "Loadout 1",
          hasSavedLoadout: false,
          isActive: false
        },
        {
          index: 1,
          slotNumber: 2,
          unlockLevel: 20,
          unlocked: false,
          name: "Loadout 2",
          hasSavedLoadout: false,
          isActive: false
        }
      ],
      catalog: {
        avatar: [
          { id: "default_avatar", name: "Default Avatar", image: "avatars/default.png", owned: true, equipped: true, rarity: "Epic" },
          { id: "fire_avatar_f", name: "Fire Avatar", image: "avatars/fireavatarF.png", owned: false, equipped: false }
        ],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        badge: [],
        title: []
      }
    }
  });

  assert.match(html, /Default Avatar/);
  assert.match(html, /Randomize After Each Match/);
  assert.match(html, /data-cosmetic-randomize-panel="true"/);
  assert.match(html, /data-randomize-after-match="avatar"/);
  assert.match(html, /data-randomize-after-match="title"/);
  assert.match(html, /data-randomize-after-match="badge"/);
  assert.match(html, /data-randomize-after-match="elementCardVariant"/);
  assert.match(html, /data-randomize-after-match="cardBack"/);
  assert.match(html, /data-randomize-after-match="background"/);
  assert.match(html, /id="cosmetics-randomize-now-btn"/);
  assert.ok(html.indexOf("data-cosmetic-rarity-filter=\"Legendary\"") < html.indexOf("data-cosmetic-randomize-panel=\"true\""));
  assert.ok(html.indexOf("data-cosmetic-randomize-panel=\"true\"") < html.indexOf("data-cosmetic-section=\"avatar\""));
  assert.match(html, /Cosmetic Loadouts/);
  assert.match(html, /Equip your cosmetics, then save them to a loadout slot/);
  assert.match(html, /data-cosmetic-category-filter="avatar"/);
  assert.match(html, /data-cosmetic-category-filter="elementCardVariant"/);
  assert.match(html, /data-cosmetic-rarity-filter="Epic"/);
  assert.match(html, /data-cosmetic-section="avatar"/);
  assert.match(html, /cosmetic-rarity-label[^>]*>Epic<\/span>/);
  assert.match(html, /cosmetic-preview is-avatar is-framed/);
  assert.match(html, /cosmetic-rarity-label rarity-epic/);
  assert.match(html, />Rename</);
  assert.match(html, />Save to Slot</);
  assert.match(html, />Load</);
  assert.match(html, /data-loadout-save="0"/);
  assert.match(html, /data-loadout-rename="0"/);
  assert.match(html, /Unlocks at Level 20/);
  assert.doesNotMatch(html, /Randomize Background Each Match/);
  assert.doesNotMatch(html, /background-randomize-toggle/);
  assert.doesNotMatch(html, /Fire Avatar/);
  assert.doesNotMatch(html, /data-buy-type=/);
});

test("ui: cosmetics screen shows the Show NEW First control by default", () => {
  const html = cosmeticsScreen.render({
    cosmetics: {
      preferences: { randomizeAfterEachMatch: {} },
      loadouts: [],
      catalog: {
        avatar: [],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        title: [],
        badge: []
      }
    },
    viewState: {
      categories: new Set(["avatar", "title"]),
      rarities: new Set(["Common", "Rare"]),
      showNewFirst: true
    },
    actions: {}
  });

  assert.match(html, /Show NEW First/);
  assert.match(html, /id="cosmetics-show-new-first" checked/);
});

test("ui: cosmetics screen resolves owned NEW badges from the current catalog instead of stale item metadata", () => {
  const html = cosmeticsScreen.render({
    cosmetics: {
      preferences: { randomizeAfterEachMatch: {} },
      loadouts: [],
      catalog: {
        avatar: [
          {
            id: "avatar_neon_pyre_entity",
            name: "Neon Pyre Entity",
            image: "avatars/avatar_neon_pyre_entity.png",
            rarity: "Epic",
            owned: true,
            equipped: false,
            isNew: true
          },
          {
            id: "avatar_vampire_female",
            name: "Vampire Female",
            image: "avatars/avatar_vampire_female.png",
            rarity: "Legendary",
            owned: true,
            equipped: false,
            isNew: false
          }
        ],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        title: [],
        badge: []
      }
    },
    viewState: {
      categories: new Set(["avatar"]),
      rarities: new Set(["Epic", "Legendary"]),
      showNewFirst: true
    },
    actions: {}
  });

  const newBadges = html.match(/store-item-badge store-item-badge-new">NEW</g) ?? [];
  assert.equal(newBadges.length, 1);
  const neonAvatarCard =
    (html.match(/<article[\s\S]*?<\/article>/g) ?? []).find((article) =>
      article.includes('data-equip-id="avatar_neon_pyre_entity"')
    ) ?? "";
  const vampireAvatarCard =
    (html.match(/<article[\s\S]*?<\/article>/g) ?? []).find((article) =>
      article.includes('data-equip-id="avatar_vampire_female"')
    ) ?? "";
  assert.doesNotMatch(neonAvatarCard, /store-item-badge store-item-badge-new">NEW/);
  assert.match(vampireAvatarCard, /store-item-badge store-item-badge-new">NEW/);
  assert.match(neonAvatarCard, /Neon Pyre Entity/);
  assert.match(vampireAvatarCard, /Vampire Female/);
});

test("ui: cosmetics screen Show NEW First prioritizes currently-new owned cosmetics over stale legacy metadata", () => {
  const html = cosmeticsScreen.render({
    cosmetics: {
      preferences: { randomizeAfterEachMatch: {} },
      loadouts: [],
      catalog: {
        avatar: [
          {
            id: "avatar_smirk_ember",
            name: "Smirk Ember",
            image: "avatars/avatar_smirk_ember.png",
            rarity: "Common",
            owned: true,
            equipped: false,
            isNew: true,
            releaseTag: "v0.1.6",
            collection: "Ember"
          },
          {
            id: "avatar_neon_pyre_entity",
            name: "Neon Pyre Entity",
            image: "avatars/avatar_neon_pyre_entity.png",
            rarity: "Epic",
            owned: true,
            equipped: false,
            isNew: false,
            releaseTag: "neon_arcana_01",
            collection: "Neon Arcana"
          }
        ],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        title: [],
        badge: []
      }
    },
    viewState: {
      categories: new Set(["avatar"]),
      rarities: new Set(["Common", "Epic"]),
      collections: new Set(["Ember", "Neon Arcana"]),
      showNewFirst: true
    },
    actions: {}
  });

  assert.ok(html.indexOf("Neon Pyre Entity") < html.indexOf("Smirk Ember"));
  assert.match(html, /data-cosmetic-collection="Ember"/);
  assert.match(html, /data-cosmetic-collection="Neon Arcana"/);
});

test("ui: cosmetics screen randomization panel and loadout controls bind through actions", async () => {
  const previousDocument = global.document;
  const randomizePreferenceCalls = [];
  const randomizeNowCalls = [];
  const saveCalls = [];
  const applyCalls = [];
  const renameCalls = [];
  const backButton = { addEventListener: () => {} };
  const avatarToggle = {
    checked: true,
    listeners: new Map(),
    getAttribute: (name) => (name === "data-randomize-after-match" ? "avatar" : null),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
  };
  const backgroundToggle = {
    checked: false,
    listeners: new Map(),
    getAttribute: (name) => (name === "data-randomize-after-match" ? "background" : null),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
  };
  const randomizeNowButton = {
    listeners: new Map(),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
  };
  const saveButton = {
    listeners: new Map(),
    getAttribute: (name) => (name === "data-loadout-save" ? "0" : null),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
  };
  const applyButton = {
    listeners: new Map(),
    hasAttribute: (name) => name === "disabled" ? false : false,
    getAttribute: (name) => (name === "data-loadout-apply" ? "0" : null),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
  };
  const renameButton = {
    listeners: new Map(),
    getAttribute: (name) => (name === "data-loadout-rename" ? "0" : null),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
  };
  const renameInput = { value: "Arena Main" };

  global.document = {
    getElementById: (id) =>
      ({
        "cosmetics-back-btn": backButton,
        "cosmetics-randomize-now-btn": randomizeNowButton
      })[id] ?? null,
    querySelector: (selector) => (selector === '[data-loadout-name-input="0"]' ? renameInput : null),
    querySelectorAll: (selector) => {
      switch (selector) {
        case "[data-randomize-after-match]":
          return [avatarToggle, backgroundToggle];
        case "[data-loadout-save]":
          return [saveButton];
        case "[data-loadout-apply]":
          return [applyButton];
        case "[data-loadout-rename]":
          return [renameButton];
        default:
          return [];
      }
    }
  };

  try {
    cosmeticsScreen.bind({
      actions: {
        back: () => {},
        equip: async () => {},
        updateRandomizationPreferences: async (patch) => randomizePreferenceCalls.push(patch),
        randomizeNow: async (categories) => randomizeNowCalls.push(categories),
        saveLoadout: async (slotIndex) => saveCalls.push(slotIndex),
        applyLoadout: async (slotIndex) => applyCalls.push(slotIndex),
        renameLoadout: async (slotIndex, name) => renameCalls.push({ slotIndex, name })
      }
    });

    await avatarToggle.listeners.get("change")({ currentTarget: avatarToggle });
    await randomizeNowButton.listeners.get("click")();
    await saveButton.listeners.get("click")();
    await applyButton.listeners.get("click")();
    await renameButton.listeners.get("click")();
    assert.deepEqual(randomizePreferenceCalls, [{ avatar: true }]);
    assert.deepEqual(randomizeNowCalls, [["avatar"]]);
    assert.deepEqual(saveCalls, [0]);
    assert.deepEqual(applyCalls, [0]);
    assert.deepEqual(renameCalls, [{ slotIndex: 0, name: "Arena Main" }]);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: profile screen exposes title\/avatar and searchable profile section", () => {
  const html = profileScreen.render({
    profile: {
      username: "Hero",
      title: "Initiate",
      wins: 2,
      losses: 1,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 4,
      gamesPlayed: 3,
      bestWinStreak: 2,
      tokens: 200,
      featuredRivalWins: 7,
      gauntletBestStreak: 5,
      gauntletRuns: 3,
      gauntletWins: 8,
      gauntletLosses: 2,
      gauntletRivalsDefeated: 8,
      supporterPass: false,
      achievements: {},
      modeStats: {
        pve: { wins: 2, losses: 1, gamesPlayed: 3, cardsCaptured: 4, warsEntered: 1, warsWon: 0, longestWar: 2 },
        local_pvp: { wins: 0, losses: 0, gamesPlayed: 0, cardsCaptured: 0, warsEntered: 0, warsWon: 0, longestWar: 0 },
        online_pvp: { wins: 1, losses: 2, gamesPlayed: 3, cardsCaptured: 5, warsEntered: 2, warsWon: 1, longestWar: 3 }
      },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }, { id: "default_water_card", name: "Core Water", element: "water", owned: true }, { id: "default_earth_card", name: "Core Earth", element: "earth", owned: true }, { id: "default_wind_card", name: "Core Wind", element: "wind", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    searchResults: [{ username: "Rival" }],
    searchQuery: "Ri",
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(html, /class="player-avatar"/);
  assert.match(html, /<span>Initiate<\/span>/);
  assert.match(html, /Progress \/ Account/);
  assert.match(html, /Reward Chests/);
  assert.match(html, />Overall Record</);
  assert.match(html, />Battle Stats</);
  assert.match(html, />Mode Stats</);
  assert.match(html, />Featured Rival</);
  assert.match(html, />Gauntlet</);
  assert.match(html, /Search Player/);
  assert.match(html, /View Rival/);
  assert.match(html, /Online PvP/);
  assert.match(html, /Featured Rival Wins/);
  assert.match(html, /Best Gauntlet Streak/);
  assert.match(html, /Gauntlet Runs/);
  assert.match(html, /Gauntlet Wins/);
  assert.match(html, /Gauntlet Losses/);
  assert.match(html, /Rivals Defeated/);
  assert.match(html, /profile-stat-value">7<\/strong>/);
  assert.doesNotMatch(html, /Avatar:/);
  assert.doesNotMatch(html, /Card Back:/);
  assert.doesNotMatch(html, /Background:/);
  assert.doesNotMatch(html, /Badge:/);
  assert.doesNotMatch(html, /Title:/);
  assert.doesNotMatch(html, /Element Variants:/);
  assert.match(html, /data-preview-type="avatar"/);
  assert.match(html, /data-preview-type="title"/);
  assert.doesNotMatch(html, /data-preview-type="badge"/);
  assert.match(html, /data-preview-description="Default cosmetic\."/);
});

test("ui: profile screen renders safe fallback values for missing online and featured rival stats", () => {
  const html = profileScreen.render({
    profile: {
      username: "FallbackHero",
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    searchResults: [],
    searchQuery: "",
    profileAchievementsExpanded: false,
    viewedProfileAchievementsExpanded: false,
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(html, /Online PvP/);
  assert.match(html, /Featured Rival Wins/);
  assert.match(html, /Best Gauntlet Streak/);
  assert.match(html, /Gauntlet Runs/);
  assert.match(html, /Gauntlet Wins/);
  assert.match(html, /Gauntlet Losses/);
  assert.match(html, /Rivals Defeated/);
  assert.match(html, /profile-stat-value">0<\/strong>/);
});

test("ui: profile screen adds hover preview metadata for own and viewed badge and title identity", () => {
  const html = profileScreen.render({
    profile: {
      username: "Hero",
      title: "Apprentice",
      wins: 2,
      losses: 1,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 4,
      gamesPlayed: 3,
      bestWinStreak: 2,
      tokens: 200,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 2, losses: 1 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "title_apprentice", badge: "badge_element_initiate" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
        badge: "badge_element_initiate",
        title: "title_apprentice"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "badge_element_initiate", name: "Element Initiate", owned: true }],
        title: [{ id: "title_apprentice", name: "Apprentice", owned: true, image: "assets/titles/title_apprentice.png" }]
      }
    },
    searchResults: [],
    searchQuery: "",
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });
  const viewedProfileHtml = profileScreen.renderViewedProfileModalBody({
      username: "Rival",
      title: "Elementalist",
      wins: 5,
      losses: 2,
      warsEntered: 1,
      warsWon: 1,
      longestWar: 2,
      cardsCaptured: 9,
      gamesPlayed: 7,
      bestWinStreak: 3,
      tokens: 150,
      playerLevel: 20,
      playerXP: 400,
      achievements: {},
      modeStats: { pve: { wins: 2, losses: 0 }, local_pvp: { wins: 3, losses: 2 } },
      equippedCosmetics: {
        avatar: "avatar_novice_mage",
        title: "title_elementalist",
        badge: "badge_arena_challenger",
        background: "default_background"
      },
      cosmetics: { background: "default_background" }
  });

  assert.match(html, /data-preview-type="badge"/);
  assert.match(html, /data-preview-name="Element Initiate"/);
  assert.match(html, /data-preview-description="Level Reward: Reach Level 10\."/);
  assert.match(html, /data-preview-name="Apprentice"/);
  assert.match(html, /data-preview-description="Level Reward: Reach Level 3\."/);
  assert.match(html, /data-preview-src="[^"]*title_apprentice\.png"/);
  assert.match(viewedProfileHtml, /data-preview-name="Arena Challenger"/);
  assert.match(viewedProfileHtml, /data-preview-description="Level Reward: Reach Level 30\."/);
  assert.match(viewedProfileHtml, /data-preview-name="Elementalist"/);
  assert.match(viewedProfileHtml, /data-preview-description="Level Reward: Reach Level 20\."/);
  assert.match(viewedProfileHtml, /data-preview-src="[^"]*title_elementalist\.png"/);
});

test("ui: missing badge and missing title art stay graceful in profile identity hover markup", () => {
  const html = profileScreen.render({
    profile: {
      username: "GracefulHero",
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", image: null, owned: true }]
      }
    },
    searchResults: [],
    searchQuery: "",
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(html, /data-preview-type="title"/);
  assert.match(html, /data-preview-src=""/);
  assert.doesNotMatch(html, /data-preview-type="badge"/);
  assert.doesNotMatch(html, /alt="Featured Badge"/);
});

test("ui: appController player display prefers canonical title art when available", () => {
  const controller = createRendererController();
  const playerDisplay = controller.buildPlayerDisplay(
    {
      username: "TitleUser",
      title: "Apprentice",
      equippedCosmetics: {
        avatar: "default_avatar",
        title: "title_apprentice",
        badge: "none"
      }
    },
    "TitleUser",
    "Initiate"
  );

  assert.match(playerDisplay.titleIcon, /assets\/titles\/title_apprentice\.png/);
});

test("ui: game screen uses provided variant card images", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: {
      name: "Hero",
      avatarId: "default_avatar",
      titleId: "Initiate",
      badgeId: "badge_element_initiate",
      title: "Initiate",
      titleIcon: null,
      featuredBadge: getBadgeImage("badge_element_initiate"),
      avatar: "assets/avatars/default.png"
    },
    opponentDisplay: {
      name: "Elemental AI",
      avatarId: "default_avatar",
      titleId: null,
      badgeId: null,
      title: "Arena Rival",
      avatar: "assets/avatars/default.png"
    },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "AI" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/customFire.jpg", water: "assets/customWater.jpg", earth: "assets/customEarth.jpg", wind: "assets/customWind.jpg" },
      p2: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" }
    },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      mode: "pve",
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /assets\/customFire\.jpg/);
  assert.match(html, /Round 1 \| Turn: 20s \| Match: 05:00 \| Player Turn/);
  assert.doesNotMatch(html, /data-round-center-result="true"/);
  assert.doesNotMatch(html, /data-round-center-headline="true"/);
  assert.doesNotMatch(html, /Player: -/);
  assert.doesNotMatch(html, /Opponent: -/);
  assert.match(html, /WAR status: No active WAR pile\./);
  assert.match(html, /Captured totals: Hero 0 \| Elemental AI 0/);
  assert.doesNotMatch(html, /Captured: Player 1 • 0 \| Player 2 • 0/);
  assert.match(html, /class="hand-zone hand-zone-player"/);
  assert.match(html, /class="hand-summary-grid" id="left-hand"/);
  assert.match(html, /class="hand-slot hand-slot-fire [^"]*is-selectable/);
  assert.match(html, /class="hand-slot hand-slot-earth [^"]*is-empty/);
  assert.match(html, /class="hand-slot hand-slot-wind [^"]*is-empty/);
  assert.match(html, /class="hand-slot hand-slot-water [^"]*is-empty/);
  assert.match(html, /Fire count x1/);
  assert.match(html, /Earth count x0/);
  assert.match(html, /Wind count x0/);
  assert.match(html, /Water count x0/);
  assert.ok(html.indexOf("hand-slot-fire") < html.indexOf("hand-slot-earth"));
  assert.ok(html.indexOf("hand-slot-earth") < html.indexOf("hand-slot-wind"));
  assert.ok(html.indexOf("hand-slot-wind") < html.indexOf("hand-slot-water"));
  assert.match(html, /class="hand-slot-count-badge" aria-label="Fire count x1">x1<\/span>/);
  assert.match(html, /class="hidden-hand-summary[^"]*"/);
  assert.match(html, /Keyboard: \[1\] Fire\s+\[2\] Earth\s+\[3\] Wind\s+\[4\] Water/);
  assert.doesNotMatch(html, /hand-slot-name/);
  assert.match(html, /data-preview-type="avatar"/);
  assert.match(html, /data-preview-type="title"/);
  assert.match(html, /data-preview-type="badge"/);
});

test("ui: fatigue renders only on the local selectable hand", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "Hero", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "Arena Rival", title: "Gauntlet Rival", avatar: "assets/avatars/default.png" },
    gauntlet: { active: true, currentStreak: 3, rivalName: "Arena Rival", rivalTitle: "Gauntlet Rival" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "Arena Rival" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/customFire.jpg", water: "assets/customWater.jpg", earth: "assets/customEarth.jpg", wind: "assets/customWind.jpg" },
      p2: { fire: "assets/oppFire.jpg", water: "assets/oppWater.jpg", earth: "assets/oppEarth.jpg", wind: "assets/oppWind.jpg" }
    },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 3,
      timerSeconds: 18,
      totalMatchSeconds: 280,
      canSelectCard: true,
      mode: "pve",
      playerHand: ["fire", "water"],
      opponentHand: ["fire", "water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null,
      selectionFatigue: {
        blockedElement: "fire",
        label: "FATIGUED",
        message: "This Elemint must rest for 1 turn."
      }
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /id="left-hand">[\s\S]*hand-slot-fire[\s\S]*is-fatigued[\s\S]*title="This Elemint must rest for 1 turn\."[\s\S]*FATIGUED/);
  assert.doesNotMatch(html, /id="right-hand">[\s\S]*FATIGUED/);
  assert.equal((html.match(/hand-slot-status-badge">FATIGUED/g) ?? []).length, 1);
});

test("ui: game screen renders taunts feed and open panel without breaking the match layout", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "Hero", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "Elemental AI", title: "Arena Rival", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "AI" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: { p1: {}, p2: {} },
    taunts: {
      panelOpen: true,
      messages: [
        { id: "taunt-1", speaker: "Hero", text: "Well played.", kind: "player", isFading: true },
        { speaker: "Elemental AI", text: "Your move.", kind: "ai" }
      ],
      presetLines: ["Your move.", "Well played."],
      cooldownRemainingMs: 6500,
      canSend: false
    },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      mode: "pve",
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /id="game-taunts-toggle-btn"/);
  assert.match(html, /data-match-taunt-shell="game"/);
  assert.match(html, /data-taunt-message-id="taunt-1"/);
  assert.match(html, /match-taunt-entry [^"]*is-fading/);
  assert.match(html, /Hero<\/strong>\s*<span>Well played\.<\/span>/);
  assert.match(html, /Elemental AI<\/strong>\s*<span>Your move\.<\/span>/);
  assert.match(html, /data-match-taunt-panel="game"/);
  assert.match(html, /data-taunt-cooldown-state="cooldown"/);
  assert.match(html, />\s*7s\s*</);
  assert.match(html, /data-taunt-line="Your move\."/);
  assert.match(html, /data-taunt-line="Your move\."[^>]*disabled/);
  assert.match(html, /data-taunt-line="Well played\."/);
  assert.match(html, /data-card-owner="active"/);
});

test("ui: game taunt feed caps visible messages at four most recent entries", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "Hero", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "Elemental AI", title: "Arena Rival", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "AI" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: { p1: {}, p2: {} },
    taunts: {
      panelOpen: false,
      messages: [
        { speaker: "One", text: "1", kind: "player" },
        { speaker: "Two", text: "2", kind: "player" },
        { speaker: "Three", text: "3", kind: "player" },
        { speaker: "Four", text: "4", kind: "player" },
        { speaker: "Five", text: "5", kind: "player" }
      ]
    },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      mode: "pve",
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.doesNotMatch(html, /One<\/strong>\s*<span>1<\/span>/);
  assert.match(html, /Two<\/strong>\s*<span>2<\/span>/);
  assert.match(html, /Five<\/strong>\s*<span>5<\/span>/);
});

test("ui: cosmetic hover preview follows cursor, clamps to viewport, and hides cleanly", () => {
  function createPreviewNode(tagName) {
    const children = [];
    const classes = new Set();
    const attributes = new Map();
    return {
      tagName,
      id: "",
      hidden: false,
      className: "",
      style: {},
      textContent: "",
      src: "",
      alt: "",
      children,
      appendChild(child) {
        if (!children.includes(child)) {
          children.push(child);
        }
      },
      removeChild(child) {
        const index = children.indexOf(child);
        if (index >= 0) {
          children.splice(index, 1);
        }
      },
      contains(child) {
        return children.includes(child);
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
      removeAttribute(name) {
        attributes.delete(name);
        if (name === "src") {
          this.src = "";
        }
      },
      getAttribute(name) {
        return attributes.get(name) ?? null;
      },
      classList: {
        add: (...tokens) => tokens.forEach((token) => classes.add(token)),
        remove: (...tokens) => tokens.forEach((token) => classes.delete(token)),
        contains: (token) => classes.has(token)
      }
    };
  }

  const listeners = new Map();
  const blurListeners = new Map();
  const appended = [];
  const root = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    contains: () => true
  };

  const documentRef = {
    documentElement: { clientWidth: 300, clientHeight: 220 },
    body: {
      appendChild(node) {
        appended.push(node);
      }
    },
    createElement: (tagName) => createPreviewNode(tagName),
    defaultView: {
      innerWidth: 300,
      innerHeight: 220,
      addEventListener(type, handler) {
        blurListeners.set(type, handler);
      }
    }
  };

  bindCosmeticHoverPreview({ root, documentRef });

  const previewLayer = appended[0];
  const previewFrame = previewLayer.children[0];
  const previewImage = previewFrame.children[0];
  const avatarTarget = {
    getAttribute(name) {
      return {
        "data-preview-type": "avatar",
        "data-preview-rarity": "Epic",
        "data-preview-src": "file:///avatar.png",
        "data-preview-name": "Preview Avatar"
      }[name] ?? null;
    },
    closest: () => avatarTarget
  };
  const cardBackTarget = {
    getAttribute(name) {
      return {
        "data-preview-type": "cardBack",
        "data-preview-rarity": "Legendary",
        "data-preview-src": "file:///cardback.png",
        "data-preview-name": "Preview Card Back"
      }[name] ?? null;
    },
    closest: () => cardBackTarget
  };

  listeners.get("mouseover")({ target: avatarTarget, clientX: 280, clientY: 210 });

  assert.equal(previewLayer.hidden, false);
  assert.equal(previewLayer.style.left, "42px");
  assert.equal(previewLayer.style.top, "12px");
  assert.equal(previewImage.src, "file:///avatar.png");
  assert.equal(previewImage.alt, "Preview Avatar");
  assert.equal(previewFrame.style.width, "220px");
  assert.equal(previewFrame.style.height, "220px");
  assert.match(previewFrame.className, /is-avatar/);
  assert.match(previewFrame.className, /rarity-epic/);
  assert.equal(previewLayer.classList.contains("is-visible"), true);

  listeners.get("mousemove")({ target: cardBackTarget, clientX: 140, clientY: 150 });

  assert.equal(previewLayer.style.left, "12px");
  assert.equal(previewLayer.style.top, "12px");
  assert.equal(previewImage.src, "file:///cardback.png");
  assert.equal(previewFrame.style.width, "220px");
  assert.equal(previewFrame.style.height, "330px");
  assert.match(previewFrame.className, /is-card/);
  assert.match(previewFrame.className, /rarity-legendary/);

  listeners.get("mousemove")({ target: { closest: () => null }, clientX: 10, clientY: 10 });

  assert.equal(previewLayer.hidden, true);
  assert.equal(previewLayer.classList.contains("is-visible"), false);

  listeners.get("mouseover")({ target: avatarTarget, clientX: 80, clientY: 80 });
  blurListeners.get("blur")();

  assert.equal(previewLayer.hidden, true);
  listeners.get("mouseleave")();
  assert.equal(previewLayer.hidden, true);
});

function createHoverPreviewHarness() {
  const listeners = new Map();
  const blurListeners = new Map();
  const appended = [];
  const root = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    contains: () => true
  };
  const documentRef = {
    documentElement: { clientWidth: 900, clientHeight: 700 },
    body: {
      appendChild(node) {
        appended.push(node);
      }
    },
    createElement: (tagName) => ({
      ...((() => {
        const children = [];
        const classes = new Set();
        const attributes = new Map();
        return {
          tagName,
          id: "",
          hidden: false,
          className: "",
          style: {},
          textContent: "",
          src: "",
          alt: "",
          children,
          appendChild(child) {
            if (!children.includes(child)) {
              children.push(child);
            }
          },
          removeChild(child) {
            const index = children.indexOf(child);
            if (index >= 0) {
              children.splice(index, 1);
            }
          },
          contains(child) {
            return children.includes(child);
          },
          setAttribute(name, value) {
            attributes.set(name, String(value));
          },
          removeAttribute(name) {
            attributes.delete(name);
            if (name === "src") {
              this.src = "";
            }
          },
          getAttribute(name) {
            return attributes.get(name) ?? null;
          },
          classList: {
            add: (...tokens) => tokens.forEach((token) => classes.add(token)),
            remove: (...tokens) => tokens.forEach((token) => classes.delete(token)),
            contains: (token) => classes.has(token)
          }
        };
      })())
    }),
    defaultView: {
      innerWidth: 900,
      innerHeight: 700,
      addEventListener(type, handler) {
        blurListeners.set(type, handler);
      }
    }
  };

  bindCosmeticHoverPreview({ root, documentRef });

  const previewLayer = appended[0];
  const previewFrame = previewLayer.children.find((child) => child.className === "cosmetic-hover-preview-frame");
  const previewImage = previewFrame.children[0];
  const previewTextVisual = previewFrame.children[1];
  const previewMeta = previewLayer.children.find((child) => child.className === "cosmetic-hover-preview-meta");
  const previewName = previewMeta.children[0];
  const previewDescription = previewMeta.children[1];

  return {
    listeners,
    blurListeners,
    previewLayer,
    previewFrame,
    previewImage,
    previewTextVisual,
    previewMeta,
    previewName,
    previewDescription
  };
}

function createHoverTarget(attributes) {
  const target = {
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    querySelector() {
      return null;
    },
    closest: () => target
  };
  return target;
}

function assertPreviewHasNoMedia({
  previewLayer,
  previewFrame,
  previewImage,
  previewMeta,
  previewName,
  previewDescription,
  expectedName,
  expectedDescription
}) {
  assert.equal(previewFrame.hidden, true);
  assert.equal(previewImage.hidden, true);
  assert.equal(previewImage.src, "");
  assert.equal(previewLayer.children.includes(previewFrame), false);
  assert.equal(previewMeta.hidden, false);
  assert.equal(previewLayer.children.includes(previewMeta), true);
  assert.equal(previewName.textContent, expectedName);
  assert.equal(previewDescription.textContent, expectedDescription);
}

test("ui: cosmetic hover preview renders title and badge metadata while keeping avatar image-only", () => {
  const {
    listeners,
    previewLayer,
    previewFrame,
    previewImage,
    previewTextVisual,
    previewMeta,
    previewName,
    previewDescription
  } = createHoverPreviewHarness();
  const titleTarget = createHoverTarget({
    "data-preview-type": "title",
    "data-preview-rarity": "Rare",
    "data-preview-src": "",
    "data-preview-name": "Apprentice",
    "data-preview-description": "Level Reward: Reach Level 3.",
    "data-preview-visual-text": "Apprentice"
  });
  const badgeTarget = createHoverTarget({
    "data-preview-type": "badge",
    "data-preview-rarity": "Epic",
    "data-preview-src": "file:///badge.png",
    "data-preview-name": "Arena Challenger",
    "data-preview-description": "Level Reward: Reach Level 30."
  });

  listeners.get("mouseover")({ target: titleTarget, clientX: 40, clientY: 40 });
  assert.equal(previewLayer.hidden, false);
  assert.equal(previewFrame.hidden, true);
  assert.equal(previewTextVisual.hidden, true);
  assert.equal(previewImage.hidden, true);
  assert.equal(previewLayer.children.includes(previewFrame), false);
  assert.equal(previewMeta.hidden, false);
  assert.equal(previewName.textContent, "Apprentice");
  assert.equal(previewDescription.textContent, "Level Reward: Reach Level 3.");
  assert.match(previewFrame.className, /is-title/);

  listeners.get("mousemove")({ target: badgeTarget, clientX: 60, clientY: 60 });
  assert.equal(previewFrame.hidden, false);
  assert.equal(previewTextVisual.hidden, true);
  assert.equal(previewImage.hidden, false);
  assert.equal(previewImage.src, "file:///badge.png");
  assert.equal(previewLayer.children.includes(previewFrame), true);
  assert.equal(previewLayer.children.includes(previewMeta), true);
  assert.equal(previewName.textContent, "Arena Challenger");
  assert.equal(previewDescription.textContent, "Level Reward: Reach Level 30.");
  assert.match(previewFrame.className, /is-badge/);
  assert.match(previewFrame.className, /rarity-epic/);
});

test("ui: title and badge hover previews fall back to text-only meta when image src is unusable", () => {
  const { listeners, previewLayer, previewFrame, previewImage, previewMeta, previewName, previewDescription } =
    createHoverPreviewHarness();
  const titleTarget = createHoverTarget({
    "data-preview-type": "title",
    "data-preview-rarity": "Common",
    "data-preview-src": "Initiate",
    "data-preview-name": "Initiate",
    "data-preview-description": "Default cosmetic.",
    "data-preview-visual-text": "Initiate"
  });
  const badgeTarget = createHoverTarget({
    "data-preview-type": "badge",
    "data-preview-rarity": "Rare",
    "data-preview-src": "Element Initiate",
    "data-preview-name": "Element Initiate",
    "data-preview-description": "Level Reward: Reach Level 10."
  });

  listeners.get("mouseover")({ target: titleTarget, clientX: 40, clientY: 40 });
  assert.equal(previewLayer.hidden, false);
  assertPreviewHasNoMedia({
    previewLayer,
    previewFrame,
    previewImage,
    previewMeta,
    previewName,
    previewDescription,
    expectedName: "Initiate",
    expectedDescription: "Default cosmetic."
  });

  listeners.get("mousemove")({ target: badgeTarget, clientX: 70, clientY: 70 });
  assertPreviewHasNoMedia({
    previewLayer,
    previewFrame,
    previewImage,
    previewMeta,
    previewName,
    previewDescription,
    expectedName: "Element Initiate",
    expectedDescription: "Level Reward: Reach Level 10."
  });
});

test("ui: title and badge hover previews reject truthy label-like src values instead of rendering broken images", () => {
  const { listeners, previewLayer, previewFrame, previewImage, previewMeta, previewName, previewDescription } =
    createHoverPreviewHarness();
  const apprenticeTarget = createHoverTarget({
    "data-preview-type": "title",
    "data-preview-rarity": "Rare",
    "data-preview-src": "Apprentice",
    "data-preview-name": "Apprentice",
    "data-preview-description": "Level Reward: Reach Level 3.",
    "data-preview-visual-text": "Apprentice"
  });
  const initiateBadgeTarget = createHoverTarget({
    "data-preview-type": "badge",
    "data-preview-rarity": "Common",
    "data-preview-src": "Element Initiate",
    "data-preview-name": "Element Initiate",
    "data-preview-description": "Level Reward: Reach Level 10."
  });

  listeners.get("mouseover")({ target: apprenticeTarget, clientX: 48, clientY: 48 });
  assert.equal(previewLayer.hidden, false);
  assertPreviewHasNoMedia({
    previewLayer,
    previewFrame,
    previewImage,
    previewMeta,
    previewName,
    previewDescription,
    expectedName: "Apprentice",
    expectedDescription: "Level Reward: Reach Level 3."
  });

  listeners.get("mousemove")({ target: initiateBadgeTarget, clientX: 72, clientY: 72 });
  assertPreviewHasNoMedia({
    previewLayer,
    previewFrame,
    previewImage,
    previewMeta,
    previewName,
    previewDescription,
    expectedName: "Element Initiate",
    expectedDescription: "Level Reward: Reach Level 10."
  });
});

test("ui: identity hover preview keeps avatars image-only and text-only titles compact", () => {
  const { listeners, previewLayer, previewFrame, previewMeta } = createHoverPreviewHarness();
  const avatarTarget = createHoverTarget({
    "data-preview-type": "avatar",
    "data-preview-rarity": "Epic",
    "data-preview-src": "assets/avatars/avatar_arcane_gambler.png",
    "data-preview-name": "Arcane Gambler",
    "data-preview-description": ""
  });
  const titleTarget = createHoverTarget({
    "data-preview-type": "title",
    "data-preview-rarity": "Common",
    "data-preview-src": "",
    "data-preview-name": "Initiate",
    "data-preview-description": "Default cosmetic.",
    "data-preview-visual-text": "Initiate"
  });

  listeners.get("mouseover")({ target: avatarTarget, clientX: 40, clientY: 40 });
  assert.equal(previewFrame.hidden, false);
  assert.equal(previewMeta.hidden, true);
  assert.equal(previewLayer.children.includes(previewMeta), false);
  assert.equal(previewLayer.style.width, "220px");
  assert.equal(previewLayer.style.height, "220px");

  listeners.get("mousemove")({ target: titleTarget, clientX: 72, clientY: 72 });
  assert.equal(previewFrame.hidden, true);
  assert.equal(previewMeta.hidden, false);
  assert.equal(previewLayer.children.includes(previewMeta), true);
  assert.equal(previewLayer.style.width, "228px");
  assert.equal(previewLayer.style.height, "86px");
});

test("ui: title hover preview uses square full-image framing when title art exists", () => {
  const { listeners, previewLayer, previewFrame, previewImage } = createHoverPreviewHarness();
  const titleTarget = createHoverTarget({
    "data-preview-type": "title",
    "data-preview-rarity": "Epic",
    "data-preview-src": "file:///title.png",
    "data-preview-name": "War Master",
    "data-preview-description": "Level Reward: Reach Level 50.",
    "data-preview-visual-text": "War Master"
  });

  listeners.get("mouseover")({ target: titleTarget, clientX: 100, clientY: 100 });

  assert.equal(previewLayer.hidden, false);
  assert.equal(previewImage.hidden, false);
  assert.equal(previewImage.src, "file:///title.png");
  assert.equal(previewFrame.style.width, "188px");
  assert.equal(previewFrame.style.height, "188px");
  assert.equal(previewLayer.style.width, "228px");
  assert.equal(previewLayer.style.height, "286px");
  assert.match(previewFrame.className, /is-title/);
});

test("ui: legacy badge-backed titles such as Flame Vanguard still render their title image in store and cosmetics", () => {
  const storeHtml = storeScreen.render({
    store: {
      tokens: 0,
      supporterPass: false,
      catalog: {
        avatar: [],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        badge: [],
        title: [
          {
            id: "Flame Vanguard",
            name: "Flame Vanguard",
            image: "badges/firstFlame.png",
            owned: false,
            equipped: false,
            purchasable: false,
            price: 0,
            rarity: "Common",
            unlockSource: { type: "level reward", level: 3 }
          }
        ]
      }
    }
  });

  const cosmeticsHtml = cosmeticsScreen.render({
    cosmetics: {
      preferences: {},
      loadouts: [],
      catalog: {
        avatar: [],
        cardBack: [],
        background: [],
        elementCardVariant: [],
        badge: [],
        title: [
          {
            id: "Flame Vanguard",
            name: "Flame Vanguard",
            image: "badges/firstFlame.png",
            owned: true,
            equipped: true,
            rarity: "Common"
          }
        ]
      }
    }
  });

  assert.match(storeHtml, /data-preview-type="title"[^>]*data-preview-src="[^"]*badges\/firstFlame\.png"/);
  assert.match(storeHtml, /src="[^"]*badges\/firstFlame\.png"[^>]*alt="Flame Vanguard"/);
  assert.match(cosmeticsHtml, /data-preview-type="title"[^>]*data-preview-src="[^"]*badges\/firstFlame\.png"/);
  assert.match(cosmeticsHtml, /src="[^"]*badges\/firstFlame\.png"[^>]*alt="Flame Vanguard"/);
});

test("ui: meta-only title hover keeps using its compact rendered size while the cursor moves", () => {
  function createPreviewNode(tagName) {
    const children = [];
    const classes = new Set();
    const attributes = new Map();
    return {
      tagName,
      id: "",
      hidden: false,
      className: "",
      style: {},
      textContent: "",
      src: "",
      alt: "",
      children,
      appendChild(child) {
        if (!children.includes(child)) {
          children.push(child);
        }
      },
      removeChild(child) {
        const index = children.indexOf(child);
        if (index >= 0) {
          children.splice(index, 1);
        }
      },
      contains(child) {
        return children.includes(child);
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
      removeAttribute(name) {
        attributes.delete(name);
        if (name === "src") {
          this.src = "";
        }
      },
      getAttribute(name) {
        return attributes.get(name) ?? null;
      },
      classList: {
        add: (...tokens) => tokens.forEach((token) => classes.add(token)),
        remove: (...tokens) => tokens.forEach((token) => classes.delete(token)),
        contains: (token) => classes.has(token)
      }
    };
  }

  const listeners = new Map();
  const appended = [];
  const root = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    contains: () => true
  };
  const documentRef = {
    documentElement: { clientWidth: 320, clientHeight: 160 },
    body: {
      appendChild(node) {
        appended.push(node);
      }
    },
    createElement: (tagName) => createPreviewNode(tagName),
    defaultView: {
      innerWidth: 320,
      innerHeight: 160,
      addEventListener() {}
    }
  };

  bindCosmeticHoverPreview({ root, documentRef });

  const previewLayer = appended[0];
  const titleTarget = createHoverTarget({
    "data-preview-type": "title",
    "data-preview-rarity": "Common",
    "data-preview-src": "",
    "data-preview-name": "Initiate",
    "data-preview-description": "Default cosmetic.",
    "data-preview-visual-text": "Initiate"
  });

  listeners.get("mouseover")({ target: titleTarget, clientX: 40, clientY: 40 });
  listeners.get("mousemove")({ target: titleTarget, clientX: 40, clientY: 120 });

  assert.equal(previewLayer.style.height, "86px");
  assert.equal(previewLayer.style.top, "62px");
});

test("ui: background hover preview uses a landscape contain frame with no portrait clipping", () => {
  const { listeners, previewLayer, previewFrame, previewImage } = createHoverPreviewHarness();
  const backgroundTarget = createHoverTarget({
    "data-preview-type": "background",
    "data-preview-rarity": "Legendary",
    "data-preview-src": "file:///background.png",
    "data-preview-name": "Sky Temple"
  });

  listeners.get("mouseover")({ target: backgroundTarget, clientX: 100, clientY: 100 });

  assert.equal(previewLayer.hidden, false);
  assert.equal(previewImage.hidden, false);
  assert.equal(previewImage.src, "file:///background.png");
  assert.equal(previewFrame.style.width, "340px");
  assert.equal(previewFrame.style.height, "240px");
  assert.equal(previewLayer.style.width, "340px");
  assert.equal(previewLayer.style.height, "240px");
  assert.match(previewFrame.className, /is-background/);
  assert.match(previewFrame.className, /rarity-legendary/);
});

test("ui: portrait backgrounds use aspect-aware hover sizing instead of a forced landscape box", () => {
  const { listeners, previewFrame, previewLayer } = createHoverPreviewHarness();
  const backgroundTarget = createHoverTarget({
    "data-preview-type": "background",
    "data-preview-rarity": "Epic",
    "data-preview-src": "file:///portrait-background.png",
    "data-preview-name": "Celestial Observatory",
    "data-preview-width": "1024",
    "data-preview-height": "1536"
  });

  listeners.get("mouseover")({ target: backgroundTarget, clientX: 100, clientY: 100 });

  assert.equal(previewFrame.style.width, "160px");
  assert.equal(previewFrame.style.height, "240px");
  assert.equal(previewLayer.style.width, "160px");
  assert.equal(previewLayer.style.height, "240px");
});

test("ui: legacy profile and match title hover targets use their portrait image dimensions in the large preview", () => {
  const { listeners, previewFrame, previewLayer } = createHoverPreviewHarness();
  const portraitTitleImage = {
    naturalWidth: 1024,
    naturalHeight: 1536
  };
  const titleTarget = createHoverTarget({
    "data-preview-type": "title",
    "data-preview-rarity": "Common",
    "data-preview-src": "file:///badges/firstFlame.png",
    "data-preview-name": "Flame Vanguard",
    "data-preview-description": "Win your first match.",
    "data-preview-visual-text": "Flame Vanguard"
  });
  titleTarget.querySelector = (selector) => (selector === ".cosmetic-preview" || selector === "img" ? portraitTitleImage : null);

  listeners.get("mouseover")({ target: titleTarget, clientX: 100, clientY: 100 });

  assert.equal(previewFrame.style.width, "125px");
  assert.equal(previewFrame.style.height, "188px");
  assert.equal(previewLayer.style.width, "228px");
  assert.equal(previewLayer.style.height, "286px");
  assert.match(previewFrame.className, /is-title/);
});

test("ui: square backgrounds use aspect-aware hover sizing instead of a forced landscape box", () => {
  const { listeners, previewFrame, previewLayer } = createHoverPreviewHarness();
  const backgroundTarget = createHoverTarget({
    "data-preview-type": "background",
    "data-preview-rarity": "Rare",
    "data-preview-src": "file:///square-background.png",
    "data-preview-name": "Crystal Nexus",
    "data-preview-width": "1024",
    "data-preview-height": "1024"
  });

  listeners.get("mouseover")({ target: backgroundTarget, clientX: 100, clientY: 100 });

  assert.equal(previewFrame.style.width, "240px");
  assert.equal(previewFrame.style.height, "240px");
  assert.equal(previewLayer.style.width, "240px");
  assert.equal(previewLayer.style.height, "240px");
});

test("ui: hover preview layer keeps centered alignment for mixed-width frame and meta layouts", () => {
  const css = fs.readFileSync(
    "C:\\Users\\mxz\\Desktop\\Projects\\Codex EleMintz PC\\src\\renderer\\styles\\layout.css",
    "utf8"
  );

  assert.match(css, /\.cosmetic-hover-preview-layer\s*\{[^}]*justify-items:\s*center;/);
});

test("ui: viewed profile imageless title hover renders text-only with no media box", () => {
  const { listeners, previewLayer, previewFrame, previewImage, previewMeta, previewName, previewDescription } =
    createHoverPreviewHarness();
  const viewedProfileTitleTarget = createHoverTarget({
    "data-preview-type": "title",
    "data-preview-rarity": "Common",
    "data-preview-src": "   ",
    "data-preview-name": "Initiate",
    "data-preview-description": "Default cosmetic.",
    "data-preview-visual-text": "Initiate"
  });

  listeners.get("mouseover")({ target: viewedProfileTitleTarget, clientX: 80, clientY: 80 });

  assertPreviewHasNoMedia({
    previewLayer,
    previewFrame,
    previewImage,
    previewMeta,
    previewName,
    previewDescription,
    expectedName: "Initiate",
    expectedDescription: "Default cosmetic."
  });
});

test("ui: shared game surface imageless title hover renders text-only with no media box", () => {
  const { listeners, previewLayer, previewFrame, previewImage, previewMeta, previewName, previewDescription } =
    createHoverPreviewHarness();
  const pvpTitleTarget = createHoverTarget({
    "data-preview-type": "title",
    "data-preview-rarity": "Common",
    "data-preview-src": "",
    "data-preview-name": "Initiate",
    "data-preview-description": "Default cosmetic.",
    "data-preview-visual-text": "Initiate"
  });

  listeners.get("mouseover")({ target: pvpTitleTarget, clientX: 84, clientY: 84 });

  assertPreviewHasNoMedia({
    previewLayer,
    previewFrame,
    previewImage,
    previewMeta,
    previewName,
    previewDescription,
    expectedName: "Initiate",
    expectedDescription: "Default cosmetic."
  });
});

test("ui: online shared surface imageless title hover renders text-only with no media box", () => {
  const { listeners, previewLayer, previewFrame, previewImage, previewMeta, previewName, previewDescription } =
    createHoverPreviewHarness();
  const onlineTitleTarget = createHoverTarget({
    "data-preview-type": "title",
    "data-preview-rarity": "Rare",
    "data-preview-src": null,
    "data-preview-name": "Legacy Founder",
    "data-preview-description": "Event Reward.",
    "data-preview-visual-text": "Legacy Founder"
  });

  listeners.get("mouseover")({ target: onlineTitleTarget, clientX: 88, clientY: 88 });

  assertPreviewHasNoMedia({
    previewLayer,
    previewFrame,
    previewImage,
    previewMeta,
    previewName,
    previewDescription,
    expectedName: "Legacy Founder",
    expectedDescription: "Event Reward."
  });
});

test("ui: imageless title hover clears stale media after an image-backed hover", () => {
  const { listeners, previewLayer, previewFrame, previewImage, previewMeta, previewName, previewDescription } =
    createHoverPreviewHarness();
  const imageBackedTitleTarget = createHoverTarget({
    "data-preview-type": "title",
    "data-preview-rarity": "Epic",
    "data-preview-src": "file:///title.png",
    "data-preview-name": "War Master",
    "data-preview-description": "Level Reward: Reach Level 50.",
    "data-preview-visual-text": "War Master"
  });
  const imagelessTitleTarget = createHoverTarget({
    "data-preview-type": "title",
    "data-preview-rarity": "Common",
    "data-preview-src": "",
    "data-preview-name": "Initiate",
    "data-preview-description": "Default cosmetic.",
    "data-preview-visual-text": "Initiate"
  });

  listeners.get("mouseover")({ target: imageBackedTitleTarget, clientX: 92, clientY: 92 });
  assert.equal(previewLayer.children.includes(previewFrame), true);
  assert.equal(previewImage.hidden, false);
  assert.equal(previewImage.src, "file:///title.png");

  listeners.get("mousemove")({ target: imagelessTitleTarget, clientX: 96, clientY: 96 });

  assertPreviewHasNoMedia({
    previewLayer,
    previewFrame,
    previewImage,
    previewMeta,
    previewName,
    previewDescription,
    expectedName: "Initiate",
    expectedDescription: "Default cosmetic."
  });
});

test("ui: image-backed title, badge, avatar, and cardback hovers still render media correctly", () => {
  const { listeners, previewLayer, previewFrame, previewImage, previewMeta, previewName, previewDescription } =
    createHoverPreviewHarness();
  const titleTarget = createHoverTarget({
    "data-preview-type": "title",
    "data-preview-rarity": "Epic",
    "data-preview-src": "file:///title.png",
    "data-preview-name": "War Master",
    "data-preview-description": "Level Reward: Reach Level 50.",
    "data-preview-visual-text": "War Master"
  });
  const badgeTarget = createHoverTarget({
    "data-preview-type": "badge",
    "data-preview-rarity": "Rare",
    "data-preview-src": "file:///badge.png",
    "data-preview-name": "Element Veteran",
    "data-preview-description": "Level Reward: Reach Level 40."
  });
  const avatarTarget = createHoverTarget({
    "data-preview-type": "avatar",
    "data-preview-rarity": "Epic",
    "data-preview-src": "file:///avatar.png",
    "data-preview-name": "Arcane Gambler"
  });
  const cardBackTarget = createHoverTarget({
    "data-preview-type": "cardBack",
    "data-preview-rarity": "Legendary",
    "data-preview-src": "file:///cardback.png",
    "data-preview-name": "Void Spiral"
  });

  listeners.get("mouseover")({ target: titleTarget, clientX: 100, clientY: 100 });
  assert.equal(previewLayer.children.includes(previewFrame), true);
  assert.equal(previewImage.hidden, false);
  assert.equal(previewImage.src, "file:///title.png");
  assert.equal(previewMeta.hidden, false);
  assert.equal(previewName.textContent, "War Master");
  assert.equal(previewDescription.textContent, "Level Reward: Reach Level 50.");

  listeners.get("mousemove")({ target: badgeTarget, clientX: 104, clientY: 104 });
  assert.equal(previewLayer.children.includes(previewFrame), true);
  assert.equal(previewImage.hidden, false);
  assert.equal(previewImage.src, "file:///badge.png");
  assert.equal(previewMeta.hidden, false);
  assert.equal(previewName.textContent, "Element Veteran");

  listeners.get("mousemove")({ target: avatarTarget, clientX: 108, clientY: 108 });
  assert.equal(previewLayer.children.includes(previewFrame), true);
  assert.equal(previewImage.hidden, false);
  assert.equal(previewImage.src, "file:///avatar.png");
  assert.equal(previewMeta.hidden, true);
  assert.equal(previewLayer.children.includes(previewMeta), false);

  listeners.get("mousemove")({ target: cardBackTarget, clientX: 112, clientY: 112 });
  assert.equal(previewLayer.children.includes(previewFrame), true);
  assert.equal(previewImage.hidden, false);
  assert.equal(previewImage.src, "file:///cardback.png");
  assert.equal(previewMeta.hidden, true);
  assert.equal(previewLayer.children.includes(previewMeta), false);
});

test("ui: cosmetics screen category filters hide unselected owned sections", () => {
  const previousDocument = global.document;

  const avatarItems = [
    { hidden: false, style: {}, classList: { toggle() {} }, getAttribute: (name) => (name === "data-cosmetic-rarity" ? "Epic" : null) }
  ];
  const titleItems = [
    { hidden: false, style: {}, classList: { toggle() {} }, getAttribute: (name) => (name === "data-cosmetic-rarity" ? "Common" : null) }
  ];
  const avatarGrid = createFakeGrid(avatarItems);
  const titleGrid = createFakeGrid(titleItems);
  const avatarSection = {
    hidden: false,
    style: {},
    classList: { toggle() {} },
    getAttribute: () => "avatar",
    querySelector: (selector) => (selector === ".cosmetic-grid" ? avatarGrid : null),
    querySelectorAll: (selector) => (selector === ".cosmetic-item" ? avatarGrid.items : [])
  };
  const titleSection = {
    hidden: false,
    style: {},
    classList: { toggle() {} },
    getAttribute: () => "title",
    querySelector: (selector) => (selector === ".cosmetic-grid" ? titleGrid : null),
    querySelectorAll: (selector) => (selector === ".cosmetic-item" ? titleGrid.items : [])
  };
  const avatarFilter = {
    checked: true,
    getAttribute: (name) => (name === "data-cosmetic-category-filter" ? "avatar" : null),
    addEventListener(type, handler) {
      this.handler = handler;
    }
  };
  const titleFilter = {
    checked: true,
    getAttribute: (name) => (name === "data-cosmetic-category-filter" ? "title" : null),
    addEventListener(type, handler) {
      this.handler = handler;
    }
  };
  const commonRarityFilter = {
    checked: true,
    getAttribute: (name) => (name === "data-cosmetic-rarity-filter" ? "Common" : null),
    addEventListener(type, handler) {
      this.handler = handler;
    }
  };
  const epicRarityFilter = {
    checked: true,
    getAttribute: (name) => (name === "data-cosmetic-rarity-filter" ? "Epic" : null),
    addEventListener(type, handler) {
      this.handler = handler;
    }
  };
  const emptyState = { hidden: true, style: {}, classList: { toggle() {} } };
  const backButton = { addEventListener() {} };

  const cosmeticsRoot = {
    querySelectorAll: (selector) => {
      switch (selector) {
        case "[data-cosmetic-section]":
          return [avatarSection, titleSection];
        case "[data-cosmetic-category-filter]":
          return [avatarFilter, titleFilter];
        case "[data-cosmetic-rarity-filter]":
          return [commonRarityFilter, epicRarityFilter];
        case "[data-randomize-after-match]":
        case "[data-equip-type]":
        case "[data-loadout-save]":
        case "[data-loadout-apply]":
        case "[data-loadout-rename]":
          return [];
        default:
          return [];
      }
    }
  };

  global.document = {
    querySelector: (selector) => (selector === ".screen-cosmetics" ? cosmeticsRoot : null),
    getElementById: (id) =>
      ({
        "cosmetics-back-btn": backButton,
        "cosmetics-empty-state": emptyState
      })[id] ?? null,
    querySelectorAll: () => []
  };

  try {
    cosmeticsScreen.bind({
      viewState: { categories: new Set(["avatar", "title"]), rarities: new Set(["Common", "Epic"]) },
      actions: {
        back: async () => {},
        equip: async () => {},
        updateRandomizationPreferences: async () => {},
        randomizeNow: async () => {},
        saveLoadout: async () => {},
        applyLoadout: async () => {},
        renameLoadout: async () => {}
      }
    });

    titleFilter.checked = false;
    titleFilter.handler();

    assert.equal(avatarSection.hidden, false);
    assert.equal(titleSection.hidden, true);
    assert.equal(titleSection.style.display, "none");
    assert.equal(emptyState.hidden, true);

    epicRarityFilter.checked = false;
    epicRarityFilter.handler();

    assert.equal(avatarItems[0].hidden, true);
    assert.equal(avatarSection.hidden, true);
    assert.equal(emptyState.hidden, false);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: store screen Show NEW First sorts new cosmetics before non-new while preserving default order when off", () => {
  const previousDocument = global.document;

  const newItem = createSortableItem({
    "data-store-name": "smirk ember",
    "data-store-type": "avatar",
    "data-store-rarity": "Common",
    "data-store-is-new": "true",
    "data-store-original-index": "1"
  });
  const oldItem = createSortableItem({
    "data-store-name": "fire avatar",
    "data-store-type": "avatar",
    "data-store-rarity": "Common",
    "data-store-is-new": "false",
    "data-store-original-index": "0"
  });
  const grid = createFakeGrid([oldItem, newItem]);
  const section = {
    hidden: false,
    style: {},
    classList: { toggle() {} },
    querySelector: (selector) => (selector === ".cosmetic-grid" ? grid : null),
    querySelectorAll: (selector) => (selector === "[data-store-item]" ? grid.items : []),
    getAttribute: () => "avatar"
  };
  const categoryInput = createFakeCheckbox({ checked: true, attributeMap: { "data-store-category-filter": "avatar" } });
  const rarityInput = createFakeCheckbox({ checked: true, attributeMap: { "data-store-rarity-filter": "Common" } });
  const showNewFirstInput = createFakeCheckbox({ checked: true });
  const backButton = { addEventListener() {} };
  const root = {
    querySelectorAll(selector) {
      if (selector === "[data-store-item]") {
        return grid.items;
      }
      if (selector === "[data-store-section]") {
        return [section];
      }
      if (selector === "[data-store-category-filter]") {
        return [categoryInput];
      }
      if (selector === "[data-store-rarity-filter]") {
        return [rarityInput];
      }
      if (selector === "[data-buy-type]" || selector === "[data-equip-type]") {
        return [];
      }
      return [];
    }
  };
  const emptyState = { hidden: true, style: {}, classList: { toggle() {} } };

  global.document = {
    querySelector: (selector) => (selector === ".screen-store" ? root : null),
    getElementById: (id) => {
      if (id === "store-show-new-first") return showNewFirstInput;
      if (id === "store-back-btn") return backButton;
      if (id === "store-empty-state") return emptyState;
      return null;
    }
  };

  try {
    const viewState = {
      searchText: "",
      categories: new Set(["avatar"]),
      rarities: new Set(["Common"]),
      showNewFirst: true
    };
    storeScreen.bind({
      viewState,
      actions: {
        back: () => {},
        activateSupporter: () => {}
      }
    });

    assert.equal(grid.items[0], newItem);
    assert.equal(grid.items[1], oldItem);

    showNewFirstInput.checked = false;
    showNewFirstInput.trigger("change");

    assert.equal(grid.items[0], oldItem);
    assert.equal(grid.items[1], newItem);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: cosmetics screen Show NEW First sorts new owned cosmetics first across categories", () => {
  const previousDocument = global.document;

  const newBadgeItem = createSortableItem({
    "data-cosmetic-rarity": "Common",
    "data-cosmetic-is-new": "true",
    "data-cosmetic-original-index": "1"
  });
  const oldBadgeItem = createSortableItem({
    "data-cosmetic-rarity": "Common",
    "data-cosmetic-is-new": "false",
    "data-cosmetic-original-index": "0"
  });
  const avatarGrid = createFakeGrid([oldBadgeItem, newBadgeItem]);
  const avatarSection = {
    hidden: false,
    style: {},
    classList: { toggle() {} },
    querySelector: (selector) => (selector === ".cosmetic-grid" ? avatarGrid : null),
    querySelectorAll: (selector) => (selector === ".cosmetic-item" ? avatarGrid.items : []),
    getAttribute: () => "badge"
  };
  const categoryInput = createFakeCheckbox({ checked: true, attributeMap: { "data-cosmetic-category-filter": "badge" } });
  const rarityInput = createFakeCheckbox({ checked: true, attributeMap: { "data-cosmetic-rarity-filter": "Common" } });
  const showNewFirstInput = createFakeCheckbox({ checked: true });
  const backButton = { addEventListener() {} };

  global.document = {
    querySelector: (selector) => (selector === ".screen-cosmetics" ? {
      querySelectorAll(innerSelector) {
        if (innerSelector === "[data-cosmetic-section]") return [avatarSection];
        if (innerSelector === "[data-cosmetic-category-filter]") return [categoryInput];
        if (innerSelector === "[data-cosmetic-rarity-filter]") return [rarityInput];
        if (
          innerSelector === "[data-randomize-after-match]" ||
          innerSelector === "[data-equip-type]" ||
          innerSelector === "[data-loadout-save]" ||
          innerSelector === "[data-loadout-apply]" ||
          innerSelector === "[data-loadout-rename]"
        ) {
          return [];
        }
        return [];
      }
    } : null),
    getElementById: (id) => {
      if (id === "cosmetics-show-new-first") return showNewFirstInput;
      if (id === "cosmetics-back-btn") return backButton;
      if (id === "cosmetics-empty-state") return { hidden: true, style: {}, classList: { toggle() {} } };
      return null;
    },
    querySelectorAll: () => []
  };

  try {
    const viewState = {
      categories: new Set(["badge"]),
      rarities: new Set(["Common"]),
      showNewFirst: true
    };
    cosmeticsScreen.bind({
      viewState,
      actions: {
        back: () => {},
        updateRandomizationPreferences: async () => {},
        randomizeNow: async () => {},
        equip: async () => {},
        saveLoadout: async () => {},
        applyLoadout: async () => {},
        renameLoadout: async () => {}
      }
    });

    assert.equal(avatarGrid.items[0], newBadgeItem);
    assert.equal(avatarGrid.items[1], oldBadgeItem);

    showNewFirstInput.checked = false;
    showNewFirstInput.trigger("change");

    assert.equal(avatarGrid.items[0], oldBadgeItem);
    assert.equal(avatarGrid.items[1], newBadgeItem);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: Store banner controls still bind while the token balance lives in the sticky topbar", async () => {
  const previousDocument = global.document;
  const calls = [];

  function createControl() {
    const listeners = new Map();
    return {
      hidden: false,
      style: {},
      classList: { toggle() {} },
      listeners,
      addEventListener(type, handler) {
        listeners.set(type, handler);
      }
    };
  }

  const backButton = createControl();
  const searchInput = createControl();
  searchInput.value = "";
  const emptyState = { hidden: true, style: {}, classList: { toggle() {} } };
  const root = {
    querySelectorAll(selector) {
      switch (selector) {
        case "[data-buy-type]":
        case "[data-equip-type]":
        case "[data-store-item]":
        case "[data-store-section]":
        case "[data-store-category-filter]":
        case "[data-store-rarity-filter]":
          return [];
        default:
          return [];
      }
    }
  };

  global.document = {
    getElementById: (id) =>
      ({
        "store-back-btn": backButton,
        "store-search-input": searchInput,
        "store-empty-state": emptyState
      })[id] ?? null,
    querySelector: (selector) => (selector === ".screen-store" ? root : null),
    querySelectorAll: root.querySelectorAll
  };

  try {
    storeScreen.bind({
      actions: {
        back: () => calls.push("back"),
        buy: async () => {},
        equip: async () => {}
      }
    });

    await backButton.listeners.get("click")();

    assert.deepEqual(calls, ["back"]);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: store buy buttons disable with a pending state and ignore rapid repeat clicks while a purchase is in flight", async () => {
  const previousDocument = global.document;
  let releasePurchase = null;
  let purchaseCalls = 0;

  function createControl(attrs = {}, textContent = "Buy") {
    const listeners = new Map();
    return {
      hidden: false,
      disabled: false,
      checked: true,
      value: "",
      textContent,
      style: {},
      classList: { toggle() {} },
      listeners,
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      getAttribute(name) {
        return attrs[name] ?? null;
      }
    };
  }

  const backButton = createControl();
  const searchInput = createControl();
  const emptyState = { hidden: true, style: {}, classList: { toggle() {} } };
  const avatarBuyButton = createControl(
    {
      "data-buy-type": "avatar",
      "data-buy-id": "avatar_aurelian_archon",
      "data-buy-default-label": "Buy"
    },
    "Buy"
  );
  const titleBuyButton = createControl(
    {
      "data-buy-type": "title",
      "data-buy-id": "title_goldbound",
      "data-buy-default-label": "Buy"
    },
    "Buy"
  );
  const root = {
    querySelectorAll(selector) {
      switch (selector) {
        case "[data-buy-type]":
          return [avatarBuyButton, titleBuyButton];
        case "[data-equip-type]":
        case "[data-store-item]":
        case "[data-store-section]":
        case "[data-store-category-filter]":
        case "[data-store-rarity-filter]":
          return [];
        default:
          return [];
      }
    }
  };

  global.document = {
    getElementById: (id) =>
      ({
        "store-back-btn": backButton,
        "store-search-input": searchInput,
        "store-empty-state": emptyState
      })[id] ?? null,
    querySelector: (selector) => (selector === ".screen-store" ? root : null),
    querySelectorAll: root.querySelectorAll
  };

  try {
    storeScreen.bind({
      actions: {
        back: () => {},
        buy: async (type, cosmeticId) => {
          purchaseCalls += 1;
          assert.equal(type, "avatar");
          assert.equal(cosmeticId, "avatar_aurelian_archon");
          await new Promise((resolve) => {
            releasePurchase = resolve;
          });
        },
        equip: async () => {}
      }
    });

    const clickAvatar = avatarBuyButton.listeners.get("click");
    const clickTitle = titleBuyButton.listeners.get("click");

    const firstPurchase = clickAvatar();
    assert.equal(purchaseCalls, 1);
    assert.equal(avatarBuyButton.disabled, true);
    assert.equal(titleBuyButton.disabled, true);
    assert.equal(avatarBuyButton.textContent, "Purchasing...");
    assert.equal(titleBuyButton.textContent, "Buy");

    const repeatedPurchase = clickAvatar();
    const otherItemPurchase = clickTitle();
    await Promise.resolve();

    assert.equal(purchaseCalls, 1);

    releasePurchase?.();
    await Promise.all([firstPurchase, repeatedPurchase, otherItemPurchase]);

    assert.equal(avatarBuyButton.disabled, false);
    assert.equal(titleBuyButton.disabled, false);
    assert.equal(avatarBuyButton.textContent, "Buy");
    assert.equal(titleBuyButton.textContent, "Buy");
  } finally {
    global.document = previousDocument;
  }
});

test("ui: cosmetics screen renders safely when cosmetics payload is null", () => {
  let html = "";
  assert.doesNotThrow(() => {
    html = cosmeticsScreen.render({
      cosmetics: null,
      viewState: {},
      profile: {
        cosmeticRandomizeAfterMatch: {}
      }
    });
  });

  assert.match(html, /Cosmetics \/ Rewards/);
  assert.match(html, /Cosmetic Loadouts/);
  assert.match(html, /No owned items in this category yet\./);
});

test("ui: game screen escapes player-controlled names before inserting markup", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: {
      name: `<Hero "One">`,
      title: `Initiate & "Ready"`,
      avatar: "assets/avatars/default.png"
    },
    opponentDisplay: {
      name: `Villain's <Tag>`,
      title: "Arena Rival",
      avatar: "assets/avatars/default.png"
    },
    hotseat: {
      enabled: true,
      activePlayer: "p1",
      turnLabel: `<Hero "One"> Turn`,
      p1Name: `<Hero "One">`,
      p2Name: `Villain's <Tag>`
    },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" },
      p2: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" }
    },
    game: {
      roundOutcome: { key: "player_win", label: "Player wins" },
      roundResult: "Resolved.",
      round: 3,
      timerSeconds: 18,
      totalMatchSeconds: 180,
      canSelectCard: true,
      mode: "local_pvp",
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 2, p2: 1 },
      lastRound: { result: "p1", p1Card: "fire", p2Card: "water" }
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /&lt;Hero &quot;One&quot;&gt;/);
  assert.match(html, /Villain&#39;s &lt;Tag&gt;/);
  assert.match(html, /Initiate &amp; &quot;Ready&quot;/);
  assert.match(html, /&lt;Hero &quot;One&quot;&gt; Turn/);
  assert.doesNotMatch(html, /<Hero "One">/);
  assert.doesNotMatch(html, /Villain's <Tag>/);
});

test("ui: appController applies random PvE AI style from the global catalog", () => {
  const shown = [];
  const originalRandom = Math.random;

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shown.push({ name, context })
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { showAchievement: () => {} }
  });

  app.username = "StyleUser";
  app.profile = {
    username: "StyleUser",
    equippedCosmetics: {
      avatar: "default_avatar",
      cardBack: "default_card_back",
      background: "default_background",
      badge: "none",
      title: "Initiate",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    }
  };
  app.settings = {
    gameplay: { timerSeconds: 30 },
    aiDifficulty: "hard",
    aiOpponentStyle: "random",
    ui: { reducedMotion: true },
    audio: { enabled: true }
  };

  app.gameController = {
    pauseLocalTurnTimer: () => {},
    resumeLocalTurnTimer: () => {},
    getViewModel: () => ({
      status: "active",
      mode: "pve",
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    })
  };

  try {
    Math.random = () => 0;
    app.pveOpponentStyle = app.buildPveOpponentStyle();
    app.showGame();
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(shown.at(-1).name, "game");
  assert.equal(shown.at(-1).context.opponentDisplay.name, "Elemental AI");
  assert.notEqual(shown.at(-1).context.opponentDisplay.title, "Arena Rival");
  assert.doesNotMatch(shown.at(-1).context.opponentDisplay.avatar, /avatars\/default\.png/);
  assert.notEqual(shown.at(-1).context.opponentDisplay.badgeId, "none");
  assert.ok(shown.at(-1).context.opponentDisplay.featuredBadge);
  assert.doesNotMatch(shown.at(-1).context.cardBacks.p2, /default_back\.(jpg|png)/);
  assert.deepEqual(shown.at(-1).context.opponentCardVariants, {
    fire: "default_fire_card",
    water: "default_water_card",
    earth: "default_earth_card",
    wind: "default_wind_card"
  });
  assert.equal(shown.at(-1).context.cosmeticIds.variants.p2, null);
});

test("ui: local PvP showGame exposes opponent card variants from player two cosmetics", () => {
  const shown = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shown.push({ name, context })
    },
    modalManager: {
      show: () => {},
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  app.profile = {
    username: "PlayerOne",
    equippedCosmetics: {
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    }
  };
  app.localPlayers = {
    p1: "PlayerOne",
    p2: "PlayerTwo"
  };
  app.localProfiles = {
    p1: app.profile,
    p2: {
      username: "PlayerTwo",
      equippedCosmetics: {
        cardBack: "default_card_back",
        elementCardVariant: {
          fire: "fire_variant_phoenix",
          water: "water_variant_crystal",
          earth: "earth_variant_titan",
          wind: "wind_variant_storm_eye"
        }
      }
    }
  };
  app.gameController = {
    pauseLocalTurnTimer: () => {},
    resumeLocalTurnTimer: () => {},
    getViewModel: () => ({
      status: "active",
      mode: MATCH_MODE.LOCAL_PVP,
      hotseatTurn: "p1",
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    })
  };

  app.showGame();

  assert.equal(shown.at(-1).name, "game");
  assert.deepEqual(shown.at(-1).context.opponentCardVariants, {
    fire: "fire_variant_phoenix",
    water: "water_variant_crystal",
    earth: "earth_variant_titan",
    wind: "wind_variant_storm_eye"
  });
});

test("ui: local PvP showGame exposes player one variants to the Player 2 hotseat view", () => {
  const shown = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (name, context) => shown.push({ name, context })
    },
    modalManager: {
      show: () => {},
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  app.profile = {
    username: "PlayerOne",
    equippedCosmetics: {
      elementCardVariant: {
        fire: "fire_variant_phoenix",
        water: "water_variant_crystal",
        earth: "earth_variant_titan",
        wind: "wind_variant_storm_eye"
      }
    }
  };
  app.localPlayers = {
    p1: "PlayerOne",
    p2: "PlayerTwo"
  };
  app.localProfiles = {
    p1: app.profile,
    p2: {
      username: "PlayerTwo",
      equippedCosmetics: {
        cardBack: "default_card_back",
        elementCardVariant: {
          fire: "fire_variant_ember",
          water: "water_variant_tidal_spirit",
          earth: "earth_variant_rooted_monolith",
          wind: "wind_variant_sky_serpent"
        }
      }
    }
  };
  app.gameController = {
    pauseLocalTurnTimer: () => {},
    resumeLocalTurnTimer: () => {},
    getViewModel: () => ({
      status: "active",
      mode: MATCH_MODE.LOCAL_PVP,
      hotseatTurn: "p2",
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    })
  };

  app.showGame();

  assert.equal(shown.at(-1).name, "game");
  assert.deepEqual(shown.at(-1).context.opponentCardVariants, {
    fire: "fire_variant_phoenix",
    water: "water_variant_crystal",
    earth: "earth_variant_titan",
    wind: "wind_variant_storm_eye"
  });
});

test("ui: normalized online room state exposes authoritative opponent card variants with safe defaults", () => {
  const controller = createRendererController();
  controller.onlinePlayState = {
    socketId: "host-1"
  };

  const normalized = controller.normalizeOnlinePlayState({
    connectionStatus: "connected",
    socketId: "host-1",
    room: {
      roomCode: "ABC123",
      status: "full",
      host: {
        socketId: "host-1",
        username: "LocalUser",
        equippedCosmetics: {
          elementCardVariant: {
            fire: "fire_variant_phoenix",
            water: "water_variant_crystal",
            earth: "earth_variant_titan",
            wind: "wind_variant_storm_eye"
          }
        }
      },
      guest: {
        socketId: "guest-1",
        username: "RemoteUser",
        equippedCosmetics: {
          elementCardVariant: {
            fire: "fire_variant_ember",
            water: "water_variant_tidal_spirit",
            earth: "invalid_remote_variant",
            wind: "wind_variant_sky_serpent"
          }
        }
      }
    }
  });

  assert.deepEqual(normalized.room.opponentCardVariants, {
    fire: "fire_variant_ember",
    water: "water_variant_tidal_spirit",
    earth: "default_earth_card",
    wind: "wind_variant_sky_serpent"
  });
});

test("ui: PvE bottom-right WAR tracker uses opponent variants instead of player variants", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "Hero", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "Elemental AI", title: "Arena Rival", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "AI" },
    presentation: { phase: "result", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/customFire.jpg", water: "assets/customWater.jpg", earth: "assets/customEarth.jpg", wind: "assets/customWind.jpg" },
      p2: { fire: "assets/oppFire.jpg", water: "assets/oppWater.jpg", earth: "assets/oppEarth.jpg", wind: "assets/oppWind.jpg" }
    },
    opponentCardVariants: {
      fire: "fire_variant_phoenix",
      water: "water_variant_tidal_spirit",
      earth: "earth_variant_titan",
      wind: "wind_variant_storm_eye"
    },
    game: {
      roundOutcome: { key: "war_triggered", label: "WAR triggered" },
      roundResult: "WAR triggered.",
      round: 2,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      mode: "pve",
      warActive: true,
      playerHand: [],
      opponentHand: [],
      pileCount: 4,
      totalWarClashes: 2,
      warPileCards: ["fire", "earth", "water", "wind"],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /assets\/cards\/fire_variant_phoenix\.png/);
  assert.match(html, /assets\/cards\/water_variant_tidal_spirit\.png/);
  assert.match(html, /assets\/cards\/earth_variant_titan\.png/);
  assert.match(html, /assets\/cards\/wind_variant_storm_eye\.png/);
  assert.match(html, /assets\/customFire\.jpg/);
  assert.match(html, /WAR Fire x1/);
  assert.match(html, /class="war-impact-ring"/);
});

test("ui: local PvP bottom-right WAR tracker uses player two variants", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "P1", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "P2", title: "Initiate", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: true, activePlayer: "p1", turnLabel: "P1 Turn", p1Name: "P1", p2Name: "P2" },
    presentation: { phase: "result", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/customFire.jpg", water: "assets/customWater.jpg", earth: "assets/customEarth.jpg", wind: "assets/customWind.jpg" },
      p2: { fire: "assets/oppFire.jpg", water: "assets/oppWater.jpg", earth: "assets/oppEarth.jpg", wind: "assets/oppWind.jpg" }
    },
    opponentCardVariants: {
      fire: "fire_variant_ember",
      water: "water_variant_crystal",
      earth: "earth_variant_rooted_monolith",
      wind: "wind_variant_sky_serpent"
    },
    cardBacks: { p1: "assets/cards/customP1Back.jpg", p2: "assets/cards/customP2Back.jpg" },
    game: {
      roundOutcome: { key: "war_triggered", label: "WAR triggered" },
      roundResult: "WAR triggered.",
      round: 3,
      timerSeconds: 18,
      totalMatchSeconds: 280,
      canSelectCard: true,
      mode: "local_pvp",
      playerHand: [],
      opponentHand: [],
      pileCount: 2,
      totalWarClashes: 1,
      warPileCards: ["fire", "earth"],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /assets\/cards\/fire_variant_ember\.png/);
  assert.match(html, /assets\/cards\/earth_variant_rooted_monolith\.png/);
  assert.match(html, /assets\/customFire\.jpg/);
  assert.match(html, /WAR Fire x1/);
  assert.match(html, /WAR Earth x1/);
});

test("ui: gameplay WAR tracker safely falls back to default opponent cards when variants are missing", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "RemoteHero", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "RemoteOpponent", title: "Initiate", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "RemoteHero", p2Name: "RemoteOpponent" },
    presentation: { phase: "result", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/customFire.jpg", water: "assets/customWater.jpg", earth: "assets/customEarth.jpg", wind: "assets/customWind.jpg" },
      p2: { fire: "assets/oppFire.jpg", water: "assets/oppWater.jpg", earth: "assets/oppEarth.jpg", wind: "assets/oppWind.jpg" }
    },
    opponentCardVariants: {
      fire: "fire_variant_phoenix",
      water: "invalid_remote_variant",
      earth: null,
      wind: "wind_variant_vortex_spirit"
    },
    game: {
      roundOutcome: { key: "war_triggered", label: "WAR triggered" },
      roundResult: "WAR triggered.",
      round: 4,
      timerSeconds: 18,
      totalMatchSeconds: 260,
      canSelectCard: true,
      mode: "pve",
      warActive: true,
      playerHand: [],
      opponentHand: [],
      pileCount: 4,
      totalWarClashes: 1,
      warPileCards: ["fire", "water", "earth", "wind"],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /assets\/cards\/fire_variant_phoenix\.png/);
  assert.match(html, /assets\/cards\/water\.jpg/);
  assert.match(html, /assets\/cards\/earth\.jpg/);
  assert.match(html, /assets\/cards\/wind_variant_vortex_spirit\.png/);
  assert.match(html, /WAR Water x1/);
  assert.match(html, /WAR Earth x1/);
});

test("ui: online authoritative opponent variants can drive the gameplay WAR tracker display", () => {
  const controller = createRendererController();
  controller.onlinePlayState = {
    socketId: "host-1",
    session: {
      username: "LocalUser"
    }
  };

  const normalized = controller.normalizeOnlinePlayState({
    connectionStatus: "connected",
    socketId: "host-1",
    session: {
      username: "LocalUser"
    },
    room: {
      roomCode: "ABC123",
      status: "full",
      host: {
        socketId: "host-1",
        username: "LocalUser",
        equippedCosmetics: {
          elementCardVariant: {
            fire: "fire_variant_phoenix",
            water: "water_variant_crystal",
            earth: "earth_variant_titan",
            wind: "wind_variant_storm_eye"
          }
        }
      },
      guest: {
        socketId: "guest-1",
        username: "RemoteUser",
        equippedCosmetics: {
          elementCardVariant: {
            fire: "fire_variant_ember",
            water: "water_variant_tidal_spirit",
            earth: "earth_variant_rooted_monolith",
            wind: "wind_variant_sky_serpent"
          }
        }
      }
    }
  });

  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "LocalUser", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "RemoteUser", title: "Initiate", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "LocalUser", p2Name: "RemoteUser" },
    presentation: { phase: "result", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/customFire.jpg", water: "assets/customWater.jpg", earth: "assets/customEarth.jpg", wind: "assets/customWind.jpg" },
      p2: { fire: "assets/oppFire.jpg", water: "assets/oppWater.jpg", earth: "assets/oppEarth.jpg", wind: "assets/oppWind.jpg" }
    },
    opponentCardVariants: normalized.room.opponentCardVariants,
    game: {
      roundOutcome: { key: "war_triggered", label: "WAR triggered" },
      roundResult: "WAR triggered.",
      round: 5,
      timerSeconds: 18,
      totalMatchSeconds: 250,
      canSelectCard: true,
      mode: "pve",
      warActive: true,
      playerHand: [],
      opponentHand: [],
      pileCount: 2,
      totalWarClashes: 1,
      warPileCards: ["fire", "wind"],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /assets\/cards\/fire_variant_ember\.png/);
  assert.match(html, /assets\/cards\/wind_variant_sky_serpent\.png/);
  assert.match(html, /assets\/customFire\.jpg/);
});

test("ui: online play screen renders the opponent variant showcase from authoritative room data without counts", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      room: {
        roomCode: "ABC123",
        status: "full",
        hostResolvedIdentity: {
          slotLabel: "Host",
          username: "LocalUser",
          connected: true,
          avatarImage: getAvatarImage("avatar_fourfold_lord"),
          backgroundImage: getArenaBackground("bg_elemental_throne"),
          cardBackId: "cardback_elemental_nexus",
          cardBackImage: getCardBackImage("cardback_elemental_nexus"),
          titleLabel: "War Master",
          badgeImage: getBadgeImage("badge_arena_legend"),
          variantSelection: {
            fire: "fire_variant_phoenix",
            water: "water_variant_crystal",
            earth: "earth_variant_titan",
            wind: "wind_variant_storm_eye"
          },
          variantImages: getVariantCardImages({
            fire: "fire_variant_phoenix",
            water: "water_variant_crystal",
            earth: "earth_variant_titan",
            wind: "wind_variant_storm_eye"
          })
        },
        guestResolvedIdentity: {
          slotLabel: "Guest",
          username: "RemoteUser",
          connected: true,
          avatarImage: getAvatarImage("avatar_storm_oracle"),
          backgroundImage: getArenaBackground("bg_storm_temple"),
          cardBackId: "cardback_storm_spiral",
          cardBackImage: getCardBackImage("cardback_storm_spiral"),
          titleLabel: "Element Sovereign",
          badgeImage: getBadgeImage("badge_element_veteran"),
          variantSelection: {
            fire: "fire_variant_ember",
            water: "water_variant_tidal_spirit",
            earth: "earth_variant_rooted_monolith",
            wind: "wind_variant_sky_serpent"
          },
          variantImages: getVariantCardImages({
            fire: "fire_variant_ember",
            water: "water_variant_tidal_spirit",
            earth: "earth_variant_rooted_monolith",
            wind: "wind_variant_sky_serpent"
          })
        },
        host: { socketId: "host-1", username: "LocalUser" },
        guest: { socketId: "guest-1", username: "RemoteUser" },
        hostScore: 0,
        guestScore: 0,
        roundNumber: 2,
        lastOutcomeType: "war",
        hostHand: { fire: 2, earth: 1, wind: 0, water: 3 },
        guestHand: { fire: 9, earth: 0, wind: 0, water: 0 },
        opponentCardVariants: {
          fire: "fire_variant_ember",
          water: "invalid_remote_variant",
          earth: "earth_variant_rooted_monolith",
          wind: "wind_variant_sky_serpent"
        },
        warActive: true,
        warDepth: 1,
        warRounds: [],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: true,
          submittedCount: 2,
          bothSubmitted: true,
          updatedAt: "2026-03-19T12:00:05.000Z"
        }
      }
    },
    actions: {}
  });

  assert.match(html, /data-online-opponent-variant-tracker="true"/);
  assert.match(html, /Opponent Card Style/);
  assert.match(html, /assets\/cards\/fire_variant_ember\.png/);
  assert.match(html, /assets\/cards\/water\.jpg/);
  assert.match(html, /assets\/cards\/earth_variant_rooted_monolith\.png/);
  assert.match(html, /assets\/cards\/wind_variant_sky_serpent\.png/);
  assert.match(html, /Opponent Fire card style/);
  assert.match(html, /Opponent Earth card style/);
  assert.match(html, /Opponent Wind card style/);
  assert.match(html, /Opponent Water card style/);
  assert.doesNotMatch(html, /war-slot-count-badge/);
  assert.doesNotMatch(html, /Opponent Fire x\d+/);
  assert.doesNotMatch(html, /Opponent Earth x\d+/);
  assert.doesNotMatch(html, /Opponent Wind x\d+/);
  assert.doesNotMatch(html, /Opponent Water x\d+/);
});

test("ui: moved element card variants resolve from assets/cards", () => {
  const variants = getVariantCardImages({
    fire: "arcane_fire_card",
    water: "wave_water_card",
    earth: "bold_earth_card",
    wind: "smokey_wind_card"
  });

  assert.match(variants.fire, /assets\/cards\/arcaneFire\.jpg/);
  assert.match(variants.water, /assets\/cards\/wave\.jpg/);
  assert.match(variants.earth, /assets\/cards\/boldEarth\.jpg/);
  assert.match(variants.wind, /assets\/cards\/smokeyWind\.jpg/);
});

test("ui: cosmetic asset helpers resolve expansion avatars, backgrounds, card backs, and card variants from category folders", () => {
  const variants = getVariantCardImages({
    fire: "fire_variant_phoenix",
    water: "water_variant_tidal_spirit",
    earth: "earth_variant_stone_colossus",
    wind: "wind_variant_sky_serpent"
  });

  assert.match(getAvatarImage("avatar_fourfold_lord"), /assets\/avatars\/avatar_fourfold_lord\.png/);
  assert.match(getCardBackImage("cardback_elemental_nexus"), /assets\/card_backs\/cardback_elemental_nexus\.png/);
  assert.match(getArenaBackground("bg_elemental_throne"), /assets\/backgrounds\/bg_elemental_throne\.png/);
  assert.match(variants.fire, /assets\/cards\/fire_variant_phoenix\.png/);
  assert.match(variants.water, /assets\/cards\/water_variant_tidal_spirit\.png/);
  assert.match(variants.earth, /assets\/cards\/earth_variant_stone_colossus\.png/);
  assert.match(variants.wind, /assets\/cards\/wind_variant_sky_serpent\.png/);
});

test("ui: player hand summary counts are derived from full hand contents and sum to the real hand size", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "Hero", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "Elemental AI", title: "Arena Rival", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "AI" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/customFire.jpg", water: "assets/customWater.jpg", earth: "assets/customEarth.jpg", wind: "assets/customWind.jpg" },
      p2: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" }
    },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      mode: "pve",
      playerHand: ["fire", "fire", "earth", "earth", "wind", "wind", "water", "water"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /Hero \(8\)/);
  assert.match(html, /Fire count x2/);
  assert.match(html, /Earth count x2/);
  assert.match(html, /Wind count x2/);
  assert.match(html, /Water count x2/);
});

test("ui: viewed profile modal shows only unlocked achievements with badge images", () => {
  const html = profileScreen.renderViewedProfileModalBody(
    {
      username: "Rival",
      title: "Initiate",
      playerLevel: 4,
      playerXP: 83,
      tokens: 245,
      gamesPlayed: 7,
      warsEntered: 3,
      warsWon: 2,
      longestWar: 4,
      bestWinStreak: 3,
      wins: 2,
      losses: 3,
      cardsCaptured: 10,
      achievements: {
        first_flame: { count: 1 },
        quick_draw: { count: 0 }
      },
      modeStats: {
        pve: { wins: 2, losses: 1 },
        local_pvp: { wins: 0, losses: 2 }
      },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", background: "default_background" }
    },
    {
      achievementsExpanded: true
    }
  );

  assert.match(html, /data-profile-overview-level="true">[0-9]+</);
  assert.match(html, /data-profile-overview-xp-value="true">[0-9]+ \/ [0-9]+</);
  assert.match(html, /data-profile-overview-tokens="true">245</);
  assert.match(html, /profile-stat-label">Games Played<\/span>\s*<strong class="profile-stat-value">7<\/strong>/);
  assert.match(
    html,
    new RegExp(`Achievements \\(1\\/${ACHIEVEMENT_DEFINITIONS.length}\\)`)
  );
  assert.match(html, /Hide Achievements/);
  assert.match(html, /firstFlame\.png/);
  assert.doesNotMatch(html, /quickDraw\.png/);
});

test("ui: profile unlocked achievements render approved expansion badge asset paths", () => {
  const html = profileScreen.render({
    profile: {
      username: "ExpansionViewer",
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 7,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {
        longest_war_5: { count: 1 },
        longest_war_7: { count: 1 },
        all_elements_25: { count: 1 }
      },
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    searchResults: [],
    searchQuery: "",
    profileAchievementsExpanded: true,
    viewedProfileAchievementsExpanded: false,
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(html, /assets\/badges\/badge_longest_war_5\.png/);
  assert.match(html, /assets\/badges\/badge_longest_war_7\.png/);
  assert.match(html, /assets\/badges\/badge_all_elements_25\.png/);
});

test("ui: profile renders all valid attained achievements and shows achievement progress heading", () => {
  const html = profileScreen.render({
    profile: {
      username: "CatalogUser",
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 7,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {
        first_flame: { count: 1 },
        longest_war_7: { count: 1 },
        level_50: { count: 1 },
        quick_draw: { count: 4 },
        legacy_badge: { count: 9 }
      },
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    searchResults: [],
    searchQuery: "",
    profileAchievementsExpanded: true,
    viewedProfileAchievementsExpanded: false,
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(
    html,
    new RegExp(`Achievements \\(4\\/${ACHIEVEMENT_DEFINITIONS.length}\\)`)
  );
  assert.match(html, /First Flame/);
  assert.match(html, /Cataclysm Clash/);
  assert.match(html, /EleMintz Paragon/);
  assert.match(html, /Quick Draw/);
  assert.match(html, /Repeat Count: 4/);
  assert.doesNotMatch(html, /legacy_badge/);
});

test("ui: profile achievements default collapsed while keeping count visible", () => {
  const zeroHtml = profileScreen.render({
    profile: {
      username: "ZeroUser",
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    searchResults: [],
    searchQuery: "",
    profileAchievementsExpanded: false,
    viewedProfileAchievementsExpanded: false,
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(
    zeroHtml,
    new RegExp(`Achievements \\(0\\/${ACHIEVEMENT_DEFINITIONS.length}\\)`)
  );
  assert.match(zeroHtml, /Show Achievements/);
  assert.doesNotMatch(zeroHtml, /No achievements unlocked yet\./);
});

test("ui: profile achievements expanded zero state shows hide label and empty message", () => {
  const zeroHtml = profileScreen.render({
    profile: {
      username: "ZeroUser",
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    searchResults: [],
    searchQuery: "",
    profileAchievementsExpanded: true,
    viewedProfileAchievementsExpanded: false,
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(zeroHtml, /Hide Achievements/);
  assert.match(zeroHtml, /No achievements unlocked yet\./);
});

test("ui: profile achievements toggle keeps search and chest controls visible", () => {
  const html = profileScreen.render({
    profile: {
      username: "CatalogUser",
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 7,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {
        first_flame: { count: 1 }
      },
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    searchResults: [{ username: "Rival" }],
    searchQuery: "Ri",
    profileAchievementsExpanded: false,
    viewedProfileAchievementsExpanded: false,
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(html, /Search Player/);
  assert.match(html, /View another player's profile\./);
  assert.match(html, /placeholder="Enter username"/);
  assert.match(html, />View Profile</);
  assert.match(html, /Reward Chests/);
  assert.match(html, /View Rival/);
  assert.match(html, /Show Achievements/);
  assert.doesNotMatch(html, /First Flame/);
  assert.ok(html.indexOf("Search Player") < html.indexOf("Overall Record"));
  assert.ok(html.indexOf("Search Player") < html.indexOf("Achievements"));
});

test("ui: viewed profile achievements default collapsed while keeping count visible", () => {
  const html = profileScreen.render({
    profile: {
      username: "Viewer",
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }, { id: "default_water_card", name: "Core Water", element: "water", owned: true }, { id: "default_earth_card", name: "Core Earth", element: "earth", owned: true }, { id: "default_wind_card", name: "Core Wind", element: "wind", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    searchResults: [],
    searchQuery: "",
    profileAchievementsExpanded: false,
    viewedProfileAchievementsExpanded: false,
    viewedProfile: {
      username: "Rival",
      title: "Initiate",
      playerLevel: 4,
      playerXP: 83,
      tokens: 245,
      gamesPlayed: 7,
      warsEntered: 3,
      warsWon: 2,
      longestWar: 4,
      bestWinStreak: 3,
      wins: 2,
      losses: 3,
      cardsCaptured: 10,
      featuredRivalWins: 4,
      gauntletBestStreak: 6,
      gauntletRuns: 4,
      gauntletWins: 9,
      gauntletLosses: 3,
      gauntletRivalsDefeated: 9,
      achievements: {
        first_flame: { count: 1 },
        quick_draw: { count: 0 }
      },
      modeStats: {
        pve: { wins: 2, losses: 1, gamesPlayed: 3, cardsCaptured: 6, warsEntered: 2, warsWon: 1, longestWar: 4 },
        local_pvp: { wins: 0, losses: 2, gamesPlayed: 2, cardsCaptured: 3, warsEntered: 1, warsWon: 0, longestWar: 2 },
        online_pvp: { wins: 1, losses: 3, gamesPlayed: 4, cardsCaptured: 7, warsEntered: 2, warsWon: 1, longestWar: 3 }
      },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", background: "default_background" }
    },
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.doesNotMatch(html, /Viewing: Rival/);
  assert.doesNotMatch(html, /viewed-profile-panel/);
  assert.doesNotMatch(html, /Close Viewed Profile/);
  assert.match(html, /profile-search-input/);
  assert.doesNotMatch(html, /id="cosmetic-form"/);
});

test("ui: viewed profile modal body keeps read-only profile sections and gauntlet stats", () => {
  const html = profileScreen.renderViewedProfileModalBody(
    {
      username: "Rival",
      title: "Initiate",
      playerLevel: 4,
      playerXP: 83,
      tokens: 245,
      gamesPlayed: 7,
      warsEntered: 3,
      warsWon: 2,
      longestWar: 4,
      bestWinStreak: 3,
      wins: 2,
      losses: 3,
      cardsCaptured: 10,
      featuredRivalWins: 4,
      gauntletBestStreak: 6,
      gauntletRuns: 4,
      gauntletWins: 9,
      gauntletLosses: 3,
      gauntletRivalsDefeated: 9,
      achievements: {
        first_flame: { count: 1 },
        quick_draw: { count: 0 }
      },
      modeStats: {
        pve: { wins: 2, losses: 1, gamesPlayed: 3, cardsCaptured: 6, warsEntered: 2, warsWon: 1, longestWar: 4 },
        local_pvp: { wins: 0, losses: 2, gamesPlayed: 2, cardsCaptured: 3, warsEntered: 1, warsWon: 0, longestWar: 2 },
        online_pvp: { wins: 1, losses: 3, gamesPlayed: 4, cardsCaptured: 7, warsEntered: 2, warsWon: 1, longestWar: 3 }
      },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", background: "default_background" }
    },
    {
      achievementsExpanded: false
    }
  );

  assert.match(html, /Read-only player profile/);
  assert.doesNotMatch(html, />Account Snapshot</);
  assert.match(html, />Overall Record</);
  assert.match(html, />Battle Stats</);
  assert.match(html, />Mode Stats</);
  assert.match(html, />Featured Rival</);
  assert.match(html, />Gauntlet</);
  assert.match(
    html,
    new RegExp(`Achievements \\(1\\/${ACHIEVEMENT_DEFINITIONS.length}\\)`)
  );
  assert.match(html, /Show Achievements/);
  assert.match(html, /Online PvP/);
  assert.match(html, /Featured Rival Wins/);
  assert.match(html, /Best Gauntlet Streak/);
  assert.match(html, /Gauntlet Runs/);
  assert.match(html, /Gauntlet Wins/);
  assert.match(html, /Gauntlet Losses/);
  assert.match(html, /Rivals Defeated/);
  assert.match(html, /profile-stat-value">4<\/strong>/);
  assert.doesNotMatch(html, /id="cosmetic-form"/);
});

test("ui: appController opens searched profiles in a read-only modal instead of inline", async () => {
  const previousWindow = global.window;
  const shown = [];
  const modalCalls = [];
  const hideCalls = [];
  const ownProfile = {
    ...createProfileScreenContext().profile,
    username: "Owner",
    title: "Initiate",
    playerLevel: 8,
    playerXP: 140,
    equippedCosmetics: {
      avatar: "default_avatar",
      title: "Initiate",
      badge: "none",
      background: "default_background",
      cardBack: "default_card_back",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    }
  };
  const viewedProfile = {
    username: "Rival",
    title: "Initiate",
    playerLevel: 4,
    playerXP: 83,
    tokens: 245,
    gamesPlayed: 7,
    warsEntered: 3,
    warsWon: 2,
    longestWar: 4,
    bestWinStreak: 3,
    wins: 2,
    losses: 3,
    cardsCaptured: 10,
    featuredRivalWins: 4,
    gauntletBestStreak: 6,
    gauntletRuns: 4,
    gauntletWins: 9,
    gauntletLosses: 3,
    gauntletRivalsDefeated: 9,
    achievements: { first_flame: { count: 1 } },
    modeStats: {
      pve: { wins: 2, losses: 1, gamesPlayed: 3, cardsCaptured: 6, warsEntered: 2, warsWon: 1, longestWar: 4 },
      local_pvp: { wins: 0, losses: 2, gamesPlayed: 2, cardsCaptured: 3, warsEntered: 1, warsWon: 0, longestWar: 2 },
      online_pvp: { wins: 1, losses: 3, gamesPlayed: 4, cardsCaptured: 7, warsEntered: 2, warsWon: 1, longestWar: 3 }
    },
    equippedCosmetics: { avatar: "default_avatar", title: "Initiate", background: "default_background" }
  };
  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (screenId, context) => shown.push({ screenId, context })
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => hideCalls.push("hide"),
      clearStaleOverlay: () => false
    },
    toastManager: { show: () => {} }
  });

  global.window = {
    elemintz: {
      state: {
        getProfile: async (username) => (username === "Rival" ? viewedProfile : ownProfile),
        getCosmetics: async () => createProfileScreenContext().cosmetics,
        getDailyChallenges: async () => ({ xp: {} }),
        listProfiles: async () => [{ username: "Rival" }]
      }
    }
  };

  try {
    controller.username = "Owner";
    controller.viewedProfileUsername = "Rival";

    await controller.showProfile();

    assert.equal(shown.at(-1)?.screenId, "profile");
    const ownProfileHtml = profileScreen.render(shown.at(-1).context);
    assert.match(ownProfileHtml, /Search Player/);
    assert.match(ownProfileHtml, /Reward Chests/);
    assert.doesNotMatch(ownProfileHtml, /Currency & Chests/);
    assert.doesNotMatch(ownProfileHtml, /Viewing: Rival/);
    assert.equal(modalCalls.length, 1);
    assert.equal(modalCalls[0].title, "Viewing: Rival");
    assert.match(modalCalls[0].bodyHtml, /Read-only player profile/);
    assert.match(modalCalls[0].bodyHtml, /Gauntlet Runs/);
    assert.match(modalCalls[0].bodyHtml, /Achievements/);
    assert.equal(modalCalls[0].actions[0].label, "Close");

    await modalCalls[0].actions[0].onClick();

    assert.equal(hideCalls.length, 1);
    assert.equal(controller.viewedProfileUsername, null);
    assert.equal(controller.viewedProfileAchievementsExpanded, false);
    assert.equal(modalCalls.length, 1);
    assert.equal(shown.at(-1)?.screenId, "profile");
  } finally {
    global.window = previousWindow;
  }
});

test("ui: authenticated cosmetics loadout actions use multiplayer authority even when online lobby state is disconnected", async () => {
  const previousWindow = global.window;
  const shown = [];
  const calls = {
    save: [],
    apply: [],
    rename: []
  };
  const baseProfile = {
    username: "AuthorityCaptain",
    playerLevel: 20,
    equippedCosmetics: {
      avatar: "default_avatar",
      cardBack: "default_card_back",
      background: "default_background",
      badge: "none",
      title: "Initiate",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    }
  };
  const cosmetics = {
    preferences: { randomizeBackgroundEachMatch: false },
    loadouts: [
      {
        index: 0,
        slotNumber: 1,
        unlockLevel: 10,
        unlocked: true,
        name: "Authority Slot",
        hasSavedLoadout: true,
        isActive: false
      }
    ],
    catalog: {
      avatar: [],
      cardBack: [],
      background: [],
      elementCardVariant: [],
      badge: [],
      title: []
    }
  };

  global.window = {
    elemintz: {
      state: {
        getCosmetics: async () => cosmetics,
        equipCosmetic: async () => ({ profile: baseProfile }),
        saveCosmeticLoadout: async () => {
          throw new Error("state save should stay disabled");
        },
        applyCosmeticLoadout: async () => {
          throw new Error("state apply should stay disabled");
        },
        renameCosmeticLoadout: async () => {
          throw new Error("state rename should stay disabled");
        }
      },
      multiplayer: {
        saveCosmeticLoadout: async (payload) => {
          calls.save.push(payload);
          return { snapshot: { profile: baseProfile, cosmetics: { snapshot: cosmetics } } };
        },
        applyCosmeticLoadout: async (payload) => {
          calls.apply.push(payload);
          return {
            snapshot: {
              profile: {
                ...baseProfile,
                equippedCosmetics: {
                  ...baseProfile.equippedCosmetics,
                  avatar: "authority_avatar"
                }
              },
              cosmetics: { snapshot: cosmetics }
            }
          };
        },
        renameCosmeticLoadout: async (payload) => {
          calls.rename.push(payload);
          return { snapshot: { profile: baseProfile, cosmetics: { snapshot: cosmetics } } };
        }
      }
    }
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: {
      show: (payload) => payload.actions?.[0]?.onClick?.(),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  try {
    app.username = "AuthorityCaptain";
    app.profile = baseProfile;
    app.onlinePlayState = {
      connectionStatus: "disconnected",
      session: {
        authenticated: true,
        username: "AuthorityCaptain"
      }
    };

    await app.showCosmetics();
    await shown.at(-1).actions.saveLoadout(0);
    await shown.at(-1).actions.applyLoadout(0);
    await shown.at(-1).actions.renameLoadout(0, "Authority Fit");

    assert.deepEqual(calls.save, [{ username: "AuthorityCaptain", slotIndex: 0 }]);
    assert.deepEqual(calls.apply, [{ username: "AuthorityCaptain", slotIndex: 0 }]);
    assert.deepEqual(calls.rename, [{ username: "AuthorityCaptain", slotIndex: 0, name: "Authority Fit" }]);
  } finally {
    global.window = previousWindow;
  }
});

test("ui: authenticated cosmetics loadout apply failures surface a clean unavailable modal", async () => {
  const previousWindow = global.window;
  const shown = [];
  const modalCalls = [];
  const baseProfile = {
    username: "AuthorityCaptain",
    playerLevel: 20,
    equippedCosmetics: {
      avatar: "default_avatar",
      cardBack: "default_card_back",
      background: "default_background",
      badge: "none",
      title: "Initiate",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    }
  };
  const cosmetics = {
    preferences: { randomizeBackgroundEachMatch: false },
    loadouts: [
      {
        index: 0,
        slotNumber: 1,
        unlockLevel: 10,
        unlocked: true,
        name: "Broken Slot",
        hasSavedLoadout: true,
        isActive: false
      }
    ],
    catalog: {
      avatar: [],
      cardBack: [],
      background: [],
      elementCardVariant: [],
      badge: [],
      title: []
    }
  };

  global.window = {
    elemintz: {
      state: {
        getCosmetics: async () => cosmetics,
        equipCosmetic: async () => ({ profile: baseProfile }),
        applyCosmeticLoadout: async () => {
          throw new Error("state apply should stay disabled");
        }
      },
      multiplayer: {
        applyCosmeticLoadout: async () => {
          throw new Error("One or more cosmetics in this loadout are no longer owned.");
        }
      }
    }
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  try {
    app.username = "AuthorityCaptain";
    app.profile = baseProfile;
    app.onlinePlayState = {
      connectionStatus: "disconnected",
      session: {
        authenticated: true,
        username: "AuthorityCaptain"
      }
    };

    await app.showCosmetics();
    await shown.at(-1).actions.applyLoadout(0);

    assert.equal(modalCalls.at(-1)?.title, "Loadout Unavailable");
    assert.match(String(modalCalls.at(-1)?.body ?? ""), /no longer owned/i);
  } finally {
    global.window = previousWindow;
  }
});

test("ui: viewed profile modal reuses a single overlay and updates when another player is opened", async () => {
  const previousWindow = global.window;
  const shown = [];
  const modalCalls = [];
  const ownProfile = {
    ...createProfileScreenContext().profile,
    username: "Owner",
    equippedCosmetics: {
      avatar: "default_avatar",
      title: "Initiate",
      badge: "none",
      background: "default_background",
      cardBack: "default_card_back",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    }
  };
  const profiles = {
    Owner: ownProfile,
    Rival: {
      username: "Rival",
      title: "Initiate",
      playerLevel: 4,
      playerXP: 83,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", background: "default_background" }
    },
    RivalTwo: {
      username: "RivalTwo",
      title: "Initiate",
      playerLevel: 5,
      playerXP: 120,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", background: "default_background" }
    }
  };
  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (screenId, context) => shown.push({ screenId, context })
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {},
      clearStaleOverlay: () => false
    },
    toastManager: { show: () => {} }
  });

  global.window = {
    elemintz: {
      state: {
        getProfile: async (username) => profiles[username] ?? ownProfile,
        getCosmetics: async () => createProfileScreenContext().cosmetics,
        getDailyChallenges: async () => ({ xp: {} }),
        listProfiles: async () => [{ username: "Rival" }, { username: "RivalTwo" }]
      }
    }
  };

  try {
    controller.username = "Owner";
    controller.viewedProfileUsername = "Rival";
    await controller.showProfile();
    controller.viewedProfileUsername = "RivalTwo";
    await controller.showProfile({ preserveAchievementVisibility: true, preserveModal: true });

    assert.equal(shown.at(-1)?.screenId, "profile");
    assert.equal(modalCalls.length, 2);
    assert.equal(modalCalls[0].title, "Viewing: Rival");
    assert.equal(modalCalls[1].title, "Viewing: RivalTwo");
  } finally {
    global.window = previousWindow;
  }
});

test("ui: authenticated profile view uses authoritative viewed-profile data for gauntlet stats", async () => {
  const previousWindow = global.window;
  const shown = [];
  const modalCalls = [];
  const ownProfile = {
    ...createProfileScreenContext().profile,
    username: "Owner",
    equippedCosmetics: {
      avatar: "default_avatar",
      title: "Initiate",
      badge: "none",
      background: "default_background",
      cardBack: "default_card_back",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    }
  };

  const authoritativeViewedSnapshot = {
    authority: "server",
    source: "multiplayer",
    username: "Bane",
    profile: {
      username: "Bane",
      title: "Initiate",
      playerLevel: 8,
      playerXP: 320,
      gauntletBestStreak: 3,
      gauntletRuns: 1,
      gauntletWins: 3,
      gauntletLosses: 0,
      gauntletRivalsDefeated: 3,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: {
        avatar: "avatar_neon_pyre_entity",
        title: "Initiate",
        badge: "none",
        background: "default_background",
        cardBack: "cardback_neon_arcana",
        elementCardVariant: {
          fire: "fire_variant_neon_arcana",
          water: "water_variant_neon_arcana",
          earth: "earth_variant_neon_arcana",
          wind: "wind_variant_neon_arcana"
        }
      }
    },
    cosmetics: {
      equipped: {
        avatar: "avatar_neon_pyre_entity",
        title: "Initiate",
        badge: "none",
        background: "default_background",
        cardBack: "cardback_neon_arcana",
        elementCardVariant: {
          fire: "fire_variant_neon_arcana",
          water: "water_variant_neon_arcana",
          earth: "earth_variant_neon_arcana",
          wind: "wind_variant_neon_arcana"
        }
      },
      owned: {
        avatar: ["avatar_neon_pyre_entity"],
        cardBack: ["cardback_neon_arcana"],
        background: ["default_background"],
        elementCardVariant: [
          "fire_variant_neon_arcana",
          "water_variant_neon_arcana",
          "earth_variant_neon_arcana",
          "wind_variant_neon_arcana"
        ],
        badge: ["none"],
        title: ["Initiate"]
      }
    },
    stats: {
      summary: {
        wins: 0,
        losses: 0,
        gamesPlayed: 0,
        warsEntered: 0,
        warsWon: 0,
        cardsCaptured: 0
      },
      modes: {
        pve: { wins: 0, losses: 0 },
        local_pvp: { wins: 0, losses: 0 }
      }
    },
    currency: {
      tokens: 125
    },
    progression: {
      xp: {
        playerXP: 320,
        playerLevel: 8
      }
    }
  };

  global.window = {
    elemintz: {
      multiplayer: {
        getProfile: async () => ({
          authority: "server",
          username: "Owner",
          profile: ownProfile,
          cosmetics: { equipped: ownProfile.equippedCosmetics, owned: {}, loadouts: [], preferences: {} },
          stats: { summary: {}, modes: {} },
          currency: { tokens: 200 },
          progression: { xp: {} }
        }),
        getCosmetics: async () => createProfileScreenContext().cosmetics,
        viewProfile: async ({ username }) => {
          if (username !== "Bane") {
            throw new Error("unexpected viewed profile username");
          }
          return authoritativeViewedSnapshot;
        }
      },
      state: {
        getProfile: async (username) => {
          if (username === "Bane") {
            return {
              username: "Bane",
              gauntletBestStreak: 0,
              gauntletRuns: 0,
              gauntletWins: 0,
              gauntletRivalsDefeated: 0,
              equippedCosmetics: { avatar: "default_avatar", title: "Initiate", background: "default_background" },
              achievements: {},
              modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } }
            };
          }
          throw new Error("local own-profile read should not be used for authenticated profile refresh");
        },
        getCosmetics: async () => createProfileScreenContext().cosmetics,
        getDailyChallenges: async () => ({ xp: {} }),
        listProfiles: async () => [{ username: "Bane" }]
      }
    }
  };

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (screenId, context) => shown.push({ screenId, context })
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {},
      clearStaleOverlay: () => false
    },
    toastManager: { show: () => {} }
  });

  try {
    controller.username = "Owner";
    controller.onlinePlayState = {
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "Owner"
      }
    };
    controller.viewedProfileUsername = "Bane";

    await controller.showProfile();

    assert.equal(shown.at(-1)?.screenId, "profile");
    assert.equal(modalCalls.length, 1);
    assert.match(modalCalls[0].bodyHtml, /Best Gauntlet Streak/);
    assert.match(modalCalls[0].bodyHtml, />3</);
    assert.match(modalCalls[0].bodyHtml, /avatar_neon_pyre_entity\.png/);
  } finally {
    global.window = previousWindow;
  }
});

test("ui: viewed profile modal binds hover preview behavior after render without duplicating listeners on reopen", () => {
  const previousDocument = global.document;
  const modalBodyListeners = new Map();
  const modalBodyListenerCounts = new Map();
  const blurListeners = new Map();
  const appended = [];
  const viewedAchievementsToggleListeners = new Map();

  function createPreviewNode(tagName) {
    const children = [];
    const classes = new Set();
    const attributes = new Map();
    return {
      tagName,
      id: "",
      hidden: false,
      className: "",
      style: {},
      textContent: "",
      src: "",
      alt: "",
      children,
      appendChild(child) {
        if (!children.includes(child)) {
          children.push(child);
        }
      },
      removeChild(child) {
        const index = children.indexOf(child);
        if (index >= 0) {
          children.splice(index, 1);
        }
      },
      contains(child) {
        return children.includes(child);
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
      removeAttribute(name) {
        attributes.delete(name);
        if (name === "src") {
          this.src = "";
        }
      },
      getAttribute(name) {
        return attributes.get(name) ?? null;
      },
      classList: {
        add: (...tokens) => tokens.forEach((token) => classes.add(token)),
        remove: (...tokens) => tokens.forEach((token) => classes.delete(token)),
        contains: (token) => classes.has(token)
      }
    };
  }

  const modalBody = {
    __elemintzHoverPreviewBound: false,
    addEventListener(type, handler) {
      modalBodyListeners.set(type, handler);
      modalBodyListenerCounts.set(type, (modalBodyListenerCounts.get(type) ?? 0) + 1);
    },
    contains: () => true
  };
  const viewedAchievementsToggle = {
    addEventListener(type, handler) {
      viewedAchievementsToggleListeners.set(type, handler);
    }
  };

  global.document = {
    documentElement: { clientWidth: 900, clientHeight: 700 },
    body: {
      appendChild(node) {
        appended.push(node);
      }
    },
    createElement: (tagName) => createPreviewNode(tagName),
    defaultView: {
      innerWidth: 900,
      innerHeight: 700,
      addEventListener(type, handler) {
        blurListeners.set(type, handler);
      }
    },
    querySelector(selector) {
      if (selector === ".viewed-profile-modal-body") {
        return modalBody;
      }
      return null;
    },
    getElementById(id) {
      if (id === "viewed-profile-achievements-toggle-btn") {
        return viewedAchievementsToggle;
      }
      return null;
    }
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: () => {},
      hide: () => {},
      clearStaleOverlay: () => false
    },
    toastManager: { show: () => {} }
  });

  const viewedProfile = {
    username: "Enab",
    title: "Initiate",
    playerLevel: 10,
    playerXP: 220,
    achievements: {},
    gauntletBestStreak: 3,
    gauntletRuns: 4,
    gauntletWins: 2,
    gauntletRivalsDefeated: 7,
    featuredRivalWins: 1,
    modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
    equippedCosmetics: {
      avatar: "default_avatar",
      title: "Initiate",
      badge: "none",
      background: "default_background",
      cardBack: "default_card_back",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    }
  };

  try {
    app.showViewedProfileModal(viewedProfile);
    app.showViewedProfileModal(viewedProfile);

    assert.equal(modalBody.__elemintzHoverPreviewBound, true);
    assert.equal(modalBodyListenerCounts.get("mouseover"), 1);
    assert.equal(modalBodyListenerCounts.get("mousemove"), 1);
    assert.equal(modalBodyListenerCounts.get("mouseleave"), 1);
    assert.equal(viewedAchievementsToggleListeners.has("click"), true);
    assert.equal(blurListeners.has("blur"), true);
    assert.ok(appended.length >= 1);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: own profile header renders the equipped Neon Arcana avatar when selected", () => {
  const context = createProfileScreenContext();
  context.profile = {
    ...context.profile,
    equippedCosmetics: {
      ...context.profile.equippedCosmetics,
      avatar: "avatar_neon_pyre_entity"
    }
  };
  const html = profileScreen.render(context);

  assert.match(html, /avatar_neon_pyre_entity\.png/);
});

test("ui: own and viewed profile headers render equipped Goldbound avatar and title art when selected", () => {
  const context = createProfileScreenContext({
    profile: {
      ...createProfileScreenContext().profile,
      title: "title_goldbound",
      equippedCosmetics: {
        ...createProfileScreenContext().profile.equippedCosmetics,
        avatar: "avatar_aurelian_archon",
        title: "title_goldbound",
        cardBack: "cardback_goldbound_relic",
        background: "default_background",
        elementCardVariant: {
          fire: "fire_variant_goldbound_relics",
          earth: "earth_variant_goldbound_relics",
          wind: "wind_variant_goldbound_relics",
          water: "water_variant_goldbound_relics"
        }
      }
    },
    cosmetics: {
      ...createProfileScreenContext().cosmetics,
      equipped: {
        ...createProfileScreenContext().cosmetics.equipped,
        avatar: "avatar_aurelian_archon",
        title: "title_goldbound",
        cardBack: "cardback_goldbound_relic",
        elementCardVariant: {
          fire: "fire_variant_goldbound_relics",
          earth: "earth_variant_goldbound_relics",
          wind: "wind_variant_goldbound_relics",
          water: "water_variant_goldbound_relics"
        }
      },
      catalog: {
        ...createProfileScreenContext().cosmetics.catalog,
        avatar: [
          ...createProfileScreenContext().cosmetics.catalog.avatar,
          { id: "avatar_aurelian_archon", name: "Aurelian Archon", image: "avatars/avatar_aurelian_archon.png", owned: true }
        ],
        cardBack: [
          { id: "default_card_back", name: "Default", owned: true },
          { id: "cardback_goldbound_relic", name: "Goldbound Relic", image: "card_backs/cardback_goldbound_relic.png", owned: true }
        ],
        elementCardVariant: [
          { id: "default_fire_card", name: "Core Fire", element: "fire", owned: true },
          { id: "fire_variant_goldbound_relics", name: "Molten Goldfire", image: "cards/fire_variant_goldbound_relics.png", element: "fire", owned: true },
          { id: "earth_variant_goldbound_relics", name: "Auric Stone", image: "cards/earth_variant_goldbound_relics.png", element: "earth", owned: true },
          { id: "wind_variant_goldbound_relics", name: "Gilded Gale", image: "cards/wind_variant_goldbound_relics.png", element: "wind", owned: true },
          { id: "water_variant_goldbound_relics", name: "Liquid Gold Tide", image: "cards/water_variant_goldbound_relics.png", element: "water", owned: true }
        ],
        title: [
          { id: "Initiate", name: "Initiate", owned: true },
          { id: "title_goldbound", name: "Goldbound", image: "titles/title_goldbound.png", owned: true }
        ]
      }
    }
  });

  const ownHtml = profileScreen.render(context);
  const viewedHtml = profileScreen.renderViewedProfileModalBody({
    username: "Aurelian",
    title: "title_goldbound",
    playerLevel: 8,
    playerXP: 220,
    wins: 12,
    losses: 4,
    cardsCaptured: 31,
    achievements: {},
    modeStats: { pve: { wins: 8, losses: 2 }, local_pvp: { wins: 4, losses: 2 } },
    equippedCosmetics: {
      avatar: "avatar_aurelian_archon",
      title: "title_goldbound",
      background: "default_background",
      badge: "none",
      cardBack: "cardback_goldbound_relic",
      elementCardVariant: {
        fire: "fire_variant_goldbound_relics",
        earth: "earth_variant_goldbound_relics",
        wind: "wind_variant_goldbound_relics",
        water: "water_variant_goldbound_relics"
      }
    }
  });

  assert.match(ownHtml, /avatar_aurelian_archon\.png/);
  assert.match(ownHtml, /title_goldbound\.png/);
  assert.match(ownHtml, /cardback_goldbound_relic\.png/);
  assert.match(ownHtml, /fire_variant_goldbound_relics\.png/);
  assert.match(ownHtml, /earth_variant_goldbound_relics\.png/);
  assert.match(ownHtml, /wind_variant_goldbound_relics\.png/);
  assert.match(ownHtml, /water_variant_goldbound_relics\.png/);
  assert.match(viewedHtml, /avatar_aurelian_archon\.png/);
  assert.match(viewedHtml, /title_goldbound\.png/);
  assert.match(viewedHtml, /cardback_goldbound_relic\.png/);
  assert.match(viewedHtml, /fire_variant_goldbound_relics\.png/);
  assert.match(viewedHtml, /earth_variant_goldbound_relics\.png/);
  assert.match(viewedHtml, /wind_variant_goldbound_relics\.png/);
  assert.match(viewedHtml, /water_variant_goldbound_relics\.png/);
});

test("ui: own and viewed profile headers render equipped Frostveil Court avatar and title art when selected", () => {
  const context = createProfileScreenContext({
    profile: {
      ...createProfileScreenContext().profile,
      title: "title_shiverborne",
      equippedCosmetics: {
        ...createProfileScreenContext().profile.equippedCosmetics,
        avatar: "avatar_frostveil_heir",
        title: "title_shiverborne",
        cardBack: "cardback_glacier_sigil",
        background: "default_background",
        elementCardVariant: {
          fire: "fire_variant_aurora_flare",
          earth: "earth_variant_icebound_crag",
          wind: "wind_variant_sleet_spiral",
          water: "water_variant_frostbloom"
        }
      }
    },
    cosmetics: {
      ...createProfileScreenContext().cosmetics,
      equipped: {
        ...createProfileScreenContext().cosmetics.equipped,
        avatar: "avatar_frostveil_heir",
        title: "title_shiverborne",
        cardBack: "cardback_glacier_sigil",
        elementCardVariant: {
          fire: "fire_variant_aurora_flare",
          earth: "earth_variant_icebound_crag",
          wind: "wind_variant_sleet_spiral",
          water: "water_variant_frostbloom"
        }
      },
      catalog: {
        ...createProfileScreenContext().cosmetics.catalog,
        avatar: [
          ...createProfileScreenContext().cosmetics.catalog.avatar,
          { id: "avatar_frostveil_heir", name: "Frostveil Heir", image: "avatars/avatar_frostveil_heir.png", owned: true }
        ],
        cardBack: [
          { id: "default_card_back", name: "Default", owned: true },
          { id: "cardback_glacier_sigil", name: "Glacier Sigil", image: "card_backs/cardback_glacier_sigil.png", owned: true }
        ],
        elementCardVariant: [
          { id: "default_fire_card", name: "Core Fire", element: "fire", owned: true },
          { id: "fire_variant_aurora_flare", name: "Aurora Flare Fire", image: "cards/fire_variant_aurora_flare.png", element: "fire", owned: true },
          { id: "earth_variant_icebound_crag", name: "Icebound Crag Earth", image: "cards/earth_variant_icebound_crag.png", element: "earth", owned: true },
          { id: "wind_variant_sleet_spiral", name: "Sleet Spiral Wind", image: "cards/wind_variant_sleet_spiral.png", element: "wind", owned: true },
          { id: "water_variant_frostbloom", name: "Frostbloom Water", image: "cards/water_variant_frostbloom.png", element: "water", owned: true }
        ],
        title: [
          { id: "Initiate", name: "Initiate", owned: true },
          { id: "title_shiverborne", name: "Shiverborne", image: "titles/title_shiverborne.png", owned: true }
        ]
      }
    }
  });

  const ownHtml = profileScreen.render(context);
  const viewedHtml = profileScreen.renderViewedProfileModalBody({
    username: "Frostveil",
    title: "title_shiverborne",
    playerLevel: 9,
    playerXP: 260,
    wins: 14,
    losses: 5,
    cardsCaptured: 37,
    achievements: {},
    modeStats: { pve: { wins: 10, losses: 3 }, local_pvp: { wins: 4, losses: 2 } },
    equippedCosmetics: {
      avatar: "avatar_frostveil_heir",
      title: "title_shiverborne",
      background: "default_background",
      badge: "none",
      cardBack: "cardback_glacier_sigil",
      elementCardVariant: {
        fire: "fire_variant_aurora_flare",
        earth: "earth_variant_icebound_crag",
        wind: "wind_variant_sleet_spiral",
        water: "water_variant_frostbloom"
      }
    }
  });

  assert.match(ownHtml, /avatar_frostveil_heir\.png/);
  assert.match(ownHtml, /title_shiverborne\.png/);
  assert.match(ownHtml, /cardback_glacier_sigil\.png/);
  assert.match(ownHtml, /fire_variant_aurora_flare\.png/);
  assert.match(ownHtml, /earth_variant_icebound_crag\.png/);
  assert.match(ownHtml, /wind_variant_sleet_spiral\.png/);
  assert.match(ownHtml, /water_variant_frostbloom\.png/);
  assert.match(viewedHtml, /avatar_frostveil_heir\.png/);
  assert.match(viewedHtml, /title_shiverborne\.png/);
  assert.match(viewedHtml, /cardback_glacier_sigil\.png/);
  assert.match(viewedHtml, /fire_variant_aurora_flare\.png/);
  assert.match(viewedHtml, /earth_variant_icebound_crag\.png/);
  assert.match(viewedHtml, /wind_variant_sleet_spiral\.png/);
  assert.match(viewedHtml, /water_variant_frostbloom\.png/);
});

test("ui: own and viewed profile headers render equipped Vampire Elegance and Lycan Power cosmetics including Lycan Law background", () => {
  const context = createProfileScreenContext({
    profile: {
      ...createProfileScreenContext().profile,
      equippedCosmetics: {
        ...createProfileScreenContext().profile.equippedCosmetics,
        avatar: "avatar_lycan_female",
        cardBack: "cardback_lycan_pack",
        background: "background_bg_lycan_law",
        elementCardVariant: {
          fire: "fire_variant_flame_wings",
          earth: "earth_variant_stone_paw",
          wind: "wind_variant_lycan_duo",
          water: "water_variant_blood_wings"
        }
      }
    },
    cosmetics: {
      ...createProfileScreenContext().cosmetics,
      equipped: {
        ...createProfileScreenContext().cosmetics.equipped,
        avatar: "avatar_lycan_female",
        cardBack: "cardback_lycan_pack",
        background: "background_bg_lycan_law",
        elementCardVariant: {
          fire: "fire_variant_flame_wings",
          earth: "earth_variant_stone_paw",
          wind: "wind_variant_lycan_duo",
          water: "water_variant_blood_wings"
        }
      },
      catalog: {
        ...createProfileScreenContext().cosmetics.catalog,
        avatar: [
          ...createProfileScreenContext().cosmetics.catalog.avatar,
          { id: "avatar_vampire_female", name: "Vampire Female", image: "avatars/avatar_vampire_female.png", owned: true },
          { id: "avatar_lycan_female", name: "Lycan Female", image: "avatars/avatar_lycan_female.png", owned: true }
        ],
        cardBack: [
          { id: "default_card_back", name: "Default", owned: true },
          { id: "cardback_blood_gem", name: "Blood Gem", image: "card_backs/cardback_blood_gem.png", owned: true },
          { id: "cardback_lycan_pack", name: "Lycan Pack", image: "card_backs/cardback_lycan_pack.png", owned: true }
        ],
        background: [
          { id: "default_background", name: "Default", owned: true },
          { id: "background_bg_lycan_law", name: "Lycan Law", image: "backgrounds/background_bg_lycan_law.png", owned: true }
        ],
        elementCardVariant: [
          { id: "default_fire_card", name: "Core Fire", element: "fire", owned: true },
          { id: "fire_variant_flame_wings", name: "Flame Wings Fire", image: "cards/fire_variant_flame_wings.png", element: "fire", owned: true },
          { id: "earth_variant_stone_paw", name: "Stone Paw Earth", image: "cards/earth_variant_stone_paw.png", element: "earth", owned: true },
          { id: "wind_variant_lycan_duo", name: "Lycan Duo Wind", image: "cards/wind_variant_lycan_duo.png", element: "wind", owned: true },
          { id: "water_variant_blood_wings", name: "Blood Wings Water", image: "cards/water_variant_blood_wings.png", element: "water", owned: true }
        ]
      }
    }
  });

  const ownHtml = profileScreen.render(context);
  const viewedHtml = profileScreen.renderViewedProfileModalBody({
    username: "LycanProfile",
    title: "Initiate",
    playerLevel: 10,
    playerXP: 300,
    wins: 16,
    losses: 6,
    cardsCaptured: 42,
    achievements: {},
    modeStats: { pve: { wins: 12, losses: 4 }, local_pvp: { wins: 4, losses: 2 } },
    equippedCosmetics: {
      avatar: "avatar_vampire_female",
      title: "Initiate",
      background: "background_bg_lycan_law",
      badge: "none",
      cardBack: "cardback_blood_gem",
      elementCardVariant: {
        fire: "fire_variant_flame_wings",
        earth: "earth_variant_stone_paw",
        wind: "wind_variant_lycan_duo",
        water: "water_variant_blood_wings"
      }
    }
  });

  assert.match(ownHtml, /avatar_lycan_female\.png/);
  assert.match(ownHtml, /cardback_lycan_pack\.png/);
  assert.match(ownHtml, /fire_variant_flame_wings\.png/);
  assert.match(ownHtml, /earth_variant_stone_paw\.png/);
  assert.match(ownHtml, /wind_variant_lycan_duo\.png/);
  assert.match(ownHtml, /water_variant_blood_wings\.png/);
  assert.match(viewedHtml, /avatar_vampire_female\.png/);
  assert.match(viewedHtml, /background_bg_lycan_law\.png/);
  assert.match(viewedHtml, /cardback_blood_gem\.png/);
  assert.match(viewedHtml, /fire_variant_flame_wings\.png/);
  assert.match(viewedHtml, /earth_variant_stone_paw\.png/);
  assert.match(viewedHtml, /wind_variant_lycan_duo\.png/);
  assert.match(viewedHtml, /water_variant_blood_wings\.png/);
});

test("ui: own and viewed profile headers render equipped Elemental Street collectionless avatar title card back and variants without a collection chip", () => {
  const context = createProfileScreenContext({
    profile: {
      ...createProfileScreenContext().profile,
      title: "title_spark",
      equippedCosmetics: {
        ...createProfileScreenContext().profile.equippedCosmetics,
        avatar: "avatar_fire_street_duelist",
        title: "title_spark",
        background: "default_background",
        cardBack: "cardback_four_element_street_emblem",
        elementCardVariant: {
          fire: "fire_variant_street",
          earth: "earth_variant_street",
          wind: "wind_variant_street",
          water: "water_variant_street"
        }
      }
    },
    cosmetics: {
      ...createProfileScreenContext().cosmetics,
      equipped: {
        ...createProfileScreenContext().cosmetics.equipped,
        avatar: "avatar_fire_street_duelist",
        title: "title_spark",
        cardBack: "cardback_four_element_street_emblem",
        elementCardVariant: {
          fire: "fire_variant_street",
          earth: "earth_variant_street",
          wind: "wind_variant_street",
          water: "water_variant_street"
        }
      },
      catalog: {
        ...createProfileScreenContext().cosmetics.catalog,
        avatar: [
          ...createProfileScreenContext().cosmetics.catalog.avatar,
          { id: "avatar_fire_street_duelist", name: "Fire Street Duelist", image: "avatars/avatar_fire_street_duelist.png", owned: true }
        ],
        cardBack: [
          { id: "default_card_back", name: "Default", owned: true },
          { id: "cardback_four_element_street_emblem", name: "Four Element Street Emblem", image: "card_backs/cardback_four_element_street_emblem.png", owned: true }
        ],
        elementCardVariant: [
          { id: "default_fire_card", name: "Core Fire", element: "fire", owned: true },
          { id: "fire_variant_street", name: "Street Fire", image: "cards/fire_variant_street.png", element: "fire", owned: true },
          { id: "earth_variant_street", name: "Street Earth", image: "cards/earth_variant_street.png", element: "earth", owned: true },
          { id: "wind_variant_street", name: "Street Wind", image: "cards/wind_variant_street.png", element: "wind", owned: true },
          { id: "water_variant_street", name: "Street Water", image: "cards/water_variant_street.png", element: "water", owned: true }
        ],
        title: [
          { id: "Initiate", name: "Initiate", owned: true },
          { id: "title_spark", name: "Spark", image: "titles/title_spark.png", owned: true }
        ]
      }
    }
  });

  const ownHtml = profileScreen.render(context);
  const viewedHtml = profileScreen.renderViewedProfileModalBody({
    username: "StreetMage",
    title: "title_spark",
    playerLevel: 6,
    playerXP: 120,
    wins: 9,
    losses: 4,
    cardsCaptured: 18,
    achievements: {},
    modeStats: { pve: { wins: 6, losses: 3 }, local_pvp: { wins: 3, losses: 1 } },
    equippedCosmetics: {
      avatar: "avatar_fire_street_duelist",
      title: "title_spark",
      background: "default_background",
      badge: "none",
      cardBack: "cardback_four_element_street_emblem",
      elementCardVariant: {
        fire: "fire_variant_street",
        earth: "earth_variant_street",
        wind: "wind_variant_street",
        water: "water_variant_street"
      }
    }
  });

  assert.match(ownHtml, /avatar_fire_street_duelist\.png/);
  assert.match(ownHtml, /title_spark\.png/);
  assert.match(ownHtml, /cardback_four_element_street_emblem\.png/);
  assert.match(ownHtml, /fire_variant_street\.png/);
  assert.match(ownHtml, /earth_variant_street\.png/);
  assert.match(ownHtml, /wind_variant_street\.png/);
  assert.match(ownHtml, /water_variant_street\.png/);
  assert.doesNotMatch(ownHtml, /Elemental Street Collection/);
  assert.match(viewedHtml, /avatar_fire_street_duelist\.png/);
  assert.match(viewedHtml, /title_spark\.png/);
  assert.match(viewedHtml, /cardback_four_element_street_emblem\.png/);
  assert.match(viewedHtml, /fire_variant_street\.png/);
  assert.match(viewedHtml, /earth_variant_street\.png/);
  assert.match(viewedHtml, /wind_variant_street\.png/);
  assert.match(viewedHtml, /water_variant_street\.png/);
  assert.doesNotMatch(viewedHtml, /Elemental Street Collection/);
});

test("ui: viewed profile renders derived level correctly on first render", () => {
  const html = profileScreen.renderViewedProfileModalBody({
      username: "LookupUser",
      title: "Initiate",
      playerLevel: 4,
      playerXP: 112,
      wins: 0,
      losses: 0,
      cardsCaptured: 0,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", background: "default_background" }
  });

  assert.match(html, /data-profile-overview-level="true">4</);
  assert.match(html, /data-profile-overview-xp-value="true">[0-9]+ \/ [0-9]+</);
});

test("ui: viewed profile mode hides cosmetic selectors and applies viewed background on panel", () => {
  const html = profileScreen.renderViewedProfileModalBody({
      username: "Rival",
      title: "Arena Founder",
      playerLevel: 6,
      playerXP: 120,
      wins: 5,
      losses: 3,
      cardsCaptured: 14,
      achievements: { first_flame: { count: 1 } },
      equippedCosmetics: {
        avatar: "fire_avatar_m",
        title: "Arena Founder",
        background: "wind_background",
        badge: "war_machine_badge",
        cardBack: "default_card_back"
      },
      modeStats: { pve: { wins: 4, losses: 2 }, local_pvp: { wins: 1, losses: 1 } }
  });

  assert.doesNotMatch(html, /id="cosmetic-form"/);
  assert.match(html, /viewed-profile-panel/);
  assert.match(html, /background-image: url\('(?:file:.*\/)?assets\/backgrounds\/windBattleArena\.png'\)/);
  assert.doesNotMatch(html, /Equipped Avatar:/);
  assert.doesNotMatch(html, /Equipped Title:/);
  assert.doesNotMatch(html, /Equipped Background:/);
  assert.doesNotMatch(html, /Equipped Badge:/);
  assert.doesNotMatch(html, /Equipped Card Back:/);
});

test("ui: owner profile is display-only and keeps cosmetic equip controls off the profile screen", () => {
  const html = profileScreen.render({
    profile: {
      username: "Owner",
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        badge: "none",
        title: "Initiate"
      }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: {
          fire: "default_fire_card",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    searchResults: [],
    searchQuery: "",
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.doesNotMatch(html, /id="cosmetic-form"/);
  assert.doesNotMatch(html, /Equip Selected Cosmetics/);
  assert.doesNotMatch(html, /Element card variants are equipped from Cosmetics\/Store/);
});

test("ui: viewed profile panel falls back to default background and keeps owner page background", () => {
  const ownerHtml = profileScreen.render({
    profile: {
      username: "Owner",
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: {
          fire: "default_fire_card",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    searchResults: [],
    searchQuery: "",
    viewedProfile: null,
    backgroundImage: "assets/backgrounds/lava_throne_background.png"
  });
  const viewedHtml = profileScreen.renderViewedProfileModalBody({
    username: "NoBgUser",
    title: "Initiate",
    playerLevel: 1,
    playerXP: 0,
    wins: 0,
    losses: 0,
    cardsCaptured: 0,
    achievements: {},
    equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" },
    modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } }
  });

  assert.match(ownerHtml, /background-image: url\('assets\/backgrounds\/lava_throne_background\.png'\)/);
  assert.match(viewedHtml, /viewed-profile-panel/);
  assert.match(viewedHtml, /background-image: url\('(?:file:.*\/)?assets\/EleMintzIcon\.png'\)/);
});

test("ui: title reward renders icon and text on profile and game headers", () => {
  const profileHtml = profileScreen.render({
    profile: {
      username: "IconUser",
      title: "Flame Vanguard",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Flame Vanguard" }
    },
    cosmetics: {
      equipped: { avatar: "default_avatar", cardBack: "default_card_back", background: "default_background", elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" }, badge: "none", title: "Flame Vanguard" },
      catalog: { avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }], cardBack: [{ id: "default_card_back", name: "Default", owned: true }], background: [{ id: "default_background", name: "Default", owned: true }], elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }, { id: "default_water_card", name: "Core Water", element: "water", owned: true }, { id: "default_earth_card", name: "Core Earth", element: "earth", owned: true }, { id: "default_wind_card", name: "Core Wind", element: "wind", owned: true }], badge: [{ id: "none", name: "No Badge", owned: true }], title: [{ id: "Flame Vanguard", name: "Flame Vanguard", image: "titles/title_flame_vanguard.png", owned: true }] }
    },
    titleIcon: "badges/firstFlame.png",
    searchResults: [],
    searchQuery: "",
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(profileHtml, /title-icon/);
  assert.match(profileHtml, /Flame Vanguard/);
  assert.match(profileHtml, /(?:file:.*\/)?assets\/titles\/title_flame_vanguard\.png/);

  const gameHtml = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "IconUser", title: "Flame Vanguard", titleIcon: "assets/badges/firstFlame.png", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "Elemental AI", title: "Arena Rival", titleIcon: null, avatar: "assets/avatars/default.png" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "IconUser", p2Name: "AI" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: { p1: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" }, p2: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" } },
    game: { roundOutcome: { key: "no_effect", label: "No effect" }, roundResult: "No effect.", round: 1, timerSeconds: 20, totalMatchSeconds: 300, canSelectCard: true, mode: "pve", playerHand: ["fire"], opponentHand: ["water"], pileCount: 0, totalWarClashes: 0, warPileCards: [], captured: { p1: 0, p2: 0 }, lastRound: null },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(gameHtml, /title-icon/);
});

test("ui: fallback title icons do not create hover preview media for viewed profile or match identity titles", () => {
  const viewedProfileHtml = profileScreen.renderViewedProfileModalBody({
      username: "Rival",
      title: "Arena Founder",
      wins: 2,
      losses: 1,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 3,
      bestWinStreak: 1,
      tokens: 10,
      playerLevel: 3,
      playerXP: 20,
      achievements: {},
      modeStats: { pve: { wins: 1, losses: 0 }, local_pvp: { wins: 1, losses: 1 } },
      equippedCosmetics: {
        avatar: "default_avatar",
        title: null,
        badge: "none",
        background: "default_background"
      },
      cosmetics: { background: "default_background" }
  });

  assert.match(viewedProfileHtml, /title-icon/);
  assert.match(viewedProfileHtml, /data-preview-type="title"/);
  assert.match(
    viewedProfileHtml,
    /data-preview-type="title"[^>]*data-preview-src=""[^>]*data-preview-name="Arena Founder"/
  );

  const gameHtml = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: {
      name: "Host",
      titleId: null,
      title: "Legacy Founder",
      titleIcon: "assets/badges/not_canonical_legacy.png",
      avatar: "assets/avatars/default.png",
      featuredBadge: null
    },
    opponentDisplay: {
      name: "Guest",
      titleId: null,
      title: "Arena Rival",
      titleIcon: null,
      avatar: "assets/avatars/default.png",
      featuredBadge: null
    },
    hotseat: { enabled: true, turnLabel: "Host Turn", p1Name: "Host", p2Name: "Guest", activePlayer: "p1" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" },
      p2: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" }
    },
    cardBacks: { p1: "assets/card_backs/default_back.jpg", p2: "assets/card_backs/default_back.jpg" },
    cosmeticIds: {
      variants: { p1: null, p2: null },
      cardBacks: { p1: "default_card_back", p2: "default_card_back" }
    },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      mode: "local_pvp",
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(gameHtml, /title-icon/);
  assert.match(
    gameHtml,
    /data-preview-type="title"[^>]*data-preview-src=""[^>]*data-preview-name="Legacy Founder"/
  );
});

test("ui: diagnostic trace keeps imageless title hover preview sources empty across viewed profile, PVE, PVP, and ONLINE", () => {
  const viewedProfileHtml = profileScreen.render({
    profile: {
      username: "Owner",
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", image: null, owned: true }]
      }
    },
    searchResults: [],
    searchQuery: "",
    viewedProfile: {
      username: "ViewedInitiate",
      title: "Initiate",
      wins: 1,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 1,
      bestWinStreak: 1,
      tokens: 5,
      playerLevel: 1,
      playerXP: 0,
      achievements: {},
      modeStats: { pve: { wins: 1, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: {
        avatar: "default_avatar",
        title: "Initiate",
        badge: "none",
        background: "default_background"
      },
      cosmetics: { background: "default_background" }
    },
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(
    viewedProfileHtml,
    /data-preview-type="title"[^>]*data-preview-src=""[^>]*data-preview-name="Initiate"/
  );
  assert.doesNotMatch(viewedProfileHtml, /title-icon" src="[^"]*Initiate/i);

  const pveHtml = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: {
      name: "Hero",
      avatarId: "default_avatar",
      titleId: "Initiate",
      badgeId: "none",
      title: "Initiate",
      titleIcon: null,
      featuredBadge: null,
      avatar: "assets/avatars/default.png"
    },
    opponentDisplay: {
      name: "Elemental AI",
      avatarId: "default_avatar",
      titleId: null,
      badgeId: "none",
      title: "Arena Rival",
      titleIcon: null,
      featuredBadge: null,
      avatar: "assets/avatars/default.png"
    },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "AI" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" },
      p2: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" }
    },
    cardBacks: { p1: "assets/card_backs/default_back.jpg", p2: "assets/card_backs/default_back.jpg" },
    cosmeticIds: {
      variants: { p1: null, p2: null },
      cardBacks: { p1: "default_card_back", p2: "default_card_back" }
    },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      mode: "pve",
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(
    pveHtml,
    /data-preview-type="title"[^>]*data-preview-src=""[^>]*data-preview-name="Initiate"/
  );
  assert.match(
    pveHtml,
    /data-preview-type="title"[^>]*data-preview-src=""[^>]*data-preview-name="Arena Rival"/
  );

  const pvpHtml = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: {
      name: "Player 1",
      avatarId: "default_avatar",
      titleId: "Initiate",
      badgeId: "none",
      title: "Initiate",
      titleIcon: null,
      featuredBadge: null,
      avatar: "assets/avatars/default.png"
    },
    opponentDisplay: {
      name: "Player 2",
      avatarId: "default_avatar",
      titleId: "Initiate",
      badgeId: "none",
      title: "Initiate",
      titleIcon: null,
      featuredBadge: null,
      avatar: "assets/avatars/default.png"
    },
    hotseat: { enabled: true, turnLabel: "Player 1 Turn", p1Name: "Player 1", p2Name: "Player 2", activePlayer: "p1" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" },
      p2: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" }
    },
    cardBacks: { p1: "assets/card_backs/default_back.jpg", p2: "assets/card_backs/default_back.jpg" },
    cosmeticIds: {
      variants: { p1: null, p2: null },
      cardBacks: { p1: "default_card_back", p2: "default_card_back" }
    },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      mode: "local_pvp",
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  const pvpTitleMatches = pvpHtml.match(/data-preview-type="title"[^>]*data-preview-src=""[^>]*data-preview-name="Initiate"/g) ?? [];
  assert.equal(pvpTitleMatches.length, 2);

  const onlineHtml = onlinePlayScreen.render({
    username: "LocalUser",
    joinCode: "",
    backgroundImage: "assets/EleMintzIcon.png",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      room: {
        roomCode: "ABC123",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostResolvedIdentity: {
          slotLabel: "Host",
          username: "LocalUser",
          connected: true,
          avatarId: "default_avatar",
          titleId: "Initiate",
          badgeId: "none",
          titleLabel: "Initiate",
          titleIcon: null,
          badgeImage: null,
          avatarImage: getAvatarImage("default_avatar"),
          backgroundImage: getArenaBackground("default_background"),
          cardBackId: "default_card_back",
          cardBackImage: getCardBackImage("default_card_back"),
          variantSelection: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
          variantImages: getVariantCardImages({ fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" })
        },
        guestResolvedIdentity: {
          slotLabel: "Guest",
          username: "RemoteUser",
          connected: true,
          avatarId: "default_avatar",
          titleId: "Initiate",
          badgeId: "none",
          titleLabel: "Initiate",
          titleIcon: null,
          badgeImage: null,
          avatarImage: getAvatarImage("default_avatar"),
          backgroundImage: getArenaBackground("default_background"),
          cardBackId: "default_card_back",
          cardBackImage: getCardBackImage("default_card_back"),
          variantSelection: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
          variantImages: getVariantCardImages({ fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" })
        },
        hostHand: { fire: 1, water: 0, earth: 0, wind: 0 },
        guestHand: { fire: 1, water: 0, earth: 0, wind: 0 },
        hostScore: 0,
        guestScore: 0,
        roundNumber: 1,
        matchComplete: false,
        moveSync: { hostSubmitted: false, guestSubmitted: false, submittedCount: 0, bothSubmitted: false, updatedAt: null }
      }
    }
  });

  const onlineTitleMatches = onlineHtml.match(/data-preview-type="title"[^>]*data-preview-src=""[^>]*data-preview-name="Initiate"/g) ?? [];
  assert.equal(onlineTitleMatches.length, 2);
});

test("ui: approved achievement title rewards resolve and render their badge-backed title images", () => {
  const html = profileScreen.render({
    profile: {
      username: "StormUser",
      title: "Storm Breaker",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 7,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Storm Breaker", badge: "none" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
        badge: "none",
        title: "Storm Breaker"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Storm Breaker", name: "Storm Breaker", image: "badges/badge_longest_war_7.png", owned: true }]
      }
    },
    searchResults: [],
    searchQuery: "",
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(html, /Storm Breaker/);
  assert.match(html, /assets\/badges\/badge_longest_war_7\.png/);
});


test("ui: profile title icon resolves pre-resolved asset paths", () => {
  const html = profileScreen.render({
    profile: {
      username: "PathUser",
      title: "Flame Vanguard",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Flame Vanguard" }
    },
    cosmetics: {
      equipped: { avatar: "default_avatar", cardBack: "default_card_back", background: "default_background", elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" }, badge: "none", title: "Flame Vanguard" },
      catalog: { avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }], cardBack: [{ id: "default_card_back", name: "Default", owned: true }], background: [{ id: "default_background", name: "Default", owned: true }], elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }, { id: "default_water_card", name: "Core Water", element: "water", owned: true }, { id: "default_earth_card", name: "Core Earth", element: "earth", owned: true }, { id: "default_wind_card", name: "Core Wind", element: "wind", owned: true }], badge: [{ id: "none", name: "No Badge", owned: true }], title: [{ id: "Flame Vanguard", name: "Flame Vanguard", image: "../../assets/titles/title_flame_vanguard.png", owned: true }] }
    },
    titleIcon: "../../assets/badges/firstFlame.png",
    searchResults: [],
    searchQuery: "",
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(html, /\.\.\/\.\.\/assets\/titles\/title_flame_vanguard\.png/);
});

test("ui: game screen uses side-specific card back images for hidden hands", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "P1", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "P2", title: "Initiate", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: true, activePlayer: "p2", turnLabel: "P2 Turn", p1Name: "P1", p2Name: "P2" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" },
      p2: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" }
    },
    cosmeticIds: {
      variants: {
        p1: { fire: "fire_variant_phoenix", water: "water_variant_crystal", earth: "earth_variant_titan", wind: "wind_variant_storm_eye" },
        p2: { fire: "fire_variant_ember", water: "water_variant_tidal_spirit", earth: "earth_variant_rooted_monolith", wind: "wind_variant_sky_serpent" }
      },
      cardBacks: {
        p1: "cardback_elemental_nexus",
        p2: "cardback_storm_spiral"
      }
    },
    cardBacks: {
      p1: "assets/cards/customP1Back.jpg",
      p2: "assets/cards/customP2Back.jpg"
    },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      mode: "local_pvp",
      playerHand: ["fire", "water"],
      opponentHand: ["earth", "wind"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /assets\/cards\/customP1Back\.jpg/);
  assert.match(html, /hidden-hand-summary rarity-legendary/);
  assert.match(html, /hand-slot[^"]*rarity-rare/);
});


test("ui: profile and game do not render featured badge when none is selected", () => {
  const profileHtml = profileScreen.render({
    profile: {
      username: "NoBadge",
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: { avatar: "default_avatar", cardBack: "default_card_back", background: "default_background", elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" }, badge: "none", title: "Initiate" },
      catalog: { avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }], cardBack: [{ id: "default_card_back", name: "Default", owned: true }], background: [{ id: "default_background", name: "Default", owned: true }], elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }], badge: [{ id: "none", name: "No Badge", owned: true }], title: [{ id: "Initiate", name: "Initiate", owned: true }] }
    },
    titleIcon: null,
    searchResults: [],
    searchQuery: "",
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.doesNotMatch(profileHtml, /featured-badge/);

  const gameHtml = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "NoBadge", title: "Initiate", avatar: "assets/avatars/default.png", featuredBadge: null },
    opponentDisplay: { name: "Elemental AI", title: "Arena Rival", avatar: "assets/avatars/default.png", featuredBadge: null },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "NoBadge", p2Name: "AI" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: { p1: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" }, p2: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" } },
    game: { roundOutcome: { key: "no_effect", label: "No effect" }, roundResult: "No effect.", round: 1, timerSeconds: 20, totalMatchSeconds: 300, canSelectCard: true, mode: "pve", playerHand: ["fire"], opponentHand: ["water"], pileCount: 0, totalWarClashes: 0, warPileCards: [], captured: { p1: 0, p2: 0 }, lastRound: null },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.doesNotMatch(gameHtml, /featured-badge/);
});

test("ui: featured badge renders to the right of title on profile and game", () => {
  const profileHtml = profileScreen.render({
    profile: {
      username: "BadgeUser",
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "war_machine_badge" }
    },
    cosmetics: {
      equipped: { avatar: "default_avatar", cardBack: "default_card_back", background: "default_background", elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" }, badge: "war_machine_badge", title: "Initiate" },
      catalog: { avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }], cardBack: [{ id: "default_card_back", name: "Default", owned: true }], background: [{ id: "default_background", name: "Default", owned: true }], elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }], badge: [{ id: "war_machine_badge", name: "War Machine", owned: true }], title: [{ id: "Initiate", name: "Initiate", owned: true }] }
    },
    titleIcon: null,
    searchResults: [],
    searchQuery: "",
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(profileHtml, /featured-badge/);
  assert.match(profileHtml, /warMachine\.png/);

  const gameHtml = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "BadgeUser", title: "Initiate", avatar: "assets/avatars/default.png", featuredBadge: "assets/badges/warMachine.png" },
    opponentDisplay: { name: "Elemental AI", title: "Arena Rival", avatar: "assets/avatars/default.png", featuredBadge: null },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "BadgeUser", p2Name: "AI" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: { p1: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" }, p2: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" } },
    game: { roundOutcome: { key: "no_effect", label: "No effect" }, roundResult: "No effect.", round: 1, timerSeconds: 20, totalMatchSeconds: 300, canSelectCard: true, mode: "pve", playerHand: ["fire"], opponentHand: ["water"], pileCount: 0, totalWarClashes: 0, warPileCards: [], captured: { p1: 0, p2: 0 }, lastRound: null },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(gameHtml, /featured-badge/);
  assert.match(gameHtml, /assets\/badges\/warMachine\.png/);
});

test("ui: achievements screen uses 3-column catalog grid class", () => {
  const html = achievementsScreen.render({ achievements: [] });
  assert.match(html, /achievement-grid achievement-grid-catalog/);
});

test("ui: menu and profile screens render themed background surfaces", () => {
  const menuHtml = menuScreen.render({
    username: "ThemeUser",
    backgroundImage: "assets/EleMintzIcon.png",
    actions: {}
  });

  assert.match(menuHtml, /screen-menu/);
  assert.match(menuHtml, /arena-board screen-themed-surface/);
  assert.match(menuHtml, /background-image: url\('assets\/EleMintzIcon\.png'\)/);
  assert.match(menuHtml, /panel themed-screen-panel/);

  const profileHtml = profileScreen.render({
    profile: {
      username: "ThemeUser",
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", background: "default_background", badge: "none" }
    },
    cosmetics: {
      equipped: { avatar: "default_avatar", cardBack: "default_card_back", background: "default_background", elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" }, badge: "none", title: "Initiate" },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default", owned: true }],
        background: [{ id: "default_background", name: "Default", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    titleIcon: null,
    searchResults: [],
    searchQuery: "",
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(profileHtml, /screen-profile/);
  assert.match(profileHtml, /arena-board screen-themed-surface/);
  assert.match(profileHtml, /panel themed-screen-panel/);
});

test("ui: selected background value is applied consistently in menu, profile, and match", () => {
  const selected = "assets/backgrounds/lava_throne_background.png";

  const menuHtml = menuScreen.render({
    username: "BgUser",
    backgroundImage: selected,
    actions: {}
  });

  const profileHtml = profileScreen.render({
    profile: {
      username: "BgUser",
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", background: "lava_throne_background", badge: "none" },
      cosmetics: { background: "lava_throne_background" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "lava_throne_background",
        elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" },
        badge: "none",
        title: "Initiate"
      },
      catalog: { avatar: [], cardBack: [], background: [], elementCardVariant: [], badge: [], title: [] }
    },
    titleIcon: null,
    searchResults: [],
    searchQuery: "",
    viewedProfile: null,
    backgroundImage: selected
  });

  const gameHtml = gameScreen.render({
    reducedMotion: true,
    arenaBackground: selected,
    playerDisplay: { name: "BgUser", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "AI", title: "Arena Rival", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "BgUser", p2Name: "AI" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" },
      p2: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" }
    },
    cardBacks: { p1: "assets/card_backs/default_back.jpg", p2: "assets/card_backs/default_back.jpg" },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      mode: "pve",
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(menuHtml, /assets\/backgrounds\/lava_throne_background\.png/);
  assert.match(profileHtml, /assets\/backgrounds\/lava_throne_background\.png/);
  assert.match(gameHtml, /assets\/backgrounds\/lava_throne_background\.png/);
});






test("ui: menu shows daily and weekly challenge preview panels", () => {
  const html = menuScreen.render({
    username: "DailyMenuUser",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Next Daily Login Reward: 00:30",
        resetLabel: "00:30"
      },
      daily: {
        resetLabel: "23:59",
        challenges: [
          { name: "Win 1 Match", rewardTokens: 2, rewardXp: 5, completed: false },
          { name: "Win 1 WAR", rewardTokens: 2, rewardXp: 5, completed: true }
        ]
      },
      weekly: {
        resetLabel: "143:00",
        challenges: [
          { name: "Win 10 Matches", rewardTokens: 5, rewardXp: 15, completed: false }
        ]
      }
    },
    actions: {}
  });

  assert.match(html, /Daily/);
  assert.match(html, /Weekly/);
  assert.match(html, /Daily Login Reward: 00:30/);
  assert.match(html, /Daily - 1\/2/);
  assert.match(html, /Weekly - 0\/1/);
  assert.match(html, /menu-challenge-columns/);
  assert.match(html, /Win 1 Match/);
  assert.match(html, /\+5 XP &#8226; \+2 Tokens/);
  assert.match(html, /Win 10 Matches/);
  assert.match(html, /\+15 XP &#8226; \+5 Tokens/);
  assert.match(html, /open-daily-challenges-btn/);
});

test("ui: daily challenges screen renders progress and reset timer", () => {
  const html = dailyChallengesScreen.render({
    tokens: 12,
    daily: {
      msUntilReset: 3600000,
      challenges: [
        {
          id: "daily_win_1_match",
          name: "Win 1 Match",
          description: "Win 1 completed match.",
          rewardTokens: 1,
          rewardXp: 3,
          goal: 1,
          progress: 1,
          completed: true
        }
      ]
    },
    weekly: {
      msUntilReset: 7200000,
      challenges: []
    },
    actions: { back: () => {} }
  });

  assert.match(html, /Daily Challenges/);
  assert.match(html, /Daily - 1\/1/);
  assert.match(html, /Weekly - 0\/0/);
  assert.match(html, /Progress: 1 \/ 1/);
  assert.match(html, /Reward: \+1 token, \+3 XP/);
  assert.match(html, /Resets in:/);
  assert.match(html, /Resets in: <strong>01:00<\/strong>/);
});


test("ui: menu uses challenge panel heading and challenge icons", () => {
  const html = menuScreen.render({
    username: "LabelUser",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Daily Login Reward Available Now",
        resetLabel: "01:00"
      },
      daily: {
        resetLabel: "01:00",
        challenges: [{ name: "Win 1 Match", rewardTokens: 1, completed: true }]
      },
      weekly: {
        resetLabel: "2d 03:00",
        challenges: [{ name: "Play 15 Matches", rewardTokens: 1, completed: false }]
      }
    },
    actions: {}
  });

  assert.doesNotMatch(html, />Challenges<\/button>/);
  assert.match(html, /<h3 class="section-title">Challenges<\/h3>/);
  assert.match(html, /Daily Login Reward Available Now/);
  assert.ok(html.includes("\u2B50"));
  assert.ok(html.includes("\uD83C\uDFC6"));
  assert.ok(html.includes("\u2714"));
});

test("ui: menu right panel places daily and weekly previews side by side with centered view all action", () => {
  const html = menuScreen.render({
    username: "PanelUser",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Next Daily Login Reward: 00:30",
        resetLabel: "00:30"
      },
      daily: {
        resetLabel: "23:59",
        challenges: [
          { name: "Win 1 Match", rewardTokens: 1, completed: false, progress: 0, goal: 1 }
        ]
      },
      weekly: {
        resetLabel: "143:00",
        challenges: [
          { name: "Win 10 Matches", rewardTokens: 1, completed: false, progress: 1, goal: 10 }
        ]
      }
    },
    actions: {}
  });

  assert.ok(html.indexOf("Daily Login Reward: 00:30") < html.indexOf("Daily - 0/1"));
  assert.ok(html.indexOf("Daily - 0/1") < html.indexOf('id="open-daily-challenges-btn"'));
  assert.ok(html.indexOf("Weekly - 0/1") < html.indexOf('id="open-daily-challenges-btn"'));
  assert.match(html, /class="menu-challenges-heading"/);
  assert.match(html, /class="grid two-col menu-challenge-columns"/);
  assert.match(html, /menu-challenge-reset/);
  assert.match(html, /class="menu-challenge-actions"/);
});

test("ui: menu renders buttons in requested order without standalone challenges button", () => {
  const html = menuScreen.render({
    username: "OrderButtons",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Daily Login Reward Available Now",
        resetLabel: "01:00"
      },
      daily: { resetLabel: "01:00", challenges: [] },
      weekly: { resetLabel: "2d 03:00", challenges: [] }
    },
    actions: {}
  });

  const expectedOrder = [
    "how-to-play-btn",
    "start-pve-btn",
    "start-local-btn",
    "online-play-btn",
    "profile-btn",
    "cosmetics-btn",
    "store-btn",
    "achievements-btn",
    "roadmap-btn",
    "settings-btn",
    "feedback-btn",
    "logout-btn"
  ];

  const indices = expectedOrder.map((id) => html.indexOf(`id="${id}"`));
  indices.forEach((index) => assert.ok(index >= 0));
  for (let i = 1; i < indices.length; i += 1) {
    assert.ok(indices[i - 1] < indices[i]);
  }
  assert.equal(html.includes('id="daily-challenges-btn"'), false);
});

test("ui: menu action buttons use menu tile artwork backgrounds", () => {
  const html = menuScreen.render({
    username: "TileArtUser",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Daily Login Reward Available Now",
        resetLabel: "01:00"
      },
      daily: { resetLabel: "01:00", challenges: [] },
      weekly: { resetLabel: "2d 03:00", challenges: [] }
    },
    actions: {}
  });

  assert.match(html, /class="grid two-col menu-action-grid"/);
  assert.match(html, /class="menu-tile"/);
  assert.doesNotMatch(html, /class="btn menu-tile"/);
  assert.match(html, /class="menu-tile__visual"/);
  assert.match(html, /id="start-pve-btn"[\s\S]*menu_tiles\/tile_play_ai\.png/);
  assert.match(html, /id="start-local-btn"[\s\S]*menu_tiles\/tile_local_pvp\.png/);
  assert.match(html, /id="online-play-btn"[\s\S]*menu_tiles\/tile_local_pvp\.png/);
  assert.match(html, /id="profile-btn"[\s\S]*menu_tiles\/tile_profile\.png/);
  assert.match(html, /id="cosmetics-btn"[\s\S]*menu_tiles\/tile_cosmetics\.png/);
  assert.match(html, /id="store-btn"[\s\S]*menu_tiles\/tile_store\.png/);
  assert.match(html, /id="achievements-btn"[\s\S]*menu_tiles\/tile_achievements\.png/);
  assert.match(html, /id="roadmap-btn"[\s\S]*menu_tiles\/tile_roadmap\.png/);
  assert.match(html, /id="settings-btn"[\s\S]*menu_tiles\/tile_settings\.png/);
  assert.match(html, /id="how-to-play-btn"[\s\S]*menu_tiles\/tile_how_to_play\.png/);
  assert.match(html, /id="feedback-btn"[\s\S]*menu_tiles\/tile_feedback\.png/);
  assert.match(html, /id="logout-btn"[\s\S]*menu_tiles\/tile_logout\.png/);
  assert.match(html, /menu-tile__veil/);
  assert.match(html, /menu-tile__label/);
  assert.doesNotMatch(html, /title="Play vs AI"/);
});

test("ui: menu shows Daily Login section above the Challenges heading", () => {
  const html = menuScreen.render({
    username: "OrderUser",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Daily Login Reward Available Now",
        resetLabel: "01:00"
      },
      daily: {
        resetLabel: "01:00",
        challenges: []
      },
      weekly: {
        resetLabel: "2d 03:00",
        challenges: []
      }
    },
    actions: {}
  });

  assert.ok(html.indexOf("Daily Login Reward") < html.indexOf("<h3 class=\"section-title\">Challenges</h3>"));
});

test("ui: viewed profile renders gauntlet stat fallbacks as 0 when missing", () => {
  const html = profileScreen.renderViewedProfileModalBody({
      username: "LegacyViewed",
      title: "Initiate",
      playerLevel: 2,
      playerXP: 25,
      tokens: 10,
      gamesPlayed: 1,
      wins: 1,
      losses: 0,
      cardsCaptured: 2,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      bestWinStreak: 1,
      featuredRivalWins: 0,
      achievements: {},
      modeStats: {
        pve: { wins: 1, losses: 0, gamesPlayed: 1, cardsCaptured: 2, warsEntered: 0, warsWon: 0, longestWar: 0 }
      },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", background: "default_background" }
  });

  assert.match(html, />Gauntlet</);
  assert.match(html, /Best Gauntlet Streak/);
  assert.match(html, /Gauntlet Runs/);
  assert.match(html, /Gauntlet Wins/);
  assert.match(html, /Gauntlet Losses/);
  assert.match(html, /Rivals Defeated/);
  assert.match(html, /profile-stat-value">0<\/strong>/);
});

test("ui: menu renders the highest-priority announcement card above daily login", () => {
  const html = menuScreen.render({
    username: "AnnouncementUser",
    backgroundImage: "assets/EleMintzIcon.png",
    announcement: {
      id: "patch-2-1-9",
      title: "v2.1.9 Patch Live",
      message: "Fixed the Profile reward popup loop reported by Bane.",
      type: "patch",
      dismissible: true
    },
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Daily Login Reward Available Now",
        resetLabel: "01:00"
      },
      daily: { resetLabel: "01:00", challenges: [] },
      weekly: { resetLabel: "2d 03:00", challenges: [] }
    },
    actions: {}
  });

  assert.match(html, /data-menu-announcement-card="true"/);
  assert.match(html, /Announcement/);
  assert.match(html, /v2\.1\.9 Patch Live/);
  assert.match(html, /Fixed the Profile reward popup loop reported by Bane\./);
  assert.match(html, /menu-announcement-card__type">patch</);
  assert.match(html, /id="dismiss-announcement-btn"/);
  assert.ok(html.indexOf('data-menu-announcement-card="true"') < html.indexOf('data-menu-daily-login-panel="true"'));
});

test("ui: menu announcement preserves multiline paragraphs and bullet lines safely", () => {
  const html = menuScreen.render({
    username: "AnnouncementUser",
    backgroundImage: "assets/EleMintzIcon.png",
    announcement: {
      id: "patch-2-2-0",
      title: "v2.2.0 Update",
      message: "Fresh fixes this week.\n- Better menu spacing\n- Safer reconnect handling\n\n<script>alert('xss')</script>",
      type: "patch",
      dismissible: true
    },
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Daily Login Reward Available Now",
        resetLabel: "01:00"
      },
      daily: { resetLabel: "01:00", challenges: [] },
      weekly: { resetLabel: "2d 03:00", challenges: [] }
    },
    actions: {}
  });

  assert.match(html, /menu-announcement-card__message-group/);
  assert.match(html, /Fresh fixes this week\./);
  assert.match(html, /class="menu-announcement-card__list"/);
  assert.match(html, /<li class="menu-announcement-card__list-item">Better menu spacing<\/li>/);
  assert.match(html, /<li class="menu-announcement-card__list-item">Safer reconnect handling<\/li>/);
  assert.match(html, /&lt;script&gt;alert\(&#39;xss&#39;\)&lt;\/script&gt;/);
  assert.ok((html.match(/class="menu-announcement-card__message"/g) ?? []).length >= 2);
  assert.match(html, /class="stack-xs menu-announcement-card__content"/);
  assert.match(html, /id="dismiss-announcement-btn"/);
  assert.ok(html.indexOf("menu-announcement-card__content") < html.indexOf("menu-announcement-card__actions"));
});

test("ui: menu announcement keeps short messages safe inside the scrollable content wrapper", () => {
  const html = menuScreen.render({
    username: "AnnouncementUser",
    backgroundImage: "assets/EleMintzIcon.png",
    announcement: {
      id: "patch-2-2-1",
      title: "Quick Heads Up",
      message: "Tiny patch deployed.",
      type: "patch",
      dismissible: true
    },
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Daily Login Reward Available Now",
        resetLabel: "01:00"
      },
      daily: { resetLabel: "01:00", challenges: [] },
      weekly: { resetLabel: "2d 03:00", challenges: [] }
    },
    actions: {}
  });

  assert.match(html, /class="stack-xs menu-announcement-card__content"/);
  assert.match(html, /Tiny patch deployed\./);
  assert.match(html, /id="dismiss-announcement-btn"/);
});

test("ui: menu renders no boost event shell when there is no active boost event", () => {
  const html = menuScreen.render({
    username: "AnnouncementUser",
    backgroundImage: "assets/EleMintzIcon.png",
    announcement: null,
    boostEvent: null,
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Daily Login Reward Available Now",
        resetLabel: "01:00"
      },
      daily: { resetLabel: "01:00", challenges: [] },
      weekly: { resetLabel: "2d 03:00", challenges: [] }
    },
    actions: {}
  });

  assert.doesNotMatch(html, /data-menu-boost-card="true"/);
});

test("ui: menu renders active boost event card above daily login with title, multiline message, multipliers, and scope", () => {
  const html = menuScreen.render({
    username: "BoostUser",
    backgroundImage: "assets/EleMintzIcon.png",
    announcement: null,
    boostEvent: {
      title: "Online Players X2 XP Weekend",
      message: "Earn double XP in Online Play this weekend.\n\nBonus Tokens are live too.",
      scope: "online",
      xpMultiplier: 2,
      tokenMultiplier: 1.5,
      endsAtLabel: "May 25, 6:00 AM"
    },
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Daily Login Reward Available Now",
        resetLabel: "01:00"
      },
      daily: { resetLabel: "01:00", challenges: [] },
      weekly: { resetLabel: "2d 03:00", challenges: [] }
    },
    actions: {}
  });

  assert.match(html, /data-menu-boost-card="true"/);
  assert.match(html, /BOOST EVENT/);
  assert.match(html, /Online Players X2 XP Weekend/);
  assert.match(html, /Earn double XP in Online Play this weekend\./);
  assert.match(html, /Bonus Tokens are live too\./);
  assert.match(html, /menu-boost-card__message-group/);
  assert.match(html, /Online Play/);
  assert.match(html, /XP Boost/);
  assert.match(html, />2x</);
  assert.match(html, /Token Boost/);
  assert.match(html, />1\.5x</);
  assert.match(html, /May 25, 6:00 AM/);
  assert.ok(html.indexOf('data-menu-boost-card="true"') < html.indexOf('data-menu-daily-login-panel="true"'));
});

test("ui: menu renders no empty announcement shell when there is no active announcement", () => {
  const html = menuScreen.render({
    username: "AnnouncementUser",
    backgroundImage: "assets/EleMintzIcon.png",
    announcement: null,
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Daily Login Reward Available Now",
        resetLabel: "01:00"
      },
      daily: { resetLabel: "01:00", challenges: [] },
      weekly: { resetLabel: "2d 03:00", challenges: [] }
    },
    actions: {}
  });

  assert.doesNotMatch(html, /data-menu-announcement-card="true"/);
});

test("ui: menu announcement dismiss button binds to the dismiss action with the announcement id", async () => {
  const previousDocument = global.document;
  const dismissCalls = [];
  const elements = {
    "start-pve-btn": createFakeElement(),
    "start-local-btn": createFakeElement(),
    "online-play-btn": createFakeElement(),
    "profile-btn": createFakeElement(),
    "achievements-btn": createFakeElement(),
    "open-daily-challenges-btn": createFakeElement(),
    "cosmetics-btn": createFakeElement(),
    "store-btn": createFakeElement(),
    "roadmap-btn": createFakeElement(),
    "settings-btn": createFakeElement(),
    "how-to-play-btn": createFakeElement(),
    "feedback-btn": createFakeElement(),
    "logout-btn": createFakeElement(),
    "dismiss-announcement-btn": {
      dataset: { announcementId: "patch-2-1-9" },
      listeners: new Map(),
      addEventListener(type, handler) {
        this.listeners.set(type, handler);
      }
    }
  };

  global.document = {
    getElementById: (id) => elements[id] ?? null
  };

  try {
    menuScreen.bind({
      actions: {
        startPveGame: () => {},
        startLocalGame: () => {},
        openOnlinePlay: async () => {},
        openProfile: async () => {},
        openAchievements: async () => {},
        openDailyChallenges: async () => {},
        openCosmetics: async () => {},
        openStore: async () => {},
        openRoadmap: () => {},
        openSettings: async () => {},
        openHowToPlay: async () => {},
        openFeedback: () => {},
        logout: () => {},
        dismissAnnouncement: async (id) => dismissCalls.push(id)
      }
    });

    await elements["dismiss-announcement-btn"].listeners.get("click")();

    assert.deepEqual(dismissCalls, ["patch-2-1-9"]);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: menu renders a How to Play button and keeps existing buttons", () => {
  const html = menuScreen.render({
    username: "HelpUser",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Daily Login Reward Available Now",
        resetLabel: "01:00"
      },
      daily: { resetLabel: "01:00", challenges: [] },
      weekly: { resetLabel: "2d 03:00", challenges: [] }
    },
    actions: {}
  });

  assert.match(html, /id="how-to-play-btn"/);
  assert.match(html, />How to Play</);
  assert.match(html, /id="store-btn"/);
  assert.match(html, /id="roadmap-btn"/);
  assert.match(html, />Roadmap</);
  assert.match(html, /id="settings-btn"/);
  assert.match(html, /id="feedback-btn"/);
});

test("ui: roadmap screen renders the static player-facing roadmap content", () => {
  const html = roadmapScreen.render({
    actions: { back: () => {} }
  });

  assert.match(html, /EleMintz Roadmap/);
  assert.match(html, /id="roadmap-back-btn"/);
  assert.match(html, /A look at features planned or being explored\. Details may change as EleMintz grows\./);
  assert.match(html, />COMING SOON</);
  assert.match(html, />LATER</);
  assert.match(html, /New cosmetic drops/);
  assert.match(html, /More Gauntlet rivals/);
  assert.match(html, /Challenge reward improvements/);
  assert.match(html, /Quality-of-life polish/);
  assert.match(html, /Alpha Season Track/);
  assert.match(html, /Referral bonuses/);
  assert.match(html, /Leaderboards/);
  assert.match(html, /Tournaments/);
  assert.match(html, /Deck Builder experiments/);
});

test("ui: roadmap screen back button binds to the provided action", () => {
  const previousDocument = global.document;
  let backCalls = 0;
  const backButton = createFakeElement();

  global.document = {
    getElementById: (id) => (id === "roadmap-back-btn" ? backButton : null)
  };

  try {
    roadmapScreen.bind({
      actions: {
        back: () => {
          backCalls += 1;
        }
      }
    });

    backButton.listeners.get("click")();

    assert.equal(backCalls, 1);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: how to play screen renders compact accordion sections with the current gameplay guidance", () => {
  const html = howToPlayScreen.render({
    actions: { back: () => {} }
  });

  assert.match(html, /How to Play EleMintz/);
  assert.match(html, /id="how-to-play-back-btn"/);
  assert.match(html, /data-how-to-play-section="quick-start" open/);
  assert.match(html, /data-how-to-play-section="element-rules" open/);
  assert.match(html, /data-how-to-play-section="elemint-fatigue"/);
  assert.match(html, /data-how-to-play-section="round-outcomes"/);
  assert.match(html, /data-how-to-play-section="war"/);
  assert.match(html, /data-how-to-play-section="game-modes"/);
  assert.match(html, /data-how-to-play-section="rewards"/);
  assert.match(html, /data-how-to-play-section="cosmetics-loadouts"/);
  assert.match(html, /data-how-to-play-section="strategy-hints"/);
  assert.match(html, />Quick Start</);
  assert.match(html, /Element Rules/);
  assert.match(html, /Elemint Fatigue/);
  assert.match(html, /Round Outcomes/);
  assert.match(html, /WAR/);
  assert.match(html, /Game Modes/);
  assert.match(html, /Rewards/);
  assert.match(html, /Cosmetics \+ Loadouts/);
  assert.match(html, /Strategy Hints/);
  assert.match(html, /Pick a card\. Read the matchup\. Win cards\. Survive WAR\./);
  assert.match(html, /Each element beats one other element\. Same cards start WAR\./);
  assert.match(html, /Fire<\/strong> beats Earth/);
  assert.match(html, /Earth<\/strong> beats Wind/);
  assert.match(html, /Wind<\/strong> beats Water/);
  assert.match(html, /Water<\/strong> beats Fire/);
  assert.match(html, /If you play the same Elemint twice in a row, that Elemint must rest for one turn\./);
  assert.match(html, /You must choose a different Elemint if you have one available\./);
  assert.match(html, /If it is your only playable Elemint, you may still use it\./);
  assert.match(html, /Gauntlet Mode/);
  assert.match(html, /Featured Rival/);
  assert.match(html, /Harder AI and real players punish predictable choices\./);
  assert.doesNotMatch(html, /data-how-to-play-section="round-outcomes" open/);
  assert.doesNotMatch(html, /data-how-to-play-section="elemint-fatigue" open/);
  assert.doesNotMatch(html, /data-how-to-play-section="war" open/);
  assert.doesNotMatch(html, /data-how-to-play-section="game-modes" open/);
  assert.doesNotMatch(html, /data-how-to-play-section="rewards" open/);
  assert.doesNotMatch(html, /data-how-to-play-section="cosmetics-loadouts" open/);
  assert.doesNotMatch(html, /data-how-to-play-section="strategy-hints" open/);
});

test("ui: how to play screen back button binds to the provided action", () => {
  const previousDocument = global.document;
  let backCalls = 0;
  const backButton = createFakeElement();

  global.document = {
    getElementById: (id) => (id === "how-to-play-back-btn" ? backButton : null)
  };

  try {
    howToPlayScreen.bind({
      actions: {
        back: () => {
          backCalls += 1;
        }
      }
    });

    backButton.listeners.get("click")();

    assert.equal(backCalls, 1);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: menu how to play button binds to the provided action", () => {
  const previousDocument = global.document;
  let howToPlayCalls = 0;
  const elements = {
    "start-pve-btn": createFakeElement(),
    "start-local-btn": createFakeElement(),
    "online-play-btn": createFakeElement(),
    "profile-btn": createFakeElement(),
    "achievements-btn": createFakeElement(),
    "open-daily-challenges-btn": createFakeElement(),
    "cosmetics-btn": createFakeElement(),
    "store-btn": createFakeElement(),
    "roadmap-btn": createFakeElement(),
    "settings-btn": createFakeElement(),
    "how-to-play-btn": createFakeElement(),
    "feedback-btn": createFakeElement(),
    "logout-btn": createFakeElement()
  };

  global.document = {
    getElementById: (id) => elements[id] ?? null
  };

  try {
    menuScreen.bind({
      actions: {
        startPveGame: () => {},
        startLocalGame: () => {},
        openOnlinePlay: async () => {},
        openProfile: async () => {},
        openAchievements: async () => {},
        openDailyChallenges: async () => {},
        openCosmetics: async () => {},
        openStore: async () => {},
        openRoadmap: () => {},
        openSettings: async () => {},
        openHowToPlay: () => {
          howToPlayCalls += 1;
        },
        openFeedback: () => {},
        logout: () => {},
        dismissAnnouncement: async () => {}
      }
    });

    elements["how-to-play-btn"].listeners.get("click")();

    assert.equal(howToPlayCalls, 1);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: menu roadmap button binds to the provided action", () => {
  const previousDocument = global.document;
  let roadmapCalls = 0;
  const elements = {
    "start-pve-btn": createFakeElement(),
    "start-local-btn": createFakeElement(),
    "online-play-btn": createFakeElement(),
    "profile-btn": createFakeElement(),
    "achievements-btn": createFakeElement(),
    "open-daily-challenges-btn": createFakeElement(),
    "cosmetics-btn": createFakeElement(),
    "store-btn": createFakeElement(),
    "roadmap-btn": createFakeElement(),
    "settings-btn": createFakeElement(),
    "how-to-play-btn": createFakeElement(),
    "feedback-btn": createFakeElement(),
    "logout-btn": createFakeElement()
  };

  global.document = {
    getElementById: (id) => elements[id] ?? null
  };

  try {
    menuScreen.bind({
      actions: {
        startPveGame: () => {},
        startLocalGame: () => {},
        openOnlinePlay: async () => {},
        openProfile: async () => {},
        openAchievements: async () => {},
        openDailyChallenges: async () => {},
        openCosmetics: async () => {},
        openStore: async () => {},
        openRoadmap: () => {
          roadmapCalls += 1;
        },
        openSettings: async () => {},
        openHowToPlay: () => {},
        openFeedback: () => {},
        logout: () => {},
        dismissAnnouncement: async () => {}
      }
    });

    elements["roadmap-btn"].listeners.get("click")();

    assert.equal(roadmapCalls, 1);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: appController showHowToPlay opens the help screen and back returns to menu", () => {
  const shown = [];
  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (screenId, context) => {
        shown.push({ screenId, context });
      }
    },
    modalManager: {
      show: () => {},
      hide: () => {},
      clearStaleOverlay: () => false
    },
    toastManager: {
      show: () => {}
    }
  });

  controller.showMenu = () => {
    shown.push({ screenId: "menu", context: null });
  };

  controller.showHowToPlay();

  assert.equal(shown.at(-1).screenId, "howToPlay");

  shown.at(-1).context.actions.back();

  assert.equal(shown.at(-1).screenId, "menu");
});

test("ui: appController showRoadmap opens the roadmap screen and back returns to menu", () => {
  const shown = [];
  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (screenId, context) => {
        shown.push({ screenId, context });
      }
    },
    modalManager: {
      show: () => {},
      hide: () => {},
      clearStaleOverlay: () => false
    },
    toastManager: {
      show: () => {}
    }
  });

  controller.showMenu = () => {
    shown.push({ screenId: "menu", context: null });
  };

  controller.showRoadmap();

  assert.equal(shown.at(-1).screenId, "roadmap");

  shown.at(-1).context.actions.back();

  assert.equal(shown.at(-1).screenId, "menu");
});

test("ui: daily challenges screen shows weekly reset with day format", () => {
  const html = dailyChallengesScreen.render({
    tokens: 5,
    daily: {
      msUntilReset: 3600000,
      challenges: []
    },
    weekly: {
      msUntilReset: (2 * 24 * 60 + 15) * 60000,
      challenges: [
        {
          id: "weekly_win_10_matches",
          name: "Win 10 Matches",
          description: "Win 10 completed matches.",
          rewardTokens: 1,
          goal: 10,
          progress: 10,
          completed: true
        }
      ]
    },
    actions: { back: () => {} }
  });

  assert.match(html, /2d 00:15/);
  assert.ok(html.includes("\u2714 Completed"));
  assert.ok(html.includes("\uD83C\uDFC6"));
});

test("ui: menu challenge preview shows compact progress for in-progress items", () => {
  const html = menuScreen.render({
    username: "PreviewUser",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Next Daily Login Reward: 05:00",
        resetLabel: "05:00"
      },
      daily: {
        resetLabel: "01:00",
        challenges: [
          { name: "Win 1 Match", rewardTokens: 2, rewardXp: 5, completed: false, progress: 0, goal: 1 },
          { name: "Play 5 Matches", rewardTokens: 3, rewardXp: 6, completed: false, progress: 3, goal: 5 },
          { name: "Win 1 WAR", rewardTokens: 2, rewardXp: 5, completed: true, progress: 1, goal: 1 }
        ]
      },
      weekly: {
        resetLabel: "2d 03:00",
        challenges: [
          { name: "Win 10 Matches", rewardTokens: 5, rewardXp: 15, completed: false, progress: 1, goal: 10 }
        ]
      }
    },
    actions: {}
  });

  assert.match(html, /0\/1/);
  assert.match(html, /3\/5/);
  assert.match(html, /1\/10/);
  assert.match(html, /\+6 XP &#8226; \+3 Tokens/);
  assert.match(html, /\+15 XP &#8226; \+5 Tokens/);
  assert.match(html, /Daily - 1\/3/);
  assert.match(html, /Weekly - 0\/1/);
  assert.ok(html.includes("\u2714"));
});

test("ui: menu challenge preview shows up to three entries per section and keeps reset labels visible", () => {
  const html = menuScreen.render({
    username: "PreviewCapUser",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Next Daily Login Reward: 05:00",
        resetLabel: "05:00"
      },
      daily: {
        resetLabel: "01:00",
        challenges: [
          { name: "Daily 1", rewardTokens: 1, completed: false, progress: 0, goal: 1 },
          { name: "Daily 2", rewardTokens: 1, completed: false, progress: 0, goal: 1 },
          { name: "Daily 3", rewardTokens: 1, completed: false, progress: 0, goal: 1 },
          { name: "Daily 4", rewardTokens: 1, completed: false, progress: 0, goal: 1 },
          { name: "Daily 7", rewardTokens: 1, completed: false, progress: 0, goal: 1 }
        ]
      },
      weekly: {
        resetLabel: "2d 03:00",
        challenges: [
          { name: "Weekly 1", rewardTokens: 1, completed: false, progress: 0, goal: 1 },
          { name: "Weekly 2", rewardTokens: 1, completed: false, progress: 0, goal: 1 },
          { name: "Weekly 3", rewardTokens: 1, completed: false, progress: 0, goal: 1 },
          { name: "Weekly 4", rewardTokens: 1, completed: false, progress: 0, goal: 1 },
          { name: "Weekly 7", rewardTokens: 1, completed: false, progress: 0, goal: 1 }
        ]
      }
    },
    actions: {}
  });

  assert.match(html, /Daily 3/);
  assert.doesNotMatch(html, /Daily 4/);
  assert.doesNotMatch(html, /Daily 7/);
  assert.match(html, /Weekly 3/);
  assert.doesNotMatch(html, /Weekly 4/);
  assert.doesNotMatch(html, /Weekly 7/);
  assert.match(html, /Reset in: 01:00/);
  assert.match(html, /Reset in: 2d 03:00/);
  assert.match(html, /open-daily-challenges-btn/);
});

test("ui: menu challenge preview keeps completed ordinary entries behind incomplete ones", () => {
  const html = menuScreen.render({
    username: "PriorityUser",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Next Daily Login Reward: 05:00",
        resetLabel: "05:00"
      },
      daily: {
        resetLabel: "01:00",
        challenges: [
          { name: "Completed A", rewardTokens: 2, rewardXp: 5, completed: true, progress: 1, goal: 1 },
          { name: "Incomplete A", rewardTokens: 2, rewardXp: 5, completed: false, progress: 0, goal: 1 },
          { name: "Completed B", rewardTokens: 2, rewardXp: 5, completed: true, progress: 1, goal: 1 },
          { name: "Incomplete B", rewardTokens: 2, rewardXp: 5, completed: false, progress: 0, goal: 1 }
        ]
      },
      weekly: {
        resetLabel: "2d 03:00",
        challenges: []
      }
    },
    actions: {}
  });

  const incompleteA = html.indexOf("Incomplete A");
  const incompleteB = html.indexOf("Incomplete B");
  const completedA = html.indexOf("Completed A");
  const completedB = html.indexOf("Completed B");

  assert.ok(incompleteA >= 0);
  assert.ok(incompleteB >= 0);
  assert.ok(completedA >= 0);
  assert.equal(completedB, -1);
  assert.ok(incompleteA < completedA);
  assert.ok(incompleteB < completedA);
});

test("ui: menu challenge preview prioritizes featured rival quests above ordinary core quests", () => {
  const html = menuScreen.render({
    username: "PriorityUser",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Next Daily Login Reward: 05:00",
        resetLabel: "05:00"
      },
      daily: {
        resetLabel: "01:00",
        challenges: [
          {
            id: "daily_play_5_matches",
            name: "Play 5 Matches",
            rewardTokens: 3,
            rewardXp: 6,
            completed: false,
            progress: 4,
            goal: 5
          },
          {
            id: "daily_defeat_featured_rival_1",
            name: "Bring Down the Boss",
            rewardTokens: 8,
            rewardXp: 15,
            completed: false,
            progress: 0,
            goal: 1
          },
          {
            id: "daily_win_1_war",
            name: "Win 1 WAR",
            rewardTokens: 2,
            rewardXp: 5,
            completed: false,
            progress: 0,
            goal: 1
          }
        ]
      },
      weekly: {
        resetLabel: "2d 03:00",
        challenges: []
      }
    },
    actions: {}
  });

  assert.ok(html.indexOf("Bring Down the Boss") < html.indexOf("Play 5 Matches"));
});

test("ui: menu challenge preview prioritizes incomplete featured rival quests above completed ordinary challenges", () => {
  const html = menuScreen.render({
    username: "PriorityUser",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Next Daily Login Reward: 05:00",
        resetLabel: "05:00"
      },
      daily: {
        resetLabel: "01:00",
        challenges: [
          {
            id: "daily_play_5_matches",
            name: "Play 5 Matches",
            rewardTokens: 3,
            rewardXp: 6,
            completed: true,
            progress: 5,
            goal: 5
          },
          {
            id: "daily_defeat_featured_rival_1",
            name: "Bring Down the Boss",
            rewardTokens: 8,
            rewardXp: 15,
            completed: false,
            progress: 0,
            goal: 1
          }
        ]
      },
      weekly: {
        resetLabel: "2d 03:00",
        challenges: []
      }
    },
    actions: {}
  });

  assert.ok(html.indexOf("Bring Down the Boss") < html.indexOf("Play 5 Matches"));
});

test("ui: menu challenge preview prioritizes bonus quests above ordinary core quests when metadata is present", () => {
  const html = menuScreen.render({
    username: "PriorityUser",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Next Daily Login Reward: 05:00",
        resetLabel: "05:00"
      },
      daily: {
        resetLabel: "01:00",
        challenges: [
          {
            id: "daily_play_5_matches",
            name: "Play 5 Matches",
            rewardTokens: 3,
            rewardXp: 6,
            completed: false,
            progress: 4,
            goal: 5
          },
          {
            id: "daily_no_quit_3",
            name: "Complete 3 Matches Without Quitting",
            rewardTokens: 3,
            rewardXp: 6,
            completed: false,
            progress: 0,
            goal: 3,
            isBonus: true
          },
          {
            id: "daily_win_1_war",
            name: "Win 1 WAR",
            rewardTokens: 2,
            rewardXp: 5,
            completed: false,
            progress: 0,
            goal: 1
          }
        ]
      },
      weekly: {
        resetLabel: "2d 03:00",
        challenges: []
      }
    },
    actions: {}
  });

  assert.ok(html.indexOf("Complete 3 Matches Without Quitting") < html.indexOf("Play 5 Matches"));
});

test("ui: menu challenge preview prioritizes incomplete bonus quests above completed ordinary challenges", () => {
  const html = menuScreen.render({
    username: "PriorityUser",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Next Daily Login Reward: 05:00",
        resetLabel: "05:00"
      },
      daily: {
        resetLabel: "01:00",
        challenges: [
          {
            id: "daily_play_5_matches",
            name: "Play 5 Matches",
            rewardTokens: 3,
            rewardXp: 6,
            completed: true,
            progress: 5,
            goal: 5
          },
          {
            id: "daily_no_quit_3",
            name: "Complete 3 Matches Without Quitting",
            rewardTokens: 3,
            rewardXp: 6,
            completed: false,
            progress: 0,
            goal: 3,
            isBonus: true
          }
        ]
      },
      weekly: {
        resetLabel: "2d 03:00",
        challenges: []
      }
    },
    actions: {}
  });

  assert.ok(html.indexOf("Complete 3 Matches Without Quitting") < html.indexOf("Play 5 Matches"));
});

test("ui: menu challenge preview prioritizes near-complete quests within the same tier", () => {
  const html = menuScreen.render({
    username: "PriorityUser",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Next Daily Login Reward: 05:00",
        resetLabel: "05:00"
      },
      daily: {
        resetLabel: "01:00",
        challenges: [
          {
            id: "daily_play_5_matches",
            name: "Play 5 Matches",
            rewardTokens: 3,
            rewardXp: 6,
            completed: false,
            progress: 4,
            goal: 5
          },
          {
            id: "daily_capture_16_cards",
            name: "Capture 16 Cards Total In One Day",
            rewardTokens: 3,
            rewardXp: 6,
            completed: false,
            progress: 6,
            goal: 16
          },
          {
            id: "daily_win_1_war",
            name: "Win 1 WAR",
            rewardTokens: 2,
            rewardXp: 5,
            completed: false,
            progress: 0,
            goal: 1
          }
        ]
      },
      weekly: {
        resetLabel: "2d 03:00",
        challenges: []
      }
    },
    actions: {}
  });

  assert.ok(html.indexOf("Play 5 Matches") < html.indexOf("Capture 16 Cards Total In One Day"));
});

test("ui: menu challenge preview still renders safely without bonus metadata", () => {
  const html = menuScreen.render({
    username: "PriorityUser",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Next Daily Login Reward: 05:00",
        resetLabel: "05:00"
      },
      daily: {
        resetLabel: "01:00",
        challenges: [
          { id: "daily_play_5_matches", name: "Play 5 Matches", rewardTokens: 3, rewardXp: 6, completed: false, progress: 0, goal: 5 },
          { id: "daily_win_1_match", name: "Win 1 Match", rewardTokens: 2, rewardXp: 5, completed: false, progress: 0, goal: 1 },
          { id: "daily_win_1_war", name: "Win 1 WAR", rewardTokens: 2, rewardXp: 5, completed: false, progress: 0, goal: 1 }
        ]
      },
      weekly: {
        resetLabel: "2d 03:00",
        challenges: []
      }
    },
    actions: {}
  });

  assert.match(html, /Play 5 Matches/);
  assert.match(html, /Win 1 Match/);
  assert.match(html, /Win 1 WAR/);
});

test("ui: menu challenge preview uses completed entries only to backfill when fewer than three incomplete entries exist", () => {
  const html = menuScreen.render({
    username: "PriorityUser",
    backgroundImage: "assets/EleMintzIcon.png",
    dailyChallenges: {
      dailyLogin: {
        stateLabel: "Next Daily Login Reward: 05:00",
        resetLabel: "05:00"
      },
      daily: {
        resetLabel: "01:00",
        challenges: [
          {
            id: "daily_play_5_matches",
            name: "Play 5 Matches",
            rewardTokens: 3,
            rewardXp: 6,
            completed: false,
            progress: 2,
            goal: 5
          },
          {
            id: "daily_win_1_match",
            name: "Win 1 Match",
            rewardTokens: 2,
            rewardXp: 5,
            completed: false,
            progress: 0,
            goal: 1
          },
          {
            id: "daily_win_1_war",
            name: "Win 1 WAR",
            rewardTokens: 2,
            rewardXp: 5,
            completed: true,
            progress: 1,
            goal: 1
          },
          {
            id: "daily_capture_16_cards",
            name: "Capture 16 Cards Total In One Day",
            rewardTokens: 3,
            rewardXp: 6,
            completed: true,
            progress: 16,
            goal: 16
          }
        ]
      },
      weekly: {
        resetLabel: "2d 03:00",
        challenges: []
      }
    },
    actions: {}
  });

  assert.match(html, /Play 5 Matches/);
  assert.match(html, /Win 1 Match/);
  assert.ok(
    /Win 1 WAR/.test(html) || /Capture 16 Cards Total In One Day/.test(html),
    "expected one completed challenge to backfill the third preview slot"
  );
  assert.ok(
    !(/Win 1 WAR/.test(html) && /Capture 16 Cards Total In One Day/.test(html)),
    "expected only one completed challenge to appear in the preview"
  );
  const completedIndex = /Win 1 WAR/.test(html)
    ? html.indexOf("Win 1 WAR")
    : html.indexOf("Capture 16 Cards Total In One Day");
  assert.ok(html.indexOf("Win 1 Match") < completedIndex);
});

test("ui: later PvE WAR states render the shared WAR impact marker", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "Hero", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "Elemental AI", title: "Arena Rival", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "AI" },
    presentation: { phase: "result", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/customFire.jpg", water: "assets/customWater.jpg", earth: "assets/customEarth.jpg", wind: "assets/customWind.jpg" },
      p2: { fire: "assets/oppFire.jpg", water: "assets/oppWater.jpg", earth: "assets/oppEarth.jpg", wind: "assets/oppWind.jpg" }
    },
    game: {
      roundOutcome: { key: "war_triggered", label: "WAR triggered" },
      roundResult: "WAR triggered.",
      round: 2,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      mode: "pve",
      warActive: true,
      playerHand: [],
      opponentHand: [],
      pileCount: 4,
      totalWarClashes: 2,
      warPileCards: ["fire", "earth", "water", "wind"],
      captured: { p1: 0, p2: 0 },
      lastRound: { p1Card: "fire", p2Card: "fire" }
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /assets\/customFire\.jpg/);
  assert.match(html, /WAR Fire x1/);
  assert.match(html, /WAR Earth x1/);
  assert.match(html, /WAR Wind x1/);
  assert.match(html, /WAR Water x1/);
  assert.match(html, /class="war-slot-count-badge">x1<\/span>/);
  assert.match(html, /match-status-panel war-triggered[\s\S]*war-impact/);
  assert.match(html, /class="war-impact-ring"/);
});

test("ui: later local PvP WAR states also render shared WAR impact without breaking anti-peek behavior", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "P1", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "P2", title: "Initiate", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: true, activePlayer: "p2", turnLabel: "P2 Turn", p1Name: "P1", p2Name: "P2" },
    presentation: { phase: "reveal", busy: true, selectedCardIndex: null },
    cardBacks: { p1: "assets/cards/customP1Back.jpg", p2: "assets/cards/customP2Back.jpg" },
    game: {
      roundOutcome: { key: "war_triggered", label: "WAR!" },
      roundResult: "WAR triggered!",
      round: 4,
      timerSeconds: 18,
      totalMatchSeconds: 260,
      canSelectCard: false,
      mode: "local_pvp",
      warActive: true,
      playerHand: ["fire", "water"],
      opponentHand: ["earth", "wind"],
      pileCount: 4,
      totalWarClashes: 2,
      warPileCards: ["fire", "earth", "wind", "water"],
      captured: { p1: 0, p2: 0 },
      lastRound: { result: "war", p1Card: "fire", p2Card: "fire" }
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /match-status-panel war-triggered[\s\S]*war-impact/);
  assert.match(html, /class="war-impact-ring"/);
  assert.match(html, /played-row compact-played-row[\s\S]*played-row-hotseat-hidden/);
  assert.match(html, /played-slot is-facedown/);
  assert.doesNotMatch(html, /clash-winner-fire/);
});

test("ui: first visible local PvP WAR uses warActive to render the shared WAR impact marker", () => {
  const html = gameScreen.render({
    reducedMotion: false,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "P1", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "P2", title: "Initiate", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: true, activePlayer: "p1", turnLabel: "P1 Turn", p1Name: "P1", p2Name: "P2" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardBacks: { p1: "assets/cards/customP1Back.jpg", p2: "assets/cards/customP2Back.jpg" },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "WAR triggered!",
      round: 1,
      timerSeconds: 23,
      totalMatchSeconds: 300,
      canSelectCard: false,
      mode: "local_pvp",
      warActive: true,
      playerHand: ["fire", "water", "earth", "wind", "fire", "water", "earth"],
      opponentHand: ["fire", "water", "earth", "wind", "fire", "water", "earth"],
      pileCount: 2,
      totalWarClashes: 1,
      warPileCards: ["fire", "fire"],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /match-status-panel war-triggered[\s\S]*war-impact/);
  assert.match(html, /class="war-impact-ring"/);
  assert.match(html, /data-round-center-headline="true">WAR</);
  assert.match(html, /WAR status: 2 cards in the pile across 1 clash\./);
});

test("ui: bind arms WAR impact on the first PvE WAR render", () => {
  const backButton = createFakeElement();
  const warImpactRing = createFakeElement();
  const previousDocument = global.document;
  const previousRaf = global.requestAnimationFrame;

  global.document = {
    getElementById(id) {
      return {
        "back-menu-btn": backButton,
        "war-impact-ring": warImpactRing
      }[id] ?? null;
    },
    querySelectorAll() {
      return [];
    }
  };
  global.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };

  try {
    gameScreen.bind({
    game: {
      warActive: true,
      roundOutcome: { key: "war_triggered", label: "WAR!" }
    },
      actions: {
        backToMenu: () => {},
        playCard: async () => {}
      }
    });

    assert.equal(warImpactRing.classList.contains("is-active"), true);
  } finally {
    global.document = previousDocument;
    global.requestAnimationFrame = previousRaf;
  }
});

test("ui: appController randomizes enabled cosmetic categories after a completed match using the shared owned-cosmetics path", async () => {
  const previousWindow = global.window;
  const randomizeCalls = [];
  const app = createRendererController();
  const profile = {
    username: "Hero",
    cosmeticRandomizeAfterMatch: {
      avatar: true,
      title: false,
      badge: false,
      elementCardVariant: false,
      cardBack: false,
      background: true
    },
    equippedCosmetics: {
      avatar: "default_avatar",
      background: "fire_background"
    }
  };

  global.window = {
    elemintz: {
      state: {
        randomizeOwnedCosmetics: async (payload) => {
          randomizeCalls.push(payload);
          return {
            profile: {
              ...profile,
              equippedCosmetics: {
                ...profile.equippedCosmetics,
                avatar: "fire_avatar_f",
                background: "water_background"
              }
            }
          };
        }
      }
    }
  };

  try {
    const updated = await app.maybeRandomizeCosmeticsAfterMatchFor("Hero", profile);

    assert.deepEqual(randomizeCalls, [
      {
        username: "Hero",
        categories: ["avatar", "background"]
      }
    ]);
    assert.equal(updated.equippedCosmetics.avatar, "fire_avatar_f");
    assert.equal(updated.equippedCosmetics.background, "water_background");
  } finally {
    global.window = previousWindow;
  }
});

test("ui: game screen taunt controls use stable button targets and send immediately", async () => {
  const previousDocument = global.document;
  const backButton = createFakeElement();
  const tauntToggleButton = createFakeElement();
  const tauntOptionButton = {
    listeners: new Map(),
    getAttribute: (name) => (name === "data-taunt-line" ? "Bold choice." : null),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
  };
  const calls = {
    toggle: 0,
    send: []
  };

  global.document = {
    getElementById(id) {
      return {
        "back-menu-btn": backButton,
        "game-taunts-toggle-btn": tauntToggleButton
      }[id] ?? null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-taunt-line]") {
        return [tauntOptionButton];
      }

      return [];
    }
  };

  try {
    gameScreen.bind({
      game: { roundOutcome: { key: "no_effect" }, warActive: false },
      hotseat: { enabled: false },
      presentation: { busy: false },
      actions: {
        backToMenu: async () => {},
        playCard: async () => {},
        toggleTauntsPanel: async () => {
          calls.toggle += 1;
        },
        sendTaunt: async (line) => {
          calls.send.push(line);
        }
      }
    });

    await tauntToggleButton.listeners.get("click")();
    await tauntOptionButton.listeners.get("click")();

    assert.equal(calls.toggle, 1);
    assert.deepEqual(calls.send, ["Bold choice."]);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: appController applies post-match cosmetic randomization to both local PvP players through the shared category path", async () => {
  const app = createRendererController();
  const calls = [];
  app.getLocalNames = () => ({ p1: "Alpha", p2: "Beta" });
  app.localProfiles = {
    p1: { username: "Alpha", cosmeticRandomizeAfterMatch: { avatar: true } },
    p2: { username: "Beta", cosmeticRandomizeAfterMatch: { background: true } }
  };
  app.maybeRandomizeCosmeticsAfterMatchFor = async (username, profile) => {
    calls.push({ username, profile });
    return {
      ...profile,
      randomizedFor: username
    };
  };

  await app.applyPostMatchCosmeticRandomization(MATCH_MODE.LOCAL_PVP, {
    p1: { profile: app.localProfiles.p1 },
    p2: { profile: app.localProfiles.p2 }
  });

  assert.deepEqual(calls.map((entry) => entry.username), ["Alpha", "Beta"]);
  assert.equal(app.localProfiles.p1.randomizedFor, "Alpha");
  assert.equal(app.localProfiles.p2.randomizedFor, "Beta");
});

test("ui: appController applies post-match cosmetic randomization to the active PvE profile through the shared category path", async () => {
  const app = createRendererController();
  const latestProfile = {
    username: "SoloHero",
    cosmeticRandomizeAfterMatch: {
      avatar: false,
      title: false,
      badge: false,
      elementCardVariant: false,
      cardBack: false,
      background: true
    }
  };
  const calls = [];
  app.username = "SoloHero";
  app.profile = latestProfile;
  app.maybeRandomizeCosmeticsAfterMatchFor = async (username, profile) => {
    calls.push({ username, profile });
    return {
      ...profile,
      randomized: true
    };
  };

  await app.applyPostMatchCosmeticRandomization(MATCH_MODE.PVE, {
    profile: latestProfile
  });

  assert.deepEqual(calls, [{ username: "SoloHero", profile: latestProfile }]);
  assert.equal(app.profile.randomized, true);
});

test("ui: appController local PvP taunts use the active hotseat speaker", async () => {
  const app = createRendererController();
  let showCalls = 0;
  app.showGame = () => {
    showCalls += 1;
  };
  app.localPlayers = { p1: "Alpha", p2: "Beta" };
  app.gameController = {
    getViewModel: () => ({
      mode: MATCH_MODE.LOCAL_PVP,
      hotseatTurn: "p2"
    })
  };

  await app.sendCurrentMatchTaunt("Bold choice.");

  assert.equal(showCalls, 1);
  assert.equal(app.matchTaunts.at(-1).speaker, "Beta");
  assert.equal(app.matchTaunts.at(-1).text, "Bold choice.");
  assert.equal(app.matchTauntPanelOpen, false);
});

test("ui: appController taunt messages expire individually after the visible lifetime and fade window", () => {
  const app = createRendererController();
  let now = 1000;
  app.getTauntNow = () => now;

  app.appendMatchTaunt({ speaker: "Hero", text: "Your move.", kind: "player" });
  now = 21100;
  assert.equal(app.getRenderableMatchTaunts()[0].isFading, true);

  app.appendMatchTaunt({ speaker: "Hero", text: "Interesting.", kind: "player" });
  now = 21350;
  const stillVisible = app.getRenderableMatchTaunts();
  assert.equal(stillVisible.length, 2);
  assert.equal(stillVisible[0].text, "Your move.");
  assert.equal(stillVisible[1].text, "Interesting.");

  now = 21700;
  app.pruneExpiredLocalMatchTaunts();
  const remaining = app.getRenderableMatchTaunts();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].text, "Interesting.");
});

test("ui: appController PVE player taunts enforce the 12 second cooldown", async () => {
  const app = createRendererController();
  let now = 1000;
  let showCalls = 0;
  app.username = "Hero";
  app.profile = { username: "Hero" };
  app.getTauntNow = () => now;
  app.screenFlow = "game";
  app.showGame = () => {
    showCalls += 1;
  };
  app.gameController = {
    getViewModel: () => ({
      mode: MATCH_MODE.PVE
    })
  };

  await app.sendCurrentMatchTaunt("Bold choice.");
  assert.equal(app.matchTaunts.length, 1);

  now = 7000;
  await app.sendCurrentMatchTaunt("Well played.");
  assert.equal(app.matchTaunts.length, 1);
  assert.equal(app.getCurrentTauntHudState().canSend, false);

  now = 13050;
  await app.sendCurrentMatchTaunt("Well played.");
  assert.equal(app.matchTaunts.length, 2);
  assert.equal(app.matchTaunts.at(-1).text, "Well played.");
  assert.equal(showCalls, 3);
});

test("ui: appController local PvP taunt cooldown applies per active side", async () => {
  const app = createRendererController();
  let now = 1000;
  app.getTauntNow = () => now;
  app.showGame = () => {};
  app.localPlayers = { p1: "Alpha", p2: "Beta" };
  let hotseatTurn = "p1";
  app.gameController = {
    getViewModel: () => ({
      mode: MATCH_MODE.LOCAL_PVP,
      hotseatTurn
    })
  };

  await app.sendCurrentMatchTaunt("Bold choice.");
  now = 5000;
  await app.sendCurrentMatchTaunt("Well played.");
  assert.equal(app.matchTaunts.length, 1);

  hotseatTurn = "p2";
  await app.sendCurrentMatchTaunt("Interesting.");
  assert.equal(app.matchTaunts.length, 2);
  assert.equal(app.matchTaunts.at(-1).speaker, "Beta");
});

test("ui: appController PVE AI taunts respect cooldown and avoid consecutive event spam", () => {
  const app = createRendererController();
  app.gameController = {
    getViewModel: () => ({
      mode: MATCH_MODE.PVE,
      opponentHand: ["fire", "water"]
    })
  };
  app.showGame = () => {};
  app.screenFlow = "game";
  app.opponentDisplayName = "Elemental AI";
  app.tauntRandom = () => 0;
  app.getTauntNow = () => 1000;

  assert.equal(app.maybeEmitPveAiTaunt("match_start"), true);
  assert.equal(app.matchTaunts.length, 1);
  assert.equal(app.maybeEmitPveAiTaunt("match_start"), false);
  assert.equal(app.maybeEmitPveAiTaunt("war_start"), false);

  app.getTauntNow = () => 40000;
  assert.equal(app.maybeEmitPveAiTaunt("war_start"), true);
  assert.equal(app.matchTaunts.length, 2);
});

test("ui: appController online taunt action routes through multiplayer state and rerenders the feed", async () => {
  const previousWindow = global.window;
  const shown = [];
  const sendTauntCalls = [];
  let now = 1000;
  global.window = {
    elemintz: {
      multiplayer: {
        sendTaunt: async (payload) => {
          sendTauntCalls.push(payload);
          return {
            connectionStatus: "connected",
            socketId: "host-1",
            room: {
              roomCode: "ABC123",
              status: "full",
              matchComplete: false,
              host: { socketId: "host-1", username: "Hero" },
              guest: { socketId: "guest-1", username: "Rival" },
              hostHand: { fire: 2, earth: 2, wind: 2, water: 2 },
              guestHand: { fire: 2, earth: 2, wind: 2, water: 2 },
              warPot: { host: [], guest: [] },
              warRounds: [],
              roundHistory: [],
              moveSync: { hostSubmitted: false, guestSubmitted: false, submittedCount: 0, bothSubmitted: false, updatedAt: null },
              taunts: [
                {
                  id: "taunt-1",
                  senderRole: "host",
                  senderName: "Hero",
                  speaker: "Hero",
                  text: payload.line,
                  kind: "player",
                  sentAt: "2026-03-22T00:00:00.000Z"
                }
              ]
            },
            latestRoundResult: null,
            lastError: null,
            statusMessage: "Room ABC123 is full."
          };
        }
      }
    }
  };

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { show: () => {} }
  });

  try {
    controller.username = "Hero";
    controller.getTauntNow = () => now;
    controller.profile = { username: "Hero", equippedCosmetics: { background: "default_background" } };
    controller.onlinePlayState = {
      connectionStatus: "connected",
      socketId: "host-1",
      room: {
        roomCode: "ABC123",
        status: "full",
        matchComplete: false,
        host: { socketId: "host-1", username: "Hero" },
        guest: { socketId: "guest-1", username: "Rival" },
        hostHand: { fire: 2, earth: 2, wind: 2, water: 2 },
        guestHand: { fire: 2, earth: 2, wind: 2, water: 2 },
        warPot: { host: [], guest: [] },
        warRounds: [],
        roundHistory: [],
        moveSync: { hostSubmitted: false, guestSubmitted: false, submittedCount: 0, bothSubmitted: false, updatedAt: null },
        taunts: []
      }
    };

    controller.renderOnlinePlayScreen();
    await shown.at(-1).actions.sendTaunt("Your move.");
    assert.deepEqual(sendTauntCalls, [{ line: "Your move." }]);
    await shown.at(-1).actions.sendTaunt("Well played.");
    assert.deepEqual(sendTauntCalls, [{ line: "Your move." }]);
    now = 13100;
    await shown.at(-1).actions.sendTaunt("Well played.");

    assert.deepEqual(sendTauntCalls, [{ line: "Your move." }, { line: "Well played." }]);
    assert.equal(shown.at(-1).taunts.messages.at(-1).text, "Well played.");
    assert.equal(shown.at(-1).taunts.messages.at(-1).speaker, "Hero");
    assert.equal(shown.at(-1).taunts.canSend, false);
  } finally {
    global.window = previousWindow;
  }
});

test("ui: bind defers local PvP WAR impact during hidden busy transitions", () => {
  const backButton = createFakeElement();
  const warImpactRing = createFakeElement();
  const previousDocument = global.document;
  const previousRaf = global.requestAnimationFrame;
  let rafCalls = 0;

  global.document = {
    getElementById(id) {
      return {
        "back-menu-btn": backButton,
        "war-impact-ring": warImpactRing
      }[id] ?? null;
    },
    querySelectorAll() {
      return [];
    }
  };
  global.requestAnimationFrame = (callback) => {
    rafCalls += 1;
    callback();
    return 1;
  };

  try {
    gameScreen.bind({
      hotseat: { enabled: true, activePlayer: "p2" },
      presentation: { busy: true },
    game: {
      mode: "local_pvp",
      round: 11,
      totalWarClashes: 1,
      pileCount: 2,
      lastRound: { result: "war", p1Card: "fire", p2Card: "fire" },
      warActive: true,
      roundOutcome: { key: "no_effect", label: "No effect" }
    },
      actions: {
        backToMenu: () => {},
        playCard: async () => {}
      }
    });

    assert.equal(rafCalls, 0);
    assert.equal(warImpactRing.classList.contains("is-active"), false);
  } finally {
    global.document = previousDocument;
    global.requestAnimationFrame = previousRaf;
  }
});

test("ui: bind arms WAR impact on the first visible local PvP WAR render", () => {
  const backButton = createFakeElement();
  const warImpactRing = createFakeElement();
  const previousDocument = global.document;
  const previousRaf = global.requestAnimationFrame;
  let rafCalls = 0;

  global.document = {
    getElementById(id) {
      return {
        "back-menu-btn": backButton,
        "war-impact-ring": warImpactRing
      }[id] ?? null;
    },
    querySelectorAll() {
      return [];
    }
  };
  global.requestAnimationFrame = (callback) => {
    rafCalls += 1;
    callback();
    return 1;
  };

  try {
    gameScreen.bind({
      hotseat: { enabled: true, activePlayer: "p2" },
      presentation: { busy: false },
    game: {
      mode: "local_pvp",
      round: 12,
      totalWarClashes: 1,
      pileCount: 2,
      lastRound: { result: "war", p1Card: "earth", p2Card: "earth" },
      warActive: true,
      roundOutcome: { key: "no_effect", label: "No effect" }
    },
      actions: {
        backToMenu: () => {},
        playCard: async () => {}
      }
    });

    assert.equal(rafCalls, 2);
    assert.equal(warImpactRing.classList.contains("is-active"), true);
  } finally {
    global.document = previousDocument;
    global.requestAnimationFrame = previousRaf;
  }
});

test("ui: first visible local PvP WAR consumes a pending hidden-stage flash trigger", () => {
  const backButton = createFakeElement();
  const hiddenRing = createFakeElement();
  const visibleRing = createFakeElement();
  const previousDocument = global.document;
  const previousRaf = global.requestAnimationFrame;
  let currentRing = hiddenRing;
  let rafCalls = 0;

  global.document = {
    getElementById(id) {
      return {
        "back-menu-btn": backButton,
        "war-impact-ring": currentRing
      }[id] ?? null;
    },
    querySelectorAll() {
      return [];
    }
  };
  global.requestAnimationFrame = (callback) => {
    rafCalls += 1;
    callback();
    return 1;
  };

  try {
    gameScreen.bind({
      hotseat: { enabled: true, activePlayer: "p2" },
      presentation: { busy: true },
      game: {
        mode: "local_pvp",
        round: 1,
        warActive: true,
        totalWarClashes: 1,
        pileCount: 2,
        lastRound: { result: "war", p1Card: "fire", p2Card: "fire" },
        roundOutcome: { key: "no_effect", label: "No effect" }
      },
      actions: {
        backToMenu: () => {},
        playCard: async () => {}
      }
    });

    assert.equal(hiddenRing.classList.contains("is-active"), false);

    currentRing = visibleRing;

    gameScreen.bind({
      hotseat: { enabled: true, activePlayer: "p2" },
      presentation: { busy: false },
      game: {
        mode: "local_pvp",
        round: 1,
        warActive: true,
        totalWarClashes: 1,
        pileCount: 2,
        lastRound: { result: "war", p1Card: "fire", p2Card: "fire" },
        roundOutcome: { key: "no_effect", label: "No effect" }
      },
      actions: {
        backToMenu: () => {},
        playCard: async () => {}
      }
    });

    assert.equal(rafCalls, 2);
    assert.equal(visibleRing.classList.contains("is-active"), true);
  } finally {
    global.document = previousDocument;
    global.requestAnimationFrame = previousRaf;
  }
});

test("ui: bind arms WAR impact on later visible local PvP WAR renders too", () => {
  const backButton = createFakeElement();
  const warImpactRing = createFakeElement();
  const previousDocument = global.document;
  const previousRaf = global.requestAnimationFrame;
  let rafCalls = 0;

  global.document = {
    getElementById(id) {
      return {
        "back-menu-btn": backButton,
        "war-impact-ring": warImpactRing
      }[id] ?? null;
    },
    querySelectorAll() {
      return [];
    }
  };
  global.requestAnimationFrame = (callback) => {
    rafCalls += 1;
    callback();
    return 1;
  };

  try {
    gameScreen.bind({
      hotseat: { enabled: true, activePlayer: "p1" },
      presentation: { busy: false },
    game: {
      mode: "local_pvp",
      round: 6,
      totalWarClashes: 3,
      pileCount: 6,
      lastRound: { result: "war", p1Card: "water", p2Card: "water" },
      warActive: true,
      roundOutcome: { key: "no_effect", label: "No effect" }
    },
      actions: {
        backToMenu: () => {},
        playCard: async () => {}
      }
    });

    assert.equal(rafCalls, 2);
    assert.equal(warImpactRing.classList.contains("is-active"), true);
  } finally {
    global.document = previousDocument;
    global.requestAnimationFrame = previousRaf;
  }
});

test("ui: hidden hand remains hidden while WAR pile is face-up", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "P1", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "P2", title: "Initiate", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: true, activePlayer: "p1", turnLabel: "P1 Turn", p1Name: "P1", p2Name: "P2" },
    presentation: { phase: "result", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/customFire.jpg", water: "assets/customWater.jpg", earth: "assets/customEarth.jpg", wind: "assets/customWind.jpg" },
      p2: { fire: "assets/oppFire.jpg", water: "assets/oppWater.jpg", earth: "assets/oppEarth.jpg", wind: "assets/oppWind.jpg" }
    },
    cardBacks: { p1: "assets/cards/customP1Back.jpg", p2: "assets/cards/customP2Back.jpg" },
    game: {
      roundOutcome: { key: "war_triggered", label: "WAR triggered" },
      roundResult: "WAR triggered.",
      round: 3,
      timerSeconds: 18,
      totalMatchSeconds: 280,
      canSelectCard: true,
      mode: "local_pvp",
      playerHand: ["fire"],
      opponentHand: ["earth", "water"],
      pileCount: 2,
      totalWarClashes: 1,
      warPileCards: ["fire", "earth"],
      captured: { p1: 0, p2: 0 },
      lastRound: { p1Card: "fire", p2Card: "fire" }
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /assets\/cards\/customP2Back\.jpg/);
  assert.match(html, /assets\/customFire\.jpg/);
  assert.match(html, /Hidden opponent hand: 2 cards/);
  assert.doesNotMatch(html, /class="card-rail"/);
  assert.match(html, /Captured totals: P1 0 \| P2 0/);
  assert.doesNotMatch(html, /Captured: Player 1 • 0 \| Player 2 • 0/);
});

test("ui: PvE reveal path keeps stable cards while retaining clash and result emphasis", () => {
  const html = gameScreen.render({
    reducedMotion: false,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "Hero", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "Elemental AI", title: "Arena Rival", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "Elemental AI" },
    presentation: { phase: "reveal", busy: true, selectedCardIndex: 0 },
    cardImages: {
      p1: { fire: "assets/customFire.jpg", water: "assets/customWater.jpg", earth: "assets/customEarth.jpg", wind: "assets/customWind.jpg" },
      p2: { fire: "assets/oppFire.jpg", water: "assets/oppWater.jpg", earth: "assets/oppEarth.jpg", wind: "assets/oppWind.jpg" }
    },
    cardBacks: { p1: "assets/cards/customP1Back.jpg", p2: "assets/cards/customP2Back.jpg" },
    game: {
      roundOutcome: { key: "player_win", label: "Player wins" },
      roundResult: "Player wins.",
      round: 3,
      timerSeconds: 18,
      totalMatchSeconds: 280,
      canSelectCard: false,
      mode: "pve",
      playerHand: ["fire", "earth"],
      opponentHand: ["water", "wind"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 1, p2: 0 },
      lastRound: { result: "p1", p1Card: "fire", p2Card: "earth" }
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /played-row compact-played-row/);
  assert.match(html, /data-round-center-result="true"/);
  assert.match(html, /data-round-center-headline="true">FIRE BEATS EARTH</);
  assert.match(html, /Resolving clash\.\.\./);
  assert.match(html, /assets\/customFire\.jpg/);
  assert.match(html, /assets\/oppEarth\.jpg/);
  assert.doesNotMatch(html, /played-row-pve-reveal/);
  assert.match(html, /match-status-panel player-win clash-winner-fire/);
  assert.match(html, /Round update: Captured totals are now Hero 1 and Elemental AI 0\./);
});

test("ui: local PvE center result persists the last completed round during the next card selection state", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "Hero", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "Elemental AI", title: "Arena Rival", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "Elemental AI" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/customFire.jpg", water: "assets/customWater.jpg", earth: "assets/customEarth.jpg", wind: "assets/customWind.jpg" },
      p2: { fire: "assets/oppFire.jpg", water: "assets/oppWater.jpg", earth: "assets/oppEarth.jpg", wind: "assets/oppWind.jpg" }
    },
    cardBacks: { p1: "assets/cards/customP1Back.jpg", p2: "assets/cards/customP2Back.jpg" },
    game: {
      roundOutcome: { key: "player_win", label: "Player wins" },
      roundResult: "Choose a card to begin the next clash.",
      round: 4,
      timerSeconds: 18,
      totalMatchSeconds: 270,
      canSelectCard: true,
      mode: "pve",
      playerHand: ["water", "earth"],
      opponentHand: ["wind", "water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 1, p2: 0 },
      lastRound: { result: "p1", p1Card: "fire", p2Card: "earth" }
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /data-round-center-result="true"/);
  assert.match(html, /data-round-center-headline="true">FIRE BEATS EARTH</);
  assert.match(html, /assets\/customFire\.jpg/);
  assert.match(html, /assets\/oppEarth\.jpg/);
  assert.doesNotMatch(html, /Player: -/);
  assert.doesNotMatch(html, /Opponent: -/);
  assert.match(html, /Round update: Captured totals are now Hero 1 and Elemental AI 0\./);
});

test("ui: local PvE does not render a fake center result before the first real round", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "Hero", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "Elemental AI", title: "Arena Rival", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "Elemental AI" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: { p1: null, p2: null },
    cardBacks: { p1: "assets/cards/customP1Back.jpg", p2: "assets/cards/customP2Back.jpg" },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "Choose a card to begin the next clash.",
      round: 1,
      timerSeconds: 20,
      totalMatchSeconds: 300,
      canSelectCard: true,
      mode: "pve",
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.doesNotMatch(html, /data-round-center-result="true"/);
  assert.doesNotMatch(html, /data-round-center-headline="true"/);
  assert.doesNotMatch(html, /Player: -/);
  assert.doesNotMatch(html, /Opponent: -/);
  assert.match(html, /Round update: Captured totals are now Hero 0 and Elemental AI 0\./);
  assert.match(html, /WAR status: No active WAR pile\./);
});

test("ui: local PvP reveal path stays hidden-safe and does not add PvE clash feedback", () => {
  const html = gameScreen.render({
    reducedMotion: false,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "P1", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "P2", title: "Initiate", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: true, activePlayer: "p2", turnLabel: "P2 Turn", p1Name: "P1", p2Name: "P2" },
    presentation: { phase: "reveal", busy: true, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/customFire.jpg", water: "assets/customWater.jpg", earth: "assets/customEarth.jpg", wind: "assets/customWind.jpg" },
      p2: { fire: "assets/oppFire.jpg", water: "assets/oppWater.jpg", earth: "assets/oppEarth.jpg", wind: "assets/oppWind.jpg" }
    },
    cardBacks: { p1: "assets/cards/customP1Back.jpg", p2: "assets/cards/customP2Back.jpg" },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 4,
      timerSeconds: 18,
      totalMatchSeconds: 260,
      canSelectCard: false,
      mode: "local_pvp",
      playerHand: ["fire", "water"],
      opponentHand: ["earth", "wind"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: { result: "p1", p1Card: "fire", p2Card: "earth" }
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /played-row compact-played-row[\s\S]*played-row-hotseat-hidden/);
  assert.match(html, /data-round-center-result="true"/);
  assert.match(html, /data-round-center-headline="true">NO EFFECT</);
  assert.match(html, /played-slot is-facedown/);
  assert.match(html, /assets\/cards\/customP1Back\.jpg/);
  assert.match(html, /assets\/cards\/customP2Back\.jpg/);
  assert.doesNotMatch(html, /played-row-pve-reveal/);
  assert.doesNotMatch(html, /clash-winner-fire/);
});

test("ui: Easy AI result center falls back to default element art when no variants are equipped", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "Hero", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "Elemental AI", title: "Arena Rival", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "Elemental AI" },
    presentation: { phase: "result", busy: false, selectedCardIndex: null },
    cardImages: { p1: null, p2: null },
    game: {
      roundOutcome: { key: "player_win", label: "Player wins" },
      roundResult: "Player wins.",
      round: 5,
      timerSeconds: 20,
      totalMatchSeconds: 220,
      canSelectCard: true,
      mode: "pve",
      playerHand: ["fire"],
      opponentHand: ["earth"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 2, p2: 0 },
      lastRound: { result: "p1", p1Card: "fire", p2Card: "earth" }
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /data-round-center-result="true"/);
  assert.match(html, /data-round-center-headline="true">FIRE BEATS EARTH</);
  assert.match(html, /assets\/cards\/fire\.jpg/);
  assert.match(html, /assets\/cards\/earth\.jpg/);
});

test("ui: Gauntlet and Featured Rival matches render the shared center result block", () => {
  const gauntletHtml = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "Hero", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "Stone March", title: "Mountain Step", avatar: "assets/gauntlet/avatars/avatar_gauntlet_stone_march.png" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "Stone March" },
    presentation: { phase: "result", busy: false, selectedCardIndex: null },
    gauntlet: { active: true, currentStreak: 3, rivalName: "Stone March", rivalTitle: "Mountain Step" },
    cardImages: {
      p1: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" },
      p2: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" }
    },
    game: {
      roundOutcome: { key: "player_win", label: "Player wins" },
      roundResult: "Player wins.",
      round: 2,
      timerSeconds: 20,
      totalMatchSeconds: 260,
      canSelectCard: true,
      mode: "pve",
      playerHand: ["fire"],
      opponentHand: ["earth"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 1, p2: 0 },
      lastRound: { result: "p1", p1Card: "fire", p2Card: "earth" }
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });
  const featuredHtml = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "Hero", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "Crownfire Duelist", title: "Inferno Regent", avatar: "assets/rivals/Crownfire/rival_crownfire_duelist_avatar.png" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "Crownfire Duelist" },
    presentation: { phase: "result", busy: false, selectedCardIndex: null },
    gauntlet: null,
    cardImages: {
      p1: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" },
      p2: { fire: "assets/cards/fire.jpg", water: "assets/cards/water.jpg", earth: "assets/cards/earth.jpg", wind: "assets/cards/wind.jpg" }
    },
    game: {
      roundOutcome: { key: "opponent_win", label: "Opponent wins" },
      roundResult: "Opponent wins.",
      round: 2,
      timerSeconds: 20,
      totalMatchSeconds: 260,
      canSelectCard: true,
      mode: "pve",
      playerHand: ["water"],
      opponentHand: ["wind"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 1 },
      lastRound: { result: "p2", p1Card: "water", p2Card: "wind" }
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(gauntletHtml, /data-round-center-result="true"/);
  assert.match(gauntletHtml, /data-round-center-headline="true">FIRE BEATS EARTH</);
  assert.match(featuredHtml, /data-round-center-result="true"/);
  assert.match(featuredHtml, /data-round-center-headline="true">WIND BEATS WATER</);
});

test("ui: local PvP opposing side remains a compact hidden-hand summary during Player 2 turns", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "P1", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "P2", title: "Initiate", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: true, activePlayer: "p2", turnLabel: "P2 Turn", p1Name: "P1", p2Name: "P2" },
    presentation: { phase: "idle", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/customFire.jpg", water: "assets/customWater.jpg", earth: "assets/customEarth.jpg", wind: "assets/customWind.jpg" },
      p2: { fire: "assets/oppFire.jpg", water: "assets/oppWater.jpg", earth: "assets/oppEarth.jpg", wind: "assets/oppWind.jpg" }
    },
    cardBacks: { p1: "assets/cards/customP1Back.jpg", p2: "assets/cards/customP2Back.jpg" },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 4,
      timerSeconds: 18,
      totalMatchSeconds: 260,
      canSelectCard: true,
      mode: "local_pvp",
      playerHand: ["fire", "water", "earth", "wind"],
      opponentHand: ["fire", "fire", "earth", "water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /P2 \(4\)/);
  assert.match(html, /P1 \(4\)/);
  assert.match(html, /Fire count x2/);
  assert.match(html, /Earth count x1/);
  assert.match(html, /Wind count x0/);
  assert.match(html, /Water count x1/);
  assert.match(html, /Keyboard: \[1\] Fire\s+\[2\] Earth\s+\[3\] Wind\s+\[4\] Water/);
  assert.doesNotMatch(html, /hand-slot-name/);
  assert.match(html, /Hidden opponent hand: 4 cards/);
  assert.match(html, /assets\/cards\/customP1Back\.jpg/);
  assert.doesNotMatch(html, /id="right-hand">[\s\S]*hand-slot/);
});

test("ui: WAR summary keeps zero-count slots visible and dimmed", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "Hero", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "Elemental AI", title: "Arena Rival", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: false, turnLabel: "Player Turn", p1Name: "Hero", p2Name: "Elemental AI" },
    presentation: { phase: "result", busy: false, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/customFire.jpg", water: "assets/customWater.jpg", earth: "assets/customEarth.jpg", wind: "assets/customWind.jpg" },
      p2: { fire: "assets/oppFire.jpg", water: "assets/oppWater.jpg", earth: "assets/oppEarth.jpg", wind: "assets/oppWind.jpg" }
    },
    game: {
      roundOutcome: { key: "war_triggered", label: "WAR triggered" },
      roundResult: "WAR triggered.",
      round: 7,
      timerSeconds: 15,
      totalMatchSeconds: 210,
      canSelectCard: true,
      mode: "pve",
      playerHand: [],
      opponentHand: [],
      pileCount: 3,
      totalWarClashes: 2,
      warPileCards: ["fire", "fire", "earth"],
      captured: { p1: 1, p2: 2 },
      lastRound: { p1Card: "fire", p2Card: "fire" }
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /WAR Fire x2/);
  assert.match(html, /WAR Earth x1/);
  assert.match(html, /WAR Wind x0/);
  assert.match(html, /WAR Water x0/);
  assert.match(html, /class="war-slot war-slot-wind is-empty"/);
  assert.match(html, /class="war-slot war-slot-water is-empty"/);
});

test("ui: local PvP busy transition hides both hands before results after Player 2 submit", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "P1", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "P2", title: "Initiate", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: true, activePlayer: "p2", turnLabel: "P2 Turn", p1Name: "P1", p2Name: "P2" },
    presentation: { phase: "reveal", busy: true, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/customFire.jpg", water: "assets/customWater.jpg", earth: "assets/customEarth.jpg", wind: "assets/customWind.jpg" },
      p2: { fire: "assets/oppFire.jpg", water: "assets/oppWater.jpg", earth: "assets/oppEarth.jpg", wind: "assets/oppWind.jpg" }
    },
    cardBacks: { p1: "assets/cards/customP1Back.jpg", p2: "assets/cards/customP2Back.jpg" },
    game: {
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 5,
      timerSeconds: 18,
      totalMatchSeconds: 240,
      canSelectCard: true,
      mode: "local_pvp",
      playerHand: ["fire", "water", "earth", "wind"],
      opponentHand: ["fire", "fire", "earth", "water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: { p1Card: "earth", p2Card: "water" }
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /Hidden opponent hand: 4 cards/);
  assert.doesNotMatch(html, /hand-slot-count-badge/);
});

test("ui: local PvP WAR transition keeps both hands hidden until the next safe stage", () => {
  const html = gameScreen.render({
    reducedMotion: true,
    arenaBackground: "assets/EleMintzIcon.png",
    playerDisplay: { name: "P1", title: "Initiate", avatar: "assets/avatars/default.png" },
    opponentDisplay: { name: "P2", title: "Initiate", avatar: "assets/avatars/default.png" },
    hotseat: { enabled: true, activePlayer: "p1", turnLabel: "P1 Turn", p1Name: "P1", p2Name: "P2" },
    presentation: { phase: "reveal", busy: true, selectedCardIndex: null },
    cardImages: {
      p1: { fire: "assets/customFire.jpg", water: "assets/customWater.jpg", earth: "assets/customEarth.jpg", wind: "assets/customWind.jpg" },
      p2: { fire: "assets/oppFire.jpg", water: "assets/oppWater.jpg", earth: "assets/oppEarth.jpg", wind: "assets/oppWind.jpg" }
    },
    cardBacks: { p1: "assets/cards/customP1Back.jpg", p2: "assets/cards/customP2Back.jpg" },
    game: {
      roundOutcome: { key: "war_triggered", label: "WAR triggered" },
      roundResult: "WAR triggered.",
      round: 6,
      timerSeconds: 16,
      totalMatchSeconds: 220,
      canSelectCard: true,
      mode: "local_pvp",
      playerHand: ["fire", "water", "earth"],
      opponentHand: ["fire", "wind", "water"],
      pileCount: 2,
      totalWarClashes: 1,
      warPileCards: ["fire", "fire"],
      captured: { p1: 0, p2: 0 },
      lastRound: { p1Card: "fire", p2Card: "fire" }
    },
    actions: { playCard: async () => {}, backToMenu: () => {} }
  });

  assert.match(html, /Hidden opponent hand: 3 cards/);
  assert.doesNotMatch(html, /hand-slot-count-badge/);
});

test("ui: local PvP first submit activates handoff privacy overlay before action resolves", async () => {
  const backButton = createFakeElement();
  const activeCard = createFakeButton("0");
  const overlay = createFakeElement();
  const title = createFakeElement();
  const body = createFakeElement();

  const previousDocument = global.document;
  global.document = {
    getElementById(id) {
      return {
        "back-menu-btn": backButton,
        "hotseat-privacy-overlay": overlay,
        "hotseat-privacy-title": title,
        "hotseat-privacy-body": body
      }[id] ?? null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-card-owner='active']") {
        return [activeCard];
      }
      return [];
    }
  };

  let called = false;
  gameScreen.bind({
    hotseat: { enabled: true, activePlayer: "p1" },
    actions: {
      backToMenu: () => {},
      playCard: async () => {
        called = true;
        assert.equal(overlay.hidden, false);
        assert.equal(overlay.classList.contains("is-active"), true);
        assert.equal(title.textContent, "Player 2 Turn");
        assert.equal(body.textContent, "Pass device to the next player.");
      }
    }
  });

  try {
    await activeCard.listeners.get("click")();
    assert.equal(called, true);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: local PvP second submit activates resolving privacy overlay before action resolves", async () => {
  const backButton = createFakeElement();
  const activeCard = createFakeButton("2");
  const overlay = createFakeElement();
  const title = createFakeElement();
  const body = createFakeElement();

  const previousDocument = global.document;
  global.document = {
    getElementById(id) {
      return {
        "back-menu-btn": backButton,
        "hotseat-privacy-overlay": overlay,
        "hotseat-privacy-title": title,
        "hotseat-privacy-body": body
      }[id] ?? null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-card-owner='active']") {
        return [activeCard];
      }
      return [];
    }
  };

  let called = false;
  gameScreen.bind({
    hotseat: { enabled: true, activePlayer: "p2" },
    actions: {
      backToMenu: () => {},
      playCard: async () => {
        called = true;
        assert.equal(overlay.hidden, false);
        assert.equal(overlay.classList.contains("is-active"), true);
        assert.equal(title.textContent, "Resolving round...");
        assert.equal(body.textContent, "Hands are hidden while the round resolves.");
      }
    }
  });

  try {
    await activeCard.listeners.get("click")();
    assert.equal(called, true);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: game hand tiles unlock again if a click path exits without rerendering the screen", async () => {
  const backButton = createFakeElement();
  const activeCard = createFakeButton("2");
  const overlay = createFakeElement();
  const title = createFakeElement();
  const body = createFakeElement();

  const previousDocument = global.document;
  global.document = {
    getElementById(id) {
      return {
        "back-menu-btn": backButton,
        "hotseat-privacy-overlay": overlay,
        "hotseat-privacy-title": title,
        "hotseat-privacy-body": body
      }[id] ?? null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-card-owner='active']") {
        return [activeCard];
      }
      return [];
    }
  };

  let attempts = 0;
  gameScreen.bind({
    hotseat: { enabled: true, activePlayer: "p1" },
    actions: {
      backToMenu: () => {},
      playCard: async () => {
        attempts += 1;
      }
    }
  });

  try {
    await activeCard.listeners.get("click")();
    assert.equal(attempts, 1);
    assert.equal(activeCard.hasAttribute("disabled"), false);
    assert.equal(overlay.hidden, true);
    assert.equal(overlay.classList.contains("is-active"), false);

    await activeCard.listeners.get("click")();
    assert.equal(attempts, 2);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: keyboard selection triggers the same playCard path as clicking an active hand tile", async () => {
  const backButton = createFakeElement();
  const activeFire = createFakeButton("2");
  activeFire.getAttribute = (name) => {
    if (name === "data-element") return "fire";
    if (name === "data-card-index") return "2";
    if (name === "data-card-owner") return "active";
    return null;
  };

  const activeEarth = createFakeButton("4");
  activeEarth.getAttribute = (name) => {
    if (name === "data-element") return "earth";
    if (name === "data-card-index") return "4";
    if (name === "data-card-owner") return "active";
    return null;
  };

  const previousDocument = global.document;
  const registered = {};
  const activeButtons = [activeFire, activeEarth];
  const playCalls = [];

  global.document = {
    addEventListener(type, handler) {
      registered[type] = handler;
    },
    removeEventListener(type, handler) {
      if (registered[type] === handler) {
        delete registered[type];
      }
    },
    getElementById(id) {
      return id === "back-menu-btn" ? backButton : null;
    },
    querySelector(selector) {
      if (selector === ".modal-overlay") {
        return null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-card-owner='active']") {
        return activeButtons;
      }
      return [];
    }
  };

  gameScreen.bind({
    hotseat: { enabled: false },
    actions: {
      backToMenu: () => {},
      playCard: async (index) => {
        playCalls.push(index);
      }
    }
  });

  try {
    await registered.keydown({
      key: "1",
      preventDefault: () => {}
    });

    assert.deepEqual(playCalls, [2]);
    assert.equal(activeFire.classList.contains("is-selection-confirmed"), true);

    await activeEarth.listeners.get("click")();
    assert.deepEqual(playCalls, [2, 4]);
    assert.equal(activeEarth.classList.contains("is-selection-confirmed"), true);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: keyboard selection is ignored while a modal is open", async () => {
  const backButton = createFakeElement();
  const activeFire = createFakeButton("2");
  activeFire.getAttribute = (name) => {
    if (name === "data-element") return "fire";
    if (name === "data-card-index") return "2";
    if (name === "data-card-owner") return "active";
    return null;
  };

  const previousDocument = global.document;
  const registered = {};
  let playCalls = 0;

  global.document = {
    addEventListener(type, handler) {
      registered[type] = handler;
    },
    removeEventListener(type, handler) {
      if (registered[type] === handler) {
        delete registered[type];
      }
    },
    getElementById(id) {
      return id === "back-menu-btn" ? backButton : null;
    },
    querySelector(selector) {
      if (selector === ".modal-overlay") {
        return {};
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-card-owner='active']") {
        return [activeFire];
      }
      return [];
    }
  };

  gameScreen.bind({
    hotseat: { enabled: false },
    actions: {
      backToMenu: () => {},
      playCard: async () => {
        playCalls += 1;
      }
    }
  });

  try {
    await registered.keydown({
      key: "1",
      preventDefault: () => {}
    });

    assert.equal(playCalls, 0);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: profile unlocked achievements section uses 3-column profile grid class", () => {
  const html = profileScreen.render({
    profile: {
      username: "GridUser",
      title: "Initiate",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: { first_flame: { count: 1 } },
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: { avatar: "default_avatar", cardBack: "default_card_back", background: "default_background", elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" }, badge: "none", title: "Initiate" },
      catalog: { avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }], cardBack: [{ id: "default_card_back", name: "Default", owned: true }], background: [{ id: "default_background", name: "Default", owned: true }], elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }], badge: [{ id: "none", name: "No Badge", owned: true }], title: [{ id: "Initiate", name: "Initiate", owned: true }] }
    },
    titleIcon: null,
    searchResults: [],
    searchQuery: "",
    profileAchievementsExpanded: true,
    viewedProfileAchievementsExpanded: false,
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(html, /achievement-grid achievement-grid-profile/);
});

test("ui: profile screen shows next reward preview from XP-derived progression", () => {
  const html = profileScreen.render({
    profile: {
      username: "PreviewUser",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      playerXP: 42,
      playerLevel: 3,
      currentLevelXp: 25,
      nextLevelXp: 60,
      nextReward: { level: 5, name: "Avatar: Novice Mage" },
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: { avatar: "default_avatar", cardBack: "default_card_back", background: "default_background", elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" }, badge: "none", title: "Initiate" },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default Card Back", owned: true }],
        background: [{ id: "default_background", name: "EleMintz Table", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    titleIcon: null,
    backgroundImage: "assets/EleMintzIcon.png",
    searchQuery: "",
    searchResults: [],
    profileAchievementsExpanded: true,
    viewedProfileAchievementsExpanded: false,
    viewedProfile: null,
    actions: {
      equip: () => {},
      searchProfiles: () => {},
      viewProfile: () => {},
      clearViewed: () => {},
      back: () => {}
    }
  });

  assert.match(html, /data-profile-overview-level="true">2</);
  assert.match(html, /data-profile-overview-next-reward="true">Lv 3 - Title: Apprentice</);
  assert.match(html, /data-profile-overview-xp-value="true">17 \/ 35</);
  assert.match(html, /aria-valuenow="49"/);
  assert.match(html, /style="width: 49%"/);
});

test("ui: profile XP display resets to 0 at the start of a new level", () => {
  const html = profileScreen.render({
    profile: {
      username: "FreshLevelUser",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      playerXP: 225,
      playerLevel: 6,
      currentLevelXp: 225,
      nextLevelXp: 300,
      nextReward: { level: 10, name: "Badge: Element Initiate" },
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: { avatar: "default_avatar", cardBack: "default_card_back", background: "default_background", elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" }, badge: "none", title: "Initiate" },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default Card Back", owned: true }],
        background: [{ id: "default_background", name: "EleMintz Table", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    titleIcon: null,
    backgroundImage: "assets/EleMintzIcon.png",
    searchQuery: "",
    searchResults: [],
    profileAchievementsExpanded: true,
    viewedProfileAchievementsExpanded: false,
    viewedProfile: null,
    actions: {
      equip: () => {},
      searchProfiles: () => {},
      viewProfile: () => {},
      clearViewed: () => {},
      back: () => {}
    }
  });

  assert.match(html, /data-profile-overview-xp-value="true">0 \/ 65</);
  assert.match(html, /aria-valuenow="0"/);
  assert.match(html, /style="width: 0%"/);
});

test("ui: profile initial progression display can render correct per-level values on first load", () => {
  const html = profileScreen.render({
    profile: {
      username: "InitialProgressUser",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      playerXP: 112,
      playerLevel: 4,
      currentLevelXp: 110,
      nextLevelXp: 165,
      nextReward: { level: 5, name: "Avatar: Novice Mage" },
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: { avatar: "default_avatar", cardBack: "default_card_back", background: "default_background", elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" }, badge: "none", title: "Initiate" },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default Card Back", owned: true }],
        background: [{ id: "default_background", name: "EleMintz Table", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    titleIcon: null,
    backgroundImage: "assets/EleMintzIcon.png",
    searchQuery: "",
    searchResults: [],
    profileAchievementsExpanded: true,
    viewedProfileAchievementsExpanded: false,
    viewedProfile: null,
    actions: {
      equip: () => {},
      searchProfiles: () => {},
      viewProfile: () => {},
      clearViewed: () => {},
      back: () => {}
    }
  });

  assert.match(html, /data-profile-overview-level="true">4</);
  assert.match(html, /data-profile-overview-xp-value="true">2 \/ 55</);
  assert.match(html, /aria-valuenow="4"/);
  assert.match(html, /style="width: 4%"/);
});

test("ui: profile header resolves equipped title display name without exposing title equip controls", () => {
  const html = profileScreen.render({
    profile: {
      username: "TitleOwner",
      title: "title_apprentice",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "title_apprentice", badge: "none" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: {
          fire: "default_fire_card",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        },
        badge: "none",
        title: "title_apprentice"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default Card Back", owned: true }],
        background: [{ id: "default_background", name: "EleMintz Table", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [
          { id: "title_apprentice", name: "Apprentice", owned: true },
          { id: "title_elementalist", name: "Elementalist", owned: false }
        ]
      }
    },
    titleIcon: null,
    backgroundImage: "assets/EleMintzIcon.png",
    searchQuery: "",
    searchResults: [],
    profileAchievementsExpanded: true,
    viewedProfileAchievementsExpanded: false,
    viewedProfile: null,
    actions: {
      equip: () => {},
      searchProfiles: () => {},
      viewProfile: () => {},
      clearViewed: () => {},
      back: () => {}
    }
  });

  assert.match(html, /<span>Apprentice<\/span>/);
  assert.doesNotMatch(html, /<span>title_apprentice<\/span>/);
  assert.doesNotMatch(html, /<select/);
});

test("ui: profile header uses equipped title cosmetic image instead of fallback title icon", () => {
  const html = profileScreen.render({
    profile: {
      username: "TitleIconUser",
      title: "title_apprentice",
      wins: 0,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 0,
      bestWinStreak: 0,
      tokens: 0,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "title_apprentice", badge: "none" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: {
          fire: "default_fire_card",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        },
        badge: "none",
        title: "title_apprentice"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default Card Back", owned: true }],
        background: [{ id: "default_background", name: "EleMintz Table", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "title_apprentice", name: "Apprentice", image: "titles/title_apprentice.png", owned: true }]
      }
    },
    titleIcon: "badges/firstFlame.png",
    backgroundImage: "assets/EleMintzIcon.png",
    searchQuery: "",
    searchResults: [],
    viewedProfile: null,
    actions: {
      equip: () => {},
      searchProfiles: () => {},
      viewProfile: () => {},
      clearViewed: () => {},
      back: () => {}
    }
  });

  assert.match(html, /src="(?:file:.*\/)?assets\/titles\/title_apprentice\.png"/);
  assert.doesNotMatch(html, /src="assets\/badges\/firstFlame\.png" alt="Apprentice" class="title-icon"/);
});

test("ui: online play screen renders room flow status and room details", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "abc123",
    formattedErrorMessage: "Previous error",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      statusMessage: "Room ABC123 created. Waiting for another player.",
      lastError: { message: "Previous error" },
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "waiting",
        host: { socketId: "host-1" },
        guest: null
      }
    },
    actions: {}
  });

  assert.match(html, /Online Play/);
  assert.match(html, /Match State:<\/strong> Waiting for Opponent/);
  assert.match(html, /Notice:<\/strong> Previous error/);
  assert.match(html, /Room Code:<\/strong> ABC123/);
  assert.match(html, /Role:<\/strong> Host/);
  assert.doesNotMatch(html, /Connection:<\/strong>/);
  assert.doesNotMatch(html, /id="online-create-room-btn"/);
  assert.doesNotMatch(html, /id="online-room-code-input"/);
  assert.doesNotMatch(html, /value="abc123"/);
});

test("ui: online play screen renders public room controls in the pre-room state", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "",
    onlineCreateRoomVisibility: "private",
    onlinePlayerCount: 3,
    onlinePublicRoomsStatus: "idle",
    onlinePublicRooms: [],
    formattedErrorMessage: "",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      statusMessage: "Connected. Create a room or join one.",
      lastError: null,
      room: null
    },
    actions: {}
  });

  assert.match(html, /Private \/ code only/);
  assert.match(html, /Public \/ listed/);
  assert.match(html, /data-online-room-visibility="private"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /Online Now:<\/strong> 3 players/);
  assert.match(html, /Browse Public Rooms/);
  assert.match(html, /Browse waiting public rooms when you want a faster join path without sharing a code first\./);
  assert.match(html, /id="online-refresh-public-rooms-btn"/);
  assert.match(html, /id="online-join-room-form"/);
});

test("ui: online play screen renders public room cards and empty\/error states", () => {
  const listHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "",
    onlineCreateRoomVisibility: "public",
    onlinePlayerCount: 4,
    onlinePublicRoomsStatus: "ready",
    onlinePublicRooms: [
      {
        roomCode: "PUB123",
        createdAt: "2026-05-13T12:00:00.000Z",
        hostUsername: "PublicHost",
        visibility: "public",
        status: "waiting"
      }
    ],
    now: Date.parse("2026-05-13T12:00:45.000Z"),
    formattedErrorMessage: "",
    multiplayer: {
      connectionStatus: "connected",
      statusMessage: "Connected. Create a room or join one.",
      lastError: null,
      room: null
    },
    actions: {}
  });

  assert.match(listHtml, /PublicHost/);
  assert.match(listHtml, /Online Now:<\/strong> 4 players/);
  assert.match(listHtml, /Public Rooms:<\/strong> 1 waiting/);
  assert.match(listHtml, /Room Code:<\/strong> PUB123/);
  assert.match(listHtml, /Created:<\/strong> 45s ago/);
  assert.match(listHtml, /data-online-public-room-join="PUB123"/);

  const emptyHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "",
    onlineCreateRoomVisibility: "private",
    onlinePublicRoomsStatus: "ready",
    onlinePublicRooms: [],
    formattedErrorMessage: "",
    multiplayer: {
      connectionStatus: "connected",
      statusMessage: "Connected. Create a room or join one.",
      lastError: null,
      room: null
    },
    actions: {}
  });

  assert.match(emptyHtml, /No public rooms available\./);

  const errorHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "",
    onlineCreateRoomVisibility: "private",
    onlinePublicRoomsStatus: "error",
    onlinePublicRoomsError: "Unable to load public rooms.",
    onlinePublicRooms: [],
    formattedErrorMessage: "",
    multiplayer: {
      connectionStatus: "connected",
      statusMessage: "Connected. Create a room or join one.",
      lastError: null,
      room: null
    },
    actions: {}
  });

  assert.match(errorHtml, /Notice:<\/strong> Unable to load public rooms\./);
});

test("ui: online play screen renders loading labels for presence and public rooms", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "",
    onlineCreateRoomVisibility: "private",
    onlinePlayerCount: null,
    onlinePlayerCountStatus: "loading",
    onlinePublicRoomsStatus: "loading",
    onlinePublicRooms: [],
    formattedErrorMessage: "",
    multiplayer: {
      connectionStatus: "connected",
      statusMessage: "Connected. Create a room or join one.",
      lastError: null,
      room: null
    },
    actions: {}
  });

  assert.match(html, /Online Now:<\/strong> loading\.\.\./);
  assert.match(html, /Public Rooms:<\/strong> loading\.\.\./);
  assert.match(html, /Refreshing public rooms\.\.\./);
});

test("ui: online play screen keeps returned public room cards visible even when a generic pre-room notice exists", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "",
    onlineCreateRoomVisibility: "public",
    onlinePublicRoomsStatus: "ready",
    onlinePublicRooms: [
      {
        roomCode: "PUB123",
        createdAt: "2026-05-13T12:00:00.000Z",
        hostUsername: "PublicHost",
        visibility: "public",
        status: "waiting"
      }
    ],
    now: Date.parse("2026-05-13T12:00:45.000Z"),
    formattedErrorMessage: "Generic signed-in notice",
    multiplayer: {
      connectionStatus: "connected",
      statusMessage: "Connected. Create a room or join one.",
      lastError: null,
      room: null
    },
    actions: {}
  });

  assert.match(html, /PublicHost/);
  assert.doesNotMatch(html, /Generic signed-in notice/);
});

test("ui: online play waiting host state shows the host's equipped cosmetics cleanly before join", () => {
  const hostResolvedIdentity = {
    slotLabel: "Host",
    username: "HostUser",
    connected: true,
    avatarImage: getAvatarImage("avatar_crystal_soul"),
    backgroundImage: getArenaBackground("bg_verdant_shrine"),
    cardBackImage: getCardBackImage("cardback_arcane_galaxy"),
    titleLabel: "Apprentice",
    badgeImage: getBadgeImage("badge_element_initiate"),
    variantImages: getVariantCardImages({
      fire: "fire_variant_crownfire",
      water: "water_variant_tidal_spirit",
      earth: "earth_variant_transparent_crystal",
      wind: "wind_variant_vortex_spirit"
    })
  };
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "HostUser",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      room: {
        roomCode: "ABC123",
        status: "waiting",
        hostResolvedIdentity,
        guestResolvedIdentity: null,
        host: {
          socketId: "host-1",
          username: "HostUser",
          equippedCosmetics: {
            avatar: "avatar_crystal_soul",
            background: "bg_verdant_shrine",
            cardBack: "cardback_arcane_galaxy",
            badge: "badge_element_initiate",
            title: "title_apprentice",
            elementCardVariant: {
              fire: "fire_variant_crownfire",
              water: "water_variant_tidal_spirit",
              earth: "earth_variant_transparent_crystal",
              wind: "wind_variant_vortex_spirit"
            }
          }
        },
        guest: null
      }
    },
    actions: {}
  });

  assert.match(html, /Waiting for Opponent/);
  assert.match(html, /Share room code ABC123 to start the online match\./);
  assert.match(html, /data-online-player-card-back="host-waiting"/);
  assert.match(html, /<span>Apprentice<\/span>/);
  assert.match(html, /class="online-waiting-preview-grid"/);
  assert.match(html, /class="online-waiting-preview-card"/);
  assert.match(html, /Fire<\/p>/);
  assert.match(html, /Water<\/p>/);
  assert.match(html, /Earth<\/p>/);
  assert.match(html, /Wind<\/p>/);
  assert.match(html, /Waiting for Opponent/);
  assert.match(html, /This player slot will fill when someone joins the room\./);
  assert.match(html, /data-online-waiting-placeholder="guest"/);
  assert.doesNotMatch(html, /hidden-hand-summary/);
  assert.doesNotMatch(html, /x0/);
  assert.match(html, new RegExp(getAvatarImage("avatar_crystal_soul").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(getArenaBackground("bg_verdant_shrine").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(getCardBackImage("cardback_arcane_galaxy").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /badge_element_initiate\.png/);
  assert.match(html, new RegExp(getVariantCardImages({ fire: "fire_variant_crownfire" }).fire.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(getVariantCardImages({ water: "water_variant_tidal_spirit" }).water.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(getVariantCardImages({ earth: "earth_variant_transparent_crystal" }).earth.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(getVariantCardImages({ wind: "wind_variant_vortex_spirit" }).wind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("ui: online play screen tolerates incomplete room identity during create or join without crashing", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "HostUser",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      room: {
        roomCode: "ABC123",
        status: "full",
        host: {
          socketId: "host-1",
          username: "HostUser",
          equippedCosmetics: {
            avatar: "avatar_crystal_soul",
            background: "bg_verdant_shrine",
            cardBack: "cardback_arcane_galaxy",
            badge: "badge_element_initiate",
            title: "title_apprentice",
            elementCardVariant: {
              fire: "default_fire_card",
              water: "default_water_card",
              earth: "default_earth_card",
              wind: "default_wind_card"
            }
          }
        },
        guest: null,
        moveSync: { hostSubmitted: false, guestSubmitted: false, submittedCount: 0, bothSubmitted: false, updatedAt: null },
        hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
        guestHand: { fire: 2, water: 2, earth: 2, wind: 2 }
      }
    },
    actions: {}
  });

  assert.match(html, /State:<\/strong> Active Round/);
  assert.match(html, /Room Code:<\/strong> ABC123/);
  assert.doesNotMatch(html, /TypeError/);
});

test("ui: online play screen renders move sync status and submit controls for full rooms", () => {
  const hostResolvedIdentity = {
    slotLabel: "Host",
    username: "Host",
    connected: true,
    avatarImage: getAvatarImage("avatar_fourfold_lord"),
    backgroundImage: getArenaBackground("bg_elemental_throne"),
    cardBackId: "cardback_elemental_nexus",
    cardBackImage: getCardBackImage("cardback_elemental_nexus"),
    titleLabel: "War Master",
    badgeImage: getBadgeImage("badge_arena_legend"),
    variantSelection: {
      fire: "fire_variant_phoenix",
      water: "water_variant_crystal",
      earth: "earth_variant_titan",
      wind: "wind_variant_storm_eye"
    },
    variantImages: getVariantCardImages({
      fire: "fire_variant_phoenix",
      water: "water_variant_crystal",
      earth: "earth_variant_titan",
      wind: "wind_variant_storm_eye"
    })
  };
  const guestResolvedIdentity = {
    slotLabel: "Guest",
    username: "Guest",
    connected: true,
    avatarImage: getAvatarImage("avatar_storm_oracle"),
    backgroundImage: getArenaBackground("bg_storm_temple"),
    cardBackId: "cardback_storm_spiral",
    cardBackImage: getCardBackImage("cardback_storm_spiral"),
    titleLabel: "Element Sovereign",
    badgeImage: getBadgeImage("badge_element_veteran"),
    variantSelection: {
      fire: "fire_variant_ember",
      water: "water_variant_tidal_spirit",
      earth: "earth_variant_rooted_monolith",
      wind: "wind_variant_sky_serpent"
    },
    variantImages: getVariantCardImages({
      fire: "fire_variant_ember",
      water: "water_variant_tidal_spirit",
      earth: "earth_variant_rooted_monolith",
      wind: "wind_variant_sky_serpent"
    })
  };
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "guest-1",
      statusMessage: "1/2 move submission received for room ABC123.",
      lastError: null,
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        hostResolvedIdentity,
        guestResolvedIdentity,
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 0,
        guestScore: 0,
        roundNumber: 1,
        lastOutcomeType: null,
        matchComplete: false,
        winner: null,
        winReason: null,
        rematch: { hostReady: false, guestReady: false },
        hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
        guestHand: { fire: 0, water: 1, earth: 2, wind: 1 },
        warPot: { host: [], guest: [] },
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: false,
          submittedCount: 1,
          bothSubmitted: false,
          updatedAt: "2026-03-19T12:00:05.000Z"
        }
      }
    },
    actions: {}
  });

  assert.match(html, /State:<\/strong> Active Round/);
  assert.match(html, /Sync:<\/strong> 1\/2 submitted\./);
  assert.match(html, /Active Round/);
  assert.match(html, /Choose your move for the current round\./);
  assert.match(html, /Round 1 \| Host 0 - Guest 0/);
  assert.match(html, /Move Sync: 1\/2 submitted\./);
  assert.match(html, /class="player-header"/);
  assert.match(html, /Guest \(4\)/);
  assert.match(html, /Host \(8\)/);
  assert.match(html, /class="hand-slot hand-slot-fire [^"]*is-empty/);
  assert.match(html, /data-move="water"/);
  assert.match(html, /aria-label="Water count x1"/);
  assert.match(html, /aria-label="Earth count x2"/);
  assert.match(html, /aria-label="Wind count x1"/);
  assert.match(html, /data-preview-src="[^"]*title_element_sovereign\.png"/);
  assert.match(html, /data-preview-src="[^"]*badge_element_veteran\.png"/);
  assert.match(html, /class="title-icon" src="[^"]*title_element_sovereign\.png"/);
  assert.match(html, /class="featured-badge" src="[^"]*badge_element_veteran\.png"/);
});

test("ui: online play screen renders match complete and rematch readiness state", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "GuestRewardUser",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "guest-1",
      statusMessage: "Match complete in room ABC123. Ready up for rematch.",
      lastError: null,
      latestRoundResult: {
        roomCode: "ABC123",
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        hostScore: 5,
        guestScore: 3,
        roundNumber: 9,
        lastOutcomeType: "resolved",
        matchComplete: true,
        winner: "host",
        winReason: "hand_exhaustion",
        rematch: { hostReady: true, guestReady: false },
        hostHand: { fire: 3, water: 2, earth: 4, wind: 3 },
        guestHand: { fire: 1, water: 1, earth: 0, wind: 1 },
        warPot: { host: [], guest: [] },
        warActive: false,
        warDepth: 0,
        warRounds: [],
        hostResult: "win",
        guestResult: "lose"
      },
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 5,
        guestScore: 3,
        roundNumber: 9,
        lastOutcomeType: "resolved",
        matchComplete: true,
        winner: "host",
        winReason: "hand_exhaustion",
        rewardSettlement: {
          granted: true,
          grantedAt: "2026-03-20T12:00:00.000Z",
          decision: {
            participants: {
              hostUsername: "HostRewardUser",
              guestUsername: "GuestRewardUser"
            },
            rewards: {
              host: { tokens: 25, xp: 20, basicChests: 1 },
              guest: { tokens: 5, xp: 5, basicChests: 0 }
            }
          },
          summary: {
            granted: true,
            winner: "host",
            settledHostUsername: "HostRewardUser",
            settledGuestUsername: "GuestRewardUser",
            hostRewards: { tokens: 25, xp: 20, basicChests: 1 },
            guestRewards: { tokens: 5, xp: 5, basicChests: 0 }
          }
        },
        rematch: { hostReady: true, guestReady: false },
        hostHand: { fire: 3, water: 2, earth: 4, wind: 3 },
        guestHand: { fire: 1, water: 1, earth: 0, wind: 1 },
        warPot: { host: [], guest: [] },
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: true,
          submittedCount: 2,
          bothSubmitted: true,
          updatedAt: "2026-03-19T12:00:05.000Z"
        }
      }
    },
    actions: {}
  });

  assert.match(html, /State:<\/strong> Match Complete/);
  assert.match(html, /Match Complete/);
  assert.match(html, /Winner:<\/strong> You Lose/);
  assert.match(html, /Why:<\/strong> hand exhaustion/);
  assert.match(html, /Host Ready:<\/strong> Yes/);
  assert.match(html, /Guest Ready:<\/strong> No/);
  assert.match(html, /Rewards Granted/);
  assert.match(html, /You Gained:<\/strong> \+5 Tokens, \+5 XP/);
  assert.match(html, /id="online-ready-rematch-btn"/);
  assert.doesNotMatch(html, /Submit Fire/);
});

test("ui: online play screen reward summary reflects an actual chest grant", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    profile: {
      username: "HostRewardUser",
      chests: { basic: 3 }
    },
    username: "HostRewardUser",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      statusMessage: "Match complete in room ABC123. Ready up for rematch.",
      lastError: null,
      latestRoundResult: null,
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 3,
        guestScore: 1,
        roundNumber: 7,
        lastOutcomeType: "resolved",
        matchComplete: true,
        winner: "host",
        winReason: "hand_exhaustion",
        rewardSettlement: {
          granted: true,
          grantedAt: "2026-03-20T12:00:00.000Z",
          decision: {
            participants: {
              hostUsername: "HostRewardUser",
              guestUsername: "GuestRewardUser"
            },
            rewards: {
              host: { tokens: 25, xp: 20, basicChests: 1 },
              guest: { tokens: 5, xp: 5, basicChests: 0 }
            }
          },
          summary: {
            granted: true,
            winner: "host",
            settledHostUsername: "HostRewardUser",
            settledGuestUsername: "GuestRewardUser",
            hostRewards: { tokens: 25, xp: 20, basicChests: 1 },
            guestRewards: { tokens: 5, xp: 5, basicChests: 0 }
          }
        },
        rematch: { hostReady: false, guestReady: false },
        hostHand: { fire: 4, water: 3, earth: 4, wind: 3 },
        guestHand: { fire: 0, water: 1, earth: 0, wind: 1 },
        warPot: { host: [], guest: [] },
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: true,
          submittedCount: 2,
          bothSubmitted: true,
          updatedAt: "2026-03-19T12:00:05.000Z"
        }
      }
    },
    actions: {}
  });

  assert.match(html, /You Gained:<\/strong> \+25 Tokens, \+20 XP, \+1 Basic Chest/);
  assert.match(html, /Basic Chests Waiting:<\/strong> 3 Basic Chests/);
});

test("ui: online play results use current basic chest inventory without implying a chest grant when none was awarded", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    profile: {
      username: "GuestRewardUser",
      chests: { basic: 2 }
    },
    username: "GuestRewardUser",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "guest-1",
      room: {
        roomCode: "ABC123",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        matchComplete: true,
        winner: "host",
        rewardSettlement: {
          granted: true,
          grantedAt: "2026-03-20T12:00:00.000Z",
          decision: {
            participants: {
              hostUsername: "HostRewardUser",
              guestUsername: "GuestRewardUser"
            },
            rewards: {
              host: { tokens: 25, xp: 20, basicChests: 1 },
              guest: { tokens: 5, xp: 5, basicChests: 0 }
            }
          },
          summary: {
            granted: true,
            settledHostUsername: "HostRewardUser",
            settledGuestUsername: "GuestRewardUser",
            hostRewards: { tokens: 25, xp: 20, basicChests: 1 },
            guestRewards: { tokens: 5, xp: 5, basicChests: 0 }
          }
        },
        rematch: { hostReady: false, guestReady: false }
      }
    },
    actions: {}
  });

  assert.match(html, /You Gained:<\/strong> \+5 Tokens, \+5 XP/);
  assert.doesNotMatch(html, /\+5 Tokens, \+5 XP, \+\d+ Basic Chest/);
  assert.match(html, /Basic Chests Waiting:<\/strong> 2 Basic Chests/);
});

test("ui: completed online match renders local player daily and weekly challenge progress in the existing results area", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "GuestRewardUser",
    onlineChallengeSummary: {
      daily: {
        msUntilReset: 5400000,
        challenges: [
          {
            id: "daily_win_1_match",
            name: "Win 1 Match",
            progress: 1,
            goal: 1,
            completed: true
          },
          {
            id: "daily_play_5_matches",
            name: "Play 5 Matches",
            progress: 1,
            goal: 5,
            completed: false
          }
        ]
      },
      weekly: {
        msUntilReset: 176400000,
        challenges: [
          {
            id: "weekly_play_15_matches",
            name: "Play 15 Matches",
            progress: 1,
            goal: 15,
            completed: false
          },
          {
            id: "weekly_win_streak_3",
            name: "Reach a 3 Win Streak",
            progress: 1,
            goal: 1,
            completed: true
          }
        ]
      }
    },
    multiplayer: {
      connectionStatus: "connected",
      socketId: "guest-1",
      statusMessage: "Match complete in room ABC123. Ready up for rematch.",
      lastError: null,
      room: {
        roomCode: "ABC123",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 5,
        guestScore: 3,
        roundNumber: 9,
        lastOutcomeType: "resolved",
        matchComplete: true,
        winner: "host",
        winReason: "hand_exhaustion",
        rewardSettlement: {
          granted: true,
          grantedAt: "2026-03-20T12:00:00.000Z",
          decision: {
            participants: {
              hostUsername: "HostRewardUser",
              guestUsername: "GuestRewardUser"
            },
            rewards: {
              host: { tokens: 25, xp: 20, basicChests: 1 },
              guest: { tokens: 5, xp: 5, basicChests: 0 }
            }
          },
          summary: {
            granted: true,
            winner: "host",
            settledHostUsername: "HostRewardUser",
            settledGuestUsername: "GuestRewardUser",
            hostRewards: { tokens: 25, xp: 20, basicChests: 1 },
            guestRewards: { tokens: 5, xp: 5, basicChests: 0 }
          }
        },
        rematch: { hostReady: false, guestReady: false },
        hostHand: { fire: 3, water: 2, earth: 4, wind: 3 },
        guestHand: { fire: 1, water: 1, earth: 0, wind: 1 },
        warPot: { host: [], guest: [] },
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: []
      }
    },
    actions: {}
  });

  assert.match(html, /Match Complete/);
  assert.match(html, /Challenges/);
  assert.match(html, /Daily Progress/);
  assert.match(html, /Weekly Progress/);
  assert.match(html, /Win 1 Match/);
  assert.match(html, /Play 5 Matches/);
  assert.match(html, /Play 15 Matches/);
  assert.match(html, /Reach a 3 Win Streak/);
});

test("ui: online play screen renders round result from the local player perspective", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "SignedInGuest",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "guest-1",
      statusMessage: "You Win Room ABC123",
      lastError: null,
      latestRoundResult: {
        roomCode: "ABC123",
        hostMove: "fire",
        guestMove: "water",
        outcomeType: "resolved",
        hostResult: "lose",
        guestResult: "win"
      },
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 0,
        guestScore: 1,
        roundNumber: 2,
        lastOutcomeType: "resolved",
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: true,
          submittedCount: 2,
          bothSubmitted: true,
          updatedAt: "2026-03-19T12:00:05.000Z"
        }
      }
    },
    actions: {}
  });

  assert.match(html, /data-round-center-result="true"/);
  assert.match(html, /WATER BEATS FIRE/);
  assert.doesNotMatch(html, /Why:<\/strong>/);
  assert.doesNotMatch(html, /Changed:<\/strong>/);
});

test("ui: online play screen keeps settled guest rewards after host migration", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "GuestRewardUser",
    onlineChallengeSummary: {
      daily: {
        msUntilReset: 5400000,
        challenges: [
          {
            id: "daily_play_5_matches",
            name: "Play 5 Matches",
            progress: 1,
            goal: 5,
            completed: false
          }
        ]
      },
      weekly: {
        msUntilReset: 176400000,
        challenges: [
          {
            id: "weekly_play_15_matches",
            name: "Play 15 Matches",
            progress: 1,
            goal: 15,
            completed: false
          }
        ]
      }
    },
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "guest-1",
      statusMessage: "Match complete in room ABC123. Ready up for rematch.",
      lastError: null,
      latestRoundResult: {
        roomCode: "ABC123",
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        matchComplete: true,
        winner: "host",
        winReason: "hand_exhaustion",
        hostResult: "win",
        guestResult: "lose"
      },
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "closing",
        host: { socketId: "host-1", username: "HostRewardUser", connected: false },
        guest: { socketId: "guest-1", username: "GuestRewardUser", connected: true },
        hostScore: 5,
        guestScore: 3,
        roundNumber: 9,
        lastOutcomeType: "resolved",
        matchComplete: true,
        winner: "host",
        winReason: "hand_exhaustion",
        disconnectState: {
          active: true,
          disconnectedRole: "host",
          disconnectedUsername: "HostRewardUser",
          remainingUsername: "GuestRewardUser",
          reason: "post_match_disconnect"
        },
        closingAt: "2026-03-20T12:00:30.000Z",
        rewardSettlement: {
          granted: true,
          grantedAt: "2026-03-20T12:00:00.000Z",
          decision: {
            participants: {
              hostUsername: "HostRewardUser",
              guestUsername: "GuestRewardUser"
            },
            rewards: {
              host: { tokens: 25, xp: 20, basicChests: 1 },
              guest: { tokens: 5, xp: 5, basicChests: 0 }
            }
          },
          summary: {
            granted: true,
            winner: "host",
            settledHostUsername: "HostRewardUser",
            settledGuestUsername: "GuestRewardUser",
            hostRewards: { tokens: 25, xp: 20, basicChests: 1 },
            guestRewards: { tokens: 5, xp: 5, basicChests: 0 }
          }
        },
        rematch: { hostReady: false, guestReady: false },
        hostHand: { fire: 3, water: 2, earth: 4, wind: 3 },
        guestHand: { fire: 1, water: 1, earth: 0, wind: 1 },
        warPot: { host: [], guest: [] },
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: []
      }
    },
    actions: {}
  });

  assert.match(html, /Winner:<\/strong> You Lose/);
  assert.match(html, /You Gained:<\/strong> \+5 Tokens, \+5 XP/);
  assert.match(html, /Reconnect:<\/strong> HostRewardUser disconnected after match completion\./);
  assert.match(html, /Rematch:<\/strong> Unavailable/);
  assert.match(html, /Daily Progress/);
  assert.match(html, /Play 5 Matches/);
  assert.match(html, /Weekly Progress/);
  assert.match(html, /Play 15 Matches/);
  assert.doesNotMatch(html, /\+25 Tokens, \+20 XP, \+1 Basic Chest/);
});

test("ui: online play rematch reset hides challenge summary while keeping the existing online screen", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "GuestRewardUser",
    onlineChallengeSummary: {
      daily: {
        msUntilReset: 5400000,
        challenges: [
          {
            id: "daily_play_5_matches",
            name: "Play 5 Matches",
            progress: 1,
            goal: 5,
            completed: false
          }
        ]
      },
      weekly: {
        msUntilReset: 176400000,
        challenges: [
          {
            id: "weekly_play_15_matches",
            name: "Play 15 Matches",
            progress: 1,
            goal: 15,
            completed: false
          }
        ]
      }
    },
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "guest-1",
      statusMessage: "Rematch started in room ABC123.",
      lastError: null,
      room: {
        roomCode: "ABC123",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 0,
        guestScore: 0,
        roundNumber: 1,
        lastOutcomeType: null,
        matchComplete: false,
        winner: null,
        winReason: null,
        rematch: { hostReady: false, guestReady: false },
        hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
        guestHand: { fire: 2, water: 2, earth: 2, wind: 2 },
        warPot: { host: [], guest: [] },
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: [],
        moveSync: {
          hostSubmitted: false,
          guestSubmitted: false,
          submittedCount: 0,
          bothSubmitted: false,
          updatedAt: null
        }
      }
    },
    actions: {}
  });

  assert.match(html, /Online Play/);
  assert.doesNotMatch(html, /Daily Progress/);
  assert.doesNotMatch(html, /Weekly Progress/);
  assert.doesNotMatch(html, /id="online-ready-rematch-btn"/);
});

test("ui: online play screen shows paused reconnect status on the existing screen", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "ResumeHost",
    joinCode: "ABC123",
    now: Date.parse("2026-03-20T12:00:00.000Z"),
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      statusMessage: "Opponent disconnected. Waiting for reconnect.",
      lastError: null,
      room: {
        roomCode: "ABC123",
        status: "paused",
        host: { socketId: "host-1", username: "ResumeHost", connected: true },
        guest: { socketId: "guest-1", username: "ResumeGuest", connected: false },
        hostScore: 1,
        guestScore: 0,
        roundNumber: 2,
        lastOutcomeType: "resolved",
        matchComplete: false,
        winner: null,
        winReason: null,
        disconnectState: {
          active: true,
          disconnectedRole: "guest",
          disconnectedUsername: "ResumeGuest",
          remainingUsername: "ResumeHost",
          reason: "waiting_for_reconnect",
          expiresAt: "2026-03-20T12:00:45.000Z",
          resumedAt: null
        },
        rematch: { hostReady: false, guestReady: false },
        hostHand: { fire: 3, water: 2, earth: 2, wind: 2 },
        guestHand: { fire: 1, water: 2, earth: 2, wind: 2 },
        warPot: { host: [], guest: [] },
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: []
      }
    },
    actions: {}
  });

  assert.match(html, /State:<\/strong> Reconnect Paused/);
  assert.match(html, /Reconnect:<\/strong> ResumeGuest disconnected\. Waiting to reconnect\./);
  assert.match(html, /Room Code:<\/strong> ABC123/);
  assert.match(html, /Room Expires In:<\/strong> 00:45/);
  assert.match(html, /Rematch:<\/strong> Unavailable/);
  assert.doesNotMatch(html, /Match Complete/);
  assert.doesNotMatch(html, /popup/i);
});

test("ui: online play screen shows resumed and expired no-contest room notices on the existing screen", () => {
  const resumedHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "ResumeGuest",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "guest-2",
      statusMessage: "Match resumed.",
      lastError: null,
      room: {
        roomCode: "ABC123",
        status: "full",
        host: { socketId: "host-1", username: "ResumeHost", connected: true },
        guest: { socketId: "guest-2", username: "ResumeGuest", connected: true },
        hostScore: 1,
        guestScore: 0,
        roundNumber: 2,
        lastOutcomeType: "resolved",
        matchComplete: false,
        winner: null,
        winReason: null,
        disconnectState: {
          active: false,
          disconnectedRole: null,
          disconnectedUsername: null,
          remainingUsername: null,
          reason: "match_resumed",
          expiresAt: null,
          resumedAt: "2026-03-20T12:00:20.000Z"
        },
        rematch: { hostReady: false, guestReady: false },
        hostHand: { fire: 3, water: 2, earth: 2, wind: 2 },
        guestHand: { fire: 1, water: 2, earth: 2, wind: 2 },
        warPot: { host: [], guest: [] },
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: []
      }
    },
    actions: {}
  });
  const expiredHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "ResumeHost",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      statusMessage: "Reconnect window expired.",
      lastError: null,
      room: {
        roomCode: "ABC123",
        status: "expired",
        host: { socketId: "host-1", username: "ResumeHost", connected: true },
        guest: { socketId: "guest-1", username: "ResumeGuest", connected: false },
        hostScore: 1,
        guestScore: 0,
        roundNumber: 2,
        lastOutcomeType: "resolved",
        matchComplete: false,
        winner: null,
        winReason: null,
        disconnectState: {
          active: true,
          disconnectedRole: "guest",
          disconnectedUsername: "ResumeGuest",
          remainingUsername: "ResumeHost",
          reason: "disconnect_timeout_expired",
          expiresAt: "2026-03-20T12:01:00.000Z",
          resumedAt: null
        },
        closingAt: "2026-03-20T12:01:30.000Z",
        rematch: { hostReady: false, guestReady: false },
        hostHand: { fire: 3, water: 2, earth: 2, wind: 2 },
        guestHand: { fire: 1, water: 2, earth: 2, wind: 2 },
        warPot: { host: [], guest: [] },
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: []
      }
    },
    actions: {}
  });

  assert.match(resumedHtml, /State:<\/strong> Match Resumed/);
  assert.match(resumedHtml, /Reconnect:<\/strong> Match resumed\./);
  assert.match(expiredHtml, /State:<\/strong> No Contest/);
  assert.match(expiredHtml, /Reconnect:<\/strong> Reconnect timeout expired\. Match ended with no contest\./);
  assert.match(expiredHtml, /Rematch:<\/strong> Unavailable/);
  assert.doesNotMatch(expiredHtml, /id="online-ready-rematch-btn"/);
  assert.doesNotMatch(expiredHtml, /Rewards Granted/);
});

test("ui: online play screen normalizes waiting active war complete and closing room states", () => {
  const waitingHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "HostUser",
    joinCode: "AAA222",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      room: {
        roomCode: "AAA222",
        status: "waiting",
        host: { socketId: "host-1", username: "HostUser" },
        guest: null
      }
    },
    actions: {}
  });
  const activeHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "HostUser",
    joinCode: "AAA222",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      room: {
        roomCode: "AAA222",
        status: "full",
        host: { socketId: "host-1", username: "HostUser" },
        guest: { socketId: "guest-1", username: "GuestUser" },
        moveSync: { hostSubmitted: false, guestSubmitted: false, submittedCount: 0, bothSubmitted: false, updatedAt: null },
        hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
        guestHand: { fire: 2, water: 2, earth: 2, wind: 2 }
      }
    },
    actions: {}
  });
  const warHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "HostUser",
    joinCode: "AAA222",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      room: {
        roomCode: "AAA222",
        status: "full",
        host: { socketId: "host-1", username: "HostUser" },
        guest: { socketId: "guest-1", username: "GuestUser" },
        warActive: true,
        warDepth: 1,
        warRounds: [{ round: 1, hostMove: "fire", guestMove: "fire", outcomeType: "war" }],
        moveSync: { hostSubmitted: false, guestSubmitted: false, submittedCount: 0, bothSubmitted: false, updatedAt: null },
        hostHand: { fire: 1, water: 2, earth: 2, wind: 2 },
        guestHand: { fire: 1, water: 2, earth: 2, wind: 2 }
      }
    },
    actions: {}
  });
  const completeHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "HostUser",
    joinCode: "AAA222",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      room: {
        roomCode: "AAA222",
        status: "full",
        matchComplete: true,
        winner: "host",
        winReason: "hand_exhaustion",
        host: { socketId: "host-1", username: "HostUser" },
        guest: { socketId: "guest-1", username: "GuestUser" },
        rematch: { hostReady: false, guestReady: false },
        rewardSettlement: {
          granted: true,
          summary: {
            granted: true,
            winner: "host",
            settledHostUsername: "HostUser",
            settledGuestUsername: "GuestUser",
            hostRewards: { tokens: 25, xp: 20, basicChests: 1 },
            guestRewards: { tokens: 5, xp: 5, basicChests: 0 }
          }
        }
      }
    },
    actions: {}
  });
  const closingHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "HostUser",
    joinCode: "AAA222",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      room: {
        roomCode: "AAA222",
        status: "closing",
        matchComplete: true,
        winner: "host",
        winReason: "hand_exhaustion",
        host: { socketId: "host-1", username: "HostUser", connected: true },
        guest: { socketId: "guest-1", username: "GuestUser", connected: false },
        disconnectState: {
          active: true,
          disconnectedRole: "guest",
          disconnectedUsername: "GuestUser",
          remainingUsername: "HostUser",
          reason: "post_match_disconnect",
          expiresAt: null,
          resumedAt: null
        },
        rematch: { hostReady: false, guestReady: false },
        rewardSettlement: {
          granted: true,
          summary: {
            granted: true,
            winner: "host",
            settledHostUsername: "HostUser",
            settledGuestUsername: "GuestUser",
            hostRewards: { tokens: 25, xp: 20, basicChests: 1 },
            guestRewards: { tokens: 5, xp: 5, basicChests: 0 }
          }
        }
      }
    },
    actions: {}
  });

  assert.match(waitingHtml, /State:<\/strong> Waiting for Opponent/);
  assert.match(activeHtml, /State:<\/strong> Active Round/);
  assert.match(warHtml, /State:<\/strong> WAR Active/);
  assert.match(completeHtml, /State:<\/strong> Match Complete/);
  assert.match(closingHtml, /State:<\/strong> Room Closing/);
});

test("ui: reconnect countdown appears only in paused reconnect state", () => {
  const activeHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "HostUser",
    joinCode: "AAA222",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      room: {
        roomCode: "AAA222",
        status: "full",
        host: { socketId: "host-1", username: "HostUser" },
        guest: { socketId: "guest-1", username: "GuestUser" },
        moveSync: { hostSubmitted: false, guestSubmitted: false, submittedCount: 0, bothSubmitted: false, updatedAt: null },
        hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
        guestHand: { fire: 2, water: 2, earth: 2, wind: 2 }
      }
    },
    actions: {}
  });
  const pausedHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "HostUser",
    joinCode: "AAA222",
    now: Date.parse("2026-03-20T12:00:00.000Z"),
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      room: {
        roomCode: "AAA222",
        status: "paused",
        host: { socketId: "host-1", username: "HostUser" },
        guest: { socketId: "guest-1", username: "GuestUser" },
        disconnectState: {
          active: true,
          disconnectedRole: "guest",
          disconnectedUsername: "GuestUser",
          remainingUsername: "HostUser",
          reason: "waiting_for_reconnect",
          expiresAt: "2026-03-20T12:00:30.000Z",
          resumedAt: null
        }
      }
    },
    actions: {}
  });

  assert.doesNotMatch(activeHtml, /Reconnect Status/);
  assert.doesNotMatch(activeHtml, /Room Expires In:/);
  assert.match(pausedHtml, /Room Expires In:<\/strong> 00:30/);
});

test("ui: online play screen renders local and opponent cosmetics from synced room identity data", () => {
  const hostResolvedIdentity = {
    slotLabel: "Host",
    username: "LocalUser",
    connected: true,
    avatarId: "avatar_fourfold_lord",
    titleId: "title_war_master",
    badgeId: "badge_arena_legend",
    avatarImage: getAvatarImage("avatar_fourfold_lord"),
    backgroundImage: getArenaBackground("bg_elemental_throne"),
    cardBackId: "cardback_elemental_nexus",
    cardBackImage: getCardBackImage("cardback_elemental_nexus"),
    titleLabel: "War Master",
    badgeImage: getBadgeImage("badge_arena_legend"),
    variantSelection: {
      fire: "fire_variant_phoenix",
      water: "water_variant_crystal",
      earth: "earth_variant_titan",
      wind: "wind_variant_storm_eye"
    },
    variantImages: getVariantCardImages({
      fire: "fire_variant_phoenix",
      water: "water_variant_crystal",
      earth: "earth_variant_titan",
      wind: "wind_variant_storm_eye"
    })
  };
  const guestResolvedIdentity = {
    slotLabel: "Guest",
    username: "RemoteUser",
    connected: true,
    avatarId: "avatar_storm_oracle",
    titleId: "title_element_sovereign",
    badgeId: "badge_element_veteran",
    avatarImage: getAvatarImage("avatar_storm_oracle"),
    backgroundImage: getArenaBackground("bg_storm_temple"),
    cardBackId: "cardback_storm_spiral",
    cardBackImage: getCardBackImage("cardback_storm_spiral"),
    titleLabel: "Element Sovereign",
    badgeImage: getBadgeImage("badge_element_veteran"),
    variantSelection: {
      fire: "fire_variant_ember",
      water: "water_variant_tidal_spirit",
      earth: "earth_variant_rooted_monolith",
      wind: "wind_variant_sky_serpent"
    },
    variantImages: getVariantCardImages({
      fire: "fire_variant_ember",
      water: "water_variant_tidal_spirit",
      earth: "earth_variant_rooted_monolith",
      wind: "wind_variant_sky_serpent"
    })
  };
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "LocalUser",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      room: {
        roomCode: "ABC123",
        status: "full",
        hostResolvedIdentity,
        guestResolvedIdentity,
        host: {
          socketId: "host-1",
          username: "LocalUser",
          equippedCosmetics: {
            avatar: "avatar_fourfold_lord",
            background: "bg_elemental_throne",
            cardBack: "cardback_elemental_nexus",
            elementCardVariant: {
              fire: "fire_variant_phoenix",
              water: "water_variant_crystal",
              earth: "earth_variant_titan",
              wind: "wind_variant_storm_eye"
            },
            title: "War Master",
            badge: "badge_arena_legend"
          }
        },
        guest: {
          socketId: "guest-1",
          username: "RemoteUser",
          equippedCosmetics: {
            avatar: "avatar_storm_oracle",
            background: "bg_storm_temple",
            cardBack: "cardback_storm_spiral",
            elementCardVariant: {
              fire: "fire_variant_ember",
              water: "water_variant_tidal_spirit",
              earth: "earth_variant_rooted_monolith",
              wind: "wind_variant_sky_serpent"
            },
            title: "Element Sovereign",
            badge: "badge_element_veteran"
          }
        },
        moveSync: { hostSubmitted: false, guestSubmitted: false, submittedCount: 0, bothSubmitted: false, updatedAt: null },
        hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
        guestHand: { fire: 2, water: 2, earth: 2, wind: 2 }
      }
    },
    actions: {}
  });

  assert.match(html, new RegExp(getAvatarImage("avatar_fourfold_lord").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(getAvatarImage("avatar_storm_oracle").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(getArenaBackground("bg_elemental_throne").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(getArenaBackground("bg_storm_temple").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(getCardBackImage("cardback_elemental_nexus").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(getCardBackImage("cardback_storm_spiral").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /<span>War Master<\/span>/);
  assert.match(html, /<span>Element Sovereign<\/span>/);
  assert.match(html, /class="player-avatar"/);
  assert.match(html, /class="online-player-card-back-chip rarity-legendary"/);
  assert.match(html, /class="hand-slot-count-badge"/);
  assert.match(html, /class="featured-badge"/);
  assert.match(html, /hand-slot[^"]*rarity-legendary/);
  assert.match(html, /hidden-hand-summary rarity-rare/);
  assert.match(html, /data-preview-type="avatar"/);
  assert.match(html, /data-preview-type="title"/);
  assert.match(html, /data-preview-type="badge"/);
  assert.match(html, /data-preview-src="[^"]*title_war_master\.png"/);
  assert.match(html, /data-preview-src="[^"]*title_element_sovereign\.png"/);
  assert.match(html, /data-preview-description="Level Reward: Reach Level 50\."/);
  assert.match(html, /data-preview-description="Level Reward: Reach Level 60\."/);
  assert.match(html, new RegExp(getVariantCardImages({ fire: "fire_variant_phoenix" }).fire.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(getCardBackImage("cardback_storm_spiral").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("ui: online play screen keeps cosmetics and settled sides aligned through resume and closing states", () => {
  const hostResolvedIdentity = {
    slotLabel: "Host",
    username: "LocalUser",
    connected: true,
    avatarImage: getAvatarImage("avatar_fourfold_lord"),
    backgroundImage: getArenaBackground("bg_elemental_throne"),
    cardBackImage: getCardBackImage("cardback_elemental_nexus"),
    titleLabel: "War Master",
    badgeImage: getBadgeImage("badge_arena_legend"),
    variantImages: getVariantCardImages({
      fire: "fire_variant_phoenix",
      water: "water_variant_crystal",
      earth: "earth_variant_titan",
      wind: "wind_variant_storm_eye"
    })
  };
  const guestResolvedIdentity = {
    slotLabel: "Guest",
    username: "RemoteUser",
    connected: true,
    avatarImage: getAvatarImage("avatar_storm_oracle"),
    backgroundImage: getArenaBackground("bg_storm_temple"),
    cardBackImage: getCardBackImage("cardback_storm_spiral"),
    titleLabel: "Element Sovereign",
    badgeImage: getBadgeImage("badge_element_veteran"),
    variantImages: getVariantCardImages({
      fire: "fire_variant_ember",
      water: "water_variant_tidal_spirit",
      earth: "earth_variant_rooted_monolith",
      wind: "wind_variant_sky_serpent"
    })
  };
  const resumedHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "RemoteUser",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "guest-2",
      room: {
        roomCode: "ABC123",
        status: "full",
        hostResolvedIdentity,
        guestResolvedIdentity,
        host: {
          socketId: "host-1",
          username: "LocalUser",
          equippedCosmetics: {
            avatar: "avatar_fourfold_lord",
            background: "bg_elemental_throne",
            cardBack: "cardback_elemental_nexus",
            elementCardVariant: {
              fire: "fire_variant_phoenix",
              water: "water_variant_crystal",
              earth: "earth_variant_titan",
              wind: "wind_variant_storm_eye"
            },
            title: "War Master",
            badge: "badge_arena_legend"
          }
        },
        guest: {
          socketId: "guest-2",
          username: "RemoteUser",
          equippedCosmetics: {
            avatar: "avatar_storm_oracle",
            background: "bg_storm_temple",
            cardBack: "cardback_storm_spiral",
            elementCardVariant: {
              fire: "fire_variant_ember",
              water: "water_variant_tidal_spirit",
              earth: "earth_variant_rooted_monolith",
              wind: "wind_variant_sky_serpent"
            },
            title: "Element Sovereign",
            badge: "badge_element_veteran"
          }
        },
        disconnectState: {
          active: false,
          disconnectedRole: null,
          disconnectedUsername: null,
          remainingUsername: null,
          reason: "match_resumed",
          expiresAt: null,
          resumedAt: "2026-03-20T12:00:10.000Z"
        },
        moveSync: { hostSubmitted: false, guestSubmitted: false, submittedCount: 0, bothSubmitted: false, updatedAt: null },
        hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
        guestHand: { fire: 2, water: 2, earth: 2, wind: 2 }
      }
    },
    actions: {}
  });
  const closingHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "RemoteUser",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "guest-2",
      room: {
        roomCode: "ABC123",
        status: "closing",
        hostResolvedIdentity,
        guestResolvedIdentity,
        matchComplete: true,
        winner: "host",
        winReason: "hand_exhaustion",
        host: {
          socketId: "host-1",
          username: "LocalUser",
          connected: false,
          equippedCosmetics: {
            avatar: "avatar_fourfold_lord",
            background: "bg_elemental_throne",
            cardBack: "cardback_elemental_nexus",
            elementCardVariant: {
              fire: "fire_variant_phoenix",
              water: "water_variant_crystal",
              earth: "earth_variant_titan",
              wind: "wind_variant_storm_eye"
            },
            title: "War Master",
            badge: "badge_arena_legend"
          }
        },
        guest: {
          socketId: "guest-2",
          username: "RemoteUser",
          connected: true,
          equippedCosmetics: {
            avatar: "avatar_storm_oracle",
            background: "bg_storm_temple",
            cardBack: "cardback_storm_spiral",
            elementCardVariant: {
              fire: "fire_variant_ember",
              water: "water_variant_tidal_spirit",
              earth: "earth_variant_rooted_monolith",
              wind: "wind_variant_sky_serpent"
            },
            title: "Element Sovereign",
            badge: "badge_element_veteran"
          }
        },
        disconnectState: {
          active: true,
          disconnectedRole: "host",
          disconnectedUsername: "LocalUser",
          remainingUsername: "RemoteUser",
          reason: "post_match_disconnect",
          expiresAt: null,
          resumedAt: null
        },
        rematch: { hostReady: false, guestReady: false },
        rewardSettlement: {
          granted: true,
          summary: {
            granted: true,
            winner: "host",
            settledHostUsername: "LocalUser",
            settledGuestUsername: "RemoteUser",
            hostRewards: { tokens: 25, xp: 20, basicChests: 1 },
            guestRewards: { tokens: 5, xp: 5, basicChests: 0 }
          }
        }
      }
    },
    actions: {}
  });

  assert.match(resumedHtml, /State:<\/strong> Match Resumed/);
  assert.match(resumedHtml, /<span>War Master<\/span>/);
  assert.match(resumedHtml, /<span>Element Sovereign<\/span>/);
  assert.match(resumedHtml, new RegExp(getAvatarImage("avatar_fourfold_lord").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(resumedHtml, new RegExp(getAvatarImage("avatar_storm_oracle").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(closingHtml, /Winner:<\/strong> You Lose/);
  assert.match(closingHtml, /Reconnect:<\/strong> LocalUser disconnected after match completion\./);
});

test("ui: appController shows disconnected-player reconnect reminder with room code and countdown", () => {
  const previousDocument = global.document;
  const previousDateNow = Date.now;
  const modalCalls = [];
  let reminderModalVisible = false;

  global.document = {
    querySelector: (selector) => {
      if (selector === "[data-online-reconnect-reminder='true']") {
        return reminderModalVisible ? {} : null;
      }

      if (selector === ".modal-overlay") {
        return reminderModalVisible ? {} : null;
      }

      return null;
    }
  };
  Date.now = () => Date.parse("2026-03-20T12:00:00.000Z");

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => {
        reminderModalVisible = true;
        modalCalls.push(payload);
      },
      hide: () => {
        reminderModalVisible = false;
      }
    },
    toastManager: {
      show: () => {}
    }
  });

  try {
    controller.username = "ResumeGuest";
    controller.screenFlow = "menu";
    controller.onlineReconnectReminder = {
      username: "ResumeGuest",
      roomCode: "ABC123",
      expiresAt: "2026-03-20T12:01:00.000Z"
    };

    controller.updateOnlineReconnectReminderModal();

    assert.equal(modalCalls.length, 1);
    assert.equal(modalCalls[0].title, "Reconnect to Online Match");
    assert.match(modalCalls[0].bodyHtml, /Room Code:<\/strong> ABC123/);
    assert.match(modalCalls[0].bodyHtml, /Time Remaining:<\/strong> 01:00/);
    assert.match(modalCalls[0].bodyHtml, /You have 60 seconds to return before the room expires as no contest\./);
  } finally {
    Date.now = previousDateNow;
    global.document = previousDocument;
  }
});

test("ui: appController reconnect reminder reuses authoritative room expiry when available", () => {
  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: () => {},
      hide: () => {}
    },
    toastManager: {
      show: () => {}
    }
  });
  controller.username = "ResumeGuest";

  controller.maybeCaptureOnlineReconnectReminder(
    {
      room: {
        roomCode: "ABC123",
        status: "full",
        matchComplete: false,
        host: { username: "ResumeHost" },
        guest: { username: "ResumeGuest" },
        disconnectState: {
          expiresAt: "2026-03-20T12:01:17.000Z"
        }
      }
    },
    {
      connectionStatus: "disconnected",
      room: null
    }
  );

  assert.deepEqual(controller.onlineReconnectReminder, {
    username: "ResumeGuest",
    roomCode: "ABC123",
    expiresAt: "2026-03-20T12:01:17.000Z"
  });
});

test("ui: screen transitions clear a stale modal overlay before showing the next screen", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const shown = [];
  let hideCalls = 0;
  let modalVisible = true;

  global.document = {
    querySelector: (selector) => {
      if (selector === ".modal-overlay") {
        return modalVisible ? {} : null;
      }
      if (selector === "[data-online-reconnect-reminder='true']") {
        return null;
      }
      return null;
    },
    body: {
      classList: {
        toggle: () => {}
      }
    }
  };

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (screenId, context) => shown.push({ screenId, context })
    },
    modalManager: {
      show: () => {},
      hide: () => {
        hideCalls += 1;
        modalVisible = false;
      },
      clearStaleOverlay: () => {
        if (!modalVisible) {
          return false;
        }

        hideCalls += 1;
        modalVisible = false;
        return true;
      }
    },
    toastManager: {
      show: () => {}
    }
  });

  controller.username = "OverlayUser";
  controller.profile = {
    username: "OverlayUser",
    tokens: 100,
    playerXP: 0,
    cosmetics: { background: "default_background" },
    equippedCosmetics: {
      avatar: "default_avatar",
      title: "Initiate",
      badge: "none",
      background: "default_background",
      cardBack: "default_card_back",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    }
  };

  global.window = {
    elemintz: {
      state: {
        getProfile: async () => controller.profile,
        getCosmetics: async () => ({
          equipped: controller.profile.equippedCosmetics,
          catalog: {
            avatar: [],
            cardBack: [],
            background: [],
            elementCardVariant: [],
            badge: [],
            title: []
          }
        }),
        listProfiles: async () => [],
        getStore: async () => ({
          tokens: 100,
          catalog: {
            avatar: [],
            title: [],
            badge: [],
            cardBack: [],
            elementCardVariant: []
          }
        })
      }
    }
  };

  try {
    controller.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await controller.showProfile();
    await controller.showStore();

    assert.deepEqual(
      shown.map((entry) => entry.screenId),
      ["menu", "profile", "store"]
    );
    assert.equal(hideCalls, 1);
    assert.equal(modalVisible, false);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: game HUD refresh preserves an active quit confirmation modal", () => {
  const previousDocument = global.document;
  const shown = [];
  let clearCalls = 0;

  global.document = {
    querySelector: (selector) => {
      if (selector === ".modal-overlay .modal h3") {
        return { textContent: "Leave Match" };
      }
      return null;
    },
    body: {
      classList: {
        toggle: () => {}
      }
    }
  };

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (screenId, context) => shown.push({ screenId, context })
    },
    modalManager: {
      show: () => {},
      hide: () => {},
      clearStaleOverlay: () => {
        clearCalls += 1;
        return true;
      }
    },
    toastManager: { show: () => {} }
  });

  controller.username = "QuitTester";
  controller.profile = {
    username: "QuitTester",
    title: "Initiate",
    cosmetics: { background: "default_background" },
    equippedCosmetics: {
      avatar: "default_avatar",
      background: "default_background",
      cardBack: "default_card_back",
      badge: "none",
      title: "Initiate"
    }
  };
  controller.settings = {
    gameplay: { timerSeconds: 30 },
    aiDifficulty: "normal",
    aiOpponentStyle: "default",
    ui: { reducedMotion: false },
    audio: { enabled: true }
  };
  controller.gameController = {
    pauseLocalTurnTimer: () => {},
    resumeLocalTurnTimer: () => {},
    getViewModel: () => ({
      status: "active",
      mode: MATCH_MODE.PVE,
      roundOutcome: { key: "no_effect", label: "No effect" },
      roundResult: "No effect.",
      round: 1,
      timerSeconds: 18,
      totalMatchSeconds: 300,
      canSelectCard: true,
      playerHand: ["fire"],
      opponentHand: ["water"],
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      captured: { p1: 0, p2: 0 },
      lastRound: null
    })
  };

  try {
    controller.showGame();
    controller.showGame();

    assert.equal(shown.length, 2);
    assert.equal(clearCalls, 0);
    assert.equal(shown.at(-1).screenId, "game");
  } finally {
    global.document = previousDocument;
  }
});

test("ui: game HUD refresh preserves an active match-complete modal for local PvE", () => {
  const previousDocument = global.document;
  const shown = [];
  let clearCalls = 0;

  global.document = {
    querySelector: (selector) => {
      if (selector === ".modal-overlay .modal h3") {
        return { textContent: "Match Complete" };
      }
      return null;
    },
    body: {
      classList: {
        toggle: () => {}
      }
    }
  };

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (screenId, context) => shown.push({ screenId, context })
    },
    modalManager: {
      show: () => {},
      hide: () => {},
      clearStaleOverlay: () => {
        clearCalls += 1;
        return true;
      }
    },
    toastManager: { show: () => {} }
  });

  controller.username = "PveCloser";
  controller.profile = {
    username: "PveCloser",
    title: "Initiate",
    cosmetics: { background: "default_background" },
    equippedCosmetics: {
      avatar: "default_avatar",
      background: "default_background",
      cardBack: "default_card_back",
      badge: "none",
      title: "Initiate"
    }
  };
  controller.settings = {
    gameplay: { timerSeconds: 30 },
    aiDifficulty: "normal",
    aiOpponentStyle: "default",
    ui: { reducedMotion: false },
    audio: { enabled: true }
  };
  controller.gameController = {
    stopTimer: () => {},
    pauseLocalTurnTimer: () => {},
    resumeLocalTurnTimer: () => {},
    getViewModel: () => ({
      status: "completed",
      mode: MATCH_MODE.PVE,
      roundOutcome: { key: "resolved", label: "Victory" },
      roundResult: "Victory.",
      round: 8,
      timerSeconds: 0,
      totalMatchSeconds: 300,
      canSelectCard: false,
      playerHand: [],
      opponentHand: [],
      pileCount: 0,
      totalWarClashes: 1,
      warPileCards: [],
      captured: { p1: 8, p2: 0 },
      lastRound: null
    })
  };
  controller.screenFlow = "game";

  try {
    controller.handleGameUpdate();

    assert.equal(shown.length, 1);
    assert.equal(shown.at(-1).screenId, "game");
    assert.equal(clearCalls, 0);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: game HUD timer updates patch the existing screen in place when live state is otherwise unchanged", () => {
  const previousDocument = global.document;
  const shown = [];
  const hudLine = { textContent: "" };
  const baseContext = {
    game: {
      status: "active",
      winner: null,
      endReason: null,
      round: 3,
      mode: MATCH_MODE.PVE,
      hotseatTurn: "p1",
      hotseatPending: false,
      playerHand: ["fire", "water"],
      opponentHand: ["earth", "wind"],
      warActive: false,
      pileCount: 0,
      totalWarClashes: 0,
      warPileCards: [],
      warPileSizes: [],
      captured: { p1: 2, p2: 1 },
      lastRound: null,
      roundResult: "Choose a card to begin the next clash.",
      roundOutcome: { key: "no_effect" },
      canSelectCard: true,
      timerSeconds: 18,
      totalMatchSeconds: 244
    },
    hotseat: {
      enabled: false,
      activePlayer: "p1",
      p1Name: "Player 1",
      p2Name: "Elemental AI",
      turnLabel: "Player Turn"
    },
    presentation: {
      phase: "idle",
      busy: false,
      selectedCardIndex: null
    }
  };
  const root = {
    getAttribute: (name) =>
      name === "data-game-live-update-signature" ? buildGameLiveUpdateSignature(baseContext) : null
  };

  global.document = {
    querySelector: (selector) => (selector === ".screen-game" ? root : null),
    getElementById: (id) => (id === "game-hud-primary-line" ? hudLine : null)
  };

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (screenId) => shown.push(screenId)
    },
    modalManager: {
      show: () => {},
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  controller.screenFlow = "game";
  controller.gameController = {
    getViewModel: () => ({
      ...baseContext.game,
      timerSeconds: 17,
      totalMatchSeconds: 243
    })
  };

  try {
    controller.handleGameUpdate();

    assert.equal(shown.length, 0);
    assert.equal(
      hudLine.textContent,
      buildGameHudPrimaryLine({
        ...baseContext,
        game: {
          ...baseContext.game,
          timerSeconds: 17,
          totalMatchSeconds: 243
        }
      })
    );
  } finally {
    global.document = previousDocument;
  }
});

test("ui: taunt HUD ticks refresh the active game screen in place without calling showGame", async () => {
  const previousDocument = global.document;
  const fixedNow = 1_700_000_000_000;
  const toggleButton = createFakeElement();
  const tauntOption = {
    listeners: new Map(),
    getAttribute: (name) => (name === "data-taunt-line" ? "Your move." : null),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
  };
  const shell = {
    className: "match-taunt-shell",
    innerHTML: "",
    querySelector: (selector) => (selector === "#game-taunts-toggle-btn" ? toggleButton : null),
    querySelectorAll: (selector) => (selector === "[data-taunt-line]" ? [tauntOption] : [])
  };
  const shown = [];

  global.document = {
    querySelector: (selector) => (selector === '[data-match-taunt-shell="game"]' ? shell : null)
  };

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (screenId) => shown.push(screenId)
    },
    modalManager: {
      show: () => {},
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  controller.screenFlow = "game";
  controller.matchTauntPanelOpen = true;
  controller.getTauntNow = () => fixedNow;
  controller.matchTaunts = [
    {
      id: "taunt-1",
      speaker: "Hero",
      text: "Well played.",
      kind: "player",
      createdAt: fixedNow,
      fadeAt: fixedNow + 1000,
      expiresAt: fixedNow + 2000
    }
  ];
  controller.playerTauntCooldowns = { "user:Hero": fixedNow + 7000 };
  controller.username = "Hero";

  let toggleCalls = 0;
  let sendCalls = 0;
  controller.toggleMatchTauntPanel = () => {
    toggleCalls += 1;
  };
  controller.sendCurrentMatchTaunt = async () => {
    sendCalls += 1;
  };

  try {
    controller.refreshTauntHudIfNeeded();
    assert.equal(shown.length, 0);
    assert.match(shell.className, /is-open/);
    assert.match(shell.innerHTML, /Well played\./);
    assert.match(shell.innerHTML, />\s*7s\s*</);

    await toggleButton.listeners.get("click")();
    await tauntOption.listeners.get("click")();

    assert.equal(toggleCalls, 1);
    assert.equal(sendCalls, 1);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: taunt HUD ticks refresh the active online screen in place without calling renderOnlinePlayScreen", async () => {
  const previousDocument = global.document;
  const fixedNow = 1_700_000_000_000;
  const shell = {
    className: "match-taunt-shell",
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => []
  };
  let renderCalls = 0;

  global.document = {
    querySelector: (selector) => (selector === '[data-match-taunt-shell="online"]' ? shell : null)
  };

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: () => {},
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  controller.screenFlow = "onlinePlay";
  controller.getTauntNow = () => fixedNow;
  controller.username = "HostUser";
  controller.playerTauntCooldowns = { "online:host": fixedNow + 5000 };
  controller.onlinePlayState = {
    socketId: "socket-host",
    room: {
      status: "full",
      host: { socketId: "socket-host" },
      guest: { socketId: "socket-guest" },
      taunts: [
        {
          id: "taunt-online-1",
          speaker: "HostUser",
          text: "Your move.",
          kind: "player",
          sentAt: new Date(fixedNow).toISOString()
        }
      ]
    }
  };
  controller.renderOnlinePlayScreen = () => {
    renderCalls += 1;
  };

  try {
    controller.refreshTauntHudIfNeeded();

    assert.equal(renderCalls, 0);
    assert.match(shell.innerHTML, /Your move\./);
    assert.match(shell.innerHTML, />\s*5s\s*</);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: appController preserves an intentional settings modal when the settings screen rerenders", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const shown = [];
  const modalCalls = [];
  let hideCalls = 0;

  global.window = {
    elemintz: {
      state: {
        getSettings: async () => ({
          gameplay: { timerSeconds: 30 },
          aiDifficulty: "normal",
          aiOpponentStyle: "default",
          ui: { reducedMotion: false },
          audio: { enabled: true }
        }),
        updateSettings: async (patch) => ({
          gameplay: { timerSeconds: patch?.gameplay?.timerSeconds ?? 30 },
          aiDifficulty: "normal",
          aiOpponentStyle: "default",
          ui: { reducedMotion: false },
          audio: { enabled: true }
        })
      }
    }
  };

  global.document = {
    body: {
      classList: {
        toggle: () => {}
      }
    }
  };

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (_screenId, context) => shown.push(context)
    },
    modalManager: {
      show: (payload) => {
        modalCalls.push(payload);
      },
      hide: () => {
        hideCalls += 1;
      },
      clearStaleOverlay: () => false
    },
    toastManager: {
      show: () => {}
    }
  });

  try {
    await controller.showSettings();
    await shown.at(-1).actions.save({ gameplay: { timerSeconds: 45 } });

    assert.equal(modalCalls.length, 1);
    assert.equal(modalCalls[0].title, "Settings Saved");
    assert.equal(hideCalls, 0);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: appController online room identity payload reads nested cosmetics.equipped values", async () => {
  const previousWindow = global.window;
  const createRoomCalls = [];

  global.window = {
    elemintz: {
      state: {
        getProfile: async () => ({
          username: "LocalUser",
          equippedCosmetics: {
            avatar: "default_avatar"
          },
          cosmetics: {
            equipped: {
              avatar: "avatar_fourfold_lord",
              background: "bg_elemental_throne",
              cardBack: "cardback_elemental_nexus",
              badge: "badge_arena_legend",
              title: "title_war_master",
              elementCardVariant: {
                fire: "fire_variant_phoenix",
                water: "water_variant_crystal",
                earth: "earth_variant_titan",
                wind: "wind_variant_storm_eye"
              }
            }
          }
        })
      },
      multiplayer: {
        createRoom: async (payload) => {
          createRoomCalls.push(payload);
          return {
            connectionStatus: "connected",
            socketId: "host-1",
            room: null,
            latestRoundResult: null,
            lastError: null,
            statusMessage: "created"
          };
        }
      }
    }
  };

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (_screenId, context) => {
        controller.__lastOnlineContext = context;
      }
    },
    modalManager: {
      show: () => {},
      hide: () => {}
    },
    toastManager: {
      show: () => {}
    }
  });

  try {
    controller.username = "LocalUser";
    controller.profile = { username: "LocalUser" };
    controller.onlinePlayState = null;
    controller.renderOnlinePlayScreen();
    await controller.__lastOnlineContext.actions.createRoom();

    assert.equal(createRoomCalls.length, 1);
    assert.deepEqual(createRoomCalls[0], {
      username: "LocalUser",
      visibility: "private",
      equippedCosmetics: {
        avatar: "avatar_fourfold_lord",
        background: "bg_elemental_throne",
        cardBack: "cardback_elemental_nexus",
        badge: "badge_arena_legend",
        title: "title_war_master",
        elementCardVariant: {
          fire: "fire_variant_phoenix",
          water: "water_variant_crystal",
          earth: "earth_variant_titan",
          wind: "wind_variant_storm_eye"
        }
      }
    });
  } finally {
    global.window = previousWindow;
  }
});

test("ui: appController clears reconnect reminder after resume and after expiry", () => {
  const previousDocument = global.document;
  const previousDateNow = Date.now;
  let reminderModalVisible = true;
  let hideCalls = 0;

  global.document = {
    querySelector: (selector) => {
      if (selector === "[data-online-reconnect-reminder='true']") {
        return reminderModalVisible ? {} : null;
      }

      if (selector === ".modal-overlay") {
        return reminderModalVisible ? {} : null;
      }

      return null;
    }
  };

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: () => {},
      hide: () => {
        hideCalls += 1;
        reminderModalVisible = false;
      }
    },
    toastManager: {
      show: () => {}
    }
  });

  try {
    controller.username = "ResumeGuest";
    controller.screenFlow = "profile";
    Date.now = () => Date.parse("2026-03-20T12:00:00.000Z");
    controller.onlineReconnectReminder = {
      username: "ResumeGuest",
      roomCode: "ABC123",
      expiresAt: "2026-03-20T12:01:00.000Z"
    };

    controller.clearOnlineReconnectReminderFromState({
      room: {
        roomCode: "ABC123",
        status: "full",
        host: { username: "ResumeHost" },
        guest: { username: "ResumeGuest" }
      },
      lastError: null
    });

    assert.equal(controller.onlineReconnectReminder, null);
    assert.equal(hideCalls, 1);

    reminderModalVisible = true;
    controller.onlineReconnectReminder = {
      username: "ResumeGuest",
      roomCode: "ABC123",
      expiresAt: "2026-03-20T12:00:10.000Z"
    };
    Date.now = () => Date.parse("2026-03-20T12:00:11.000Z");

    controller.clearOnlineReconnectReminderFromState({
      room: null,
      lastError: { code: "ROOM_EXPIRED" }
    });

    assert.equal(controller.onlineReconnectReminder, null);
    assert.equal(hideCalls, 2);
  } finally {
    Date.now = previousDateNow;
    global.document = previousDocument;
  }
});

test("ui: online play challenge visibility stays in the existing screen without adding a popup", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "GuestRewardUser",
    onlineChallengeSummary: {
      daily: {
        msUntilReset: 5400000,
        challenges: [
          {
            id: "daily_win_1_match",
            name: "Win 1 Match",
            progress: 1,
            goal: 1,
            completed: true
          }
        ]
      },
      weekly: {
        msUntilReset: 176400000,
        challenges: []
      }
    },
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "guest-1",
      statusMessage: "Match complete in room ABC123. Ready up for rematch.",
      lastError: null,
      room: {
        roomCode: "ABC123",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 5,
        guestScore: 3,
        roundNumber: 9,
        lastOutcomeType: "resolved",
        matchComplete: true,
        winner: "host",
        winReason: "hand_exhaustion",
        rewardSettlement: {
          granted: true,
          grantedAt: "2026-03-20T12:00:00.000Z",
          decision: {
            participants: {
              hostUsername: "HostRewardUser",
              guestUsername: "GuestRewardUser"
            },
            rewards: {
              host: { tokens: 25, xp: 20, basicChests: 1 },
              guest: { tokens: 5, xp: 5, basicChests: 0 }
            }
          },
          summary: {
            granted: true,
            winner: "host",
            settledHostUsername: "HostRewardUser",
            settledGuestUsername: "GuestRewardUser",
            hostRewards: { tokens: 25, xp: 20, basicChests: 1 },
            guestRewards: { tokens: 5, xp: 5, basicChests: 0 }
          }
        },
        rematch: { hostReady: false, guestReady: false },
        hostHand: { fire: 3, water: 2, earth: 4, wind: 3 },
        guestHand: { fire: 1, water: 1, earth: 0, wind: 1 },
        warPot: { host: [], guest: [] },
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: []
      }
    },
    actions: {}
  });

  assert.match(html, /Online Play/);
  assert.match(html, /Match Complete/);
  assert.match(html, /Daily Progress/);
  assert.doesNotMatch(html, /modal/i);
});

test("ui: appController online challenge summary uses signed-in settled identity and survives host migration", async () => {
  const shown = [];
  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (_screen, context) => {
        shown.push(context);
      }
    },
    modalManager: {
      show: () => {},
      hide: () => {}
    },
    toastManager: {
      show: () => {}
    }
  });

  const previousWindow = global.window;
  controller.username = "SettledGuestUser";
  controller.profile = {
    equippedCosmetics: {
      background: "default_background"
    }
  };
  controller.onlinePlayState = controller.normalizeOnlinePlayState({
    connectionStatus: "connected",
    socketId: "guest-1",
    room: {
      roomCode: "ABC123",
      status: "waiting",
      host: { socketId: "guest-1", username: "SettledGuestUser" },
      guest: null,
      hostScore: 5,
      guestScore: 3,
      roundNumber: 9,
      lastOutcomeType: "resolved",
      matchComplete: true,
      winner: "host",
      winReason: "hand_exhaustion",
      rewardSettlement: {
        granted: true,
        grantedAt: "2026-03-20T12:00:00.000Z",
        summary: {
          granted: true,
          winner: "host",
          settledHostUsername: "SettledHostUser",
          settledGuestUsername: "SettledGuestUser",
          hostRewards: { tokens: 25, xp: 20, basicChests: 1 },
          guestRewards: { tokens: 5, xp: 5, basicChests: 0 }
        }
      },
      rematch: { hostReady: false, guestReady: false },
      hostHand: { fire: 3, water: 2, earth: 4, wind: 3 },
      guestHand: { fire: 1, water: 1, earth: 0, wind: 1 },
      warPot: { host: [], guest: [] },
      warActive: false,
      warDepth: 0,
      warRounds: [],
      roundHistory: []
    }
  });

  global.window = {
    elemintz: {
      state: {
        getDailyChallenges: async (username) => ({
          daily: {
            msUntilReset: 5400000,
            challenges: [
              {
                id: "daily_play_5_matches",
                name: `Daily for ${username}`,
                progress: 1,
                goal: 5,
                completed: false
              }
            ]
          },
          weekly: {
            msUntilReset: 176400000,
            challenges: [
              {
                id: "weekly_play_15_matches",
                name: `Weekly for ${username}`,
                progress: 1,
                goal: 15,
                completed: false
              }
            ]
          }
        })
      }
    }
  };

  try {
    await controller.refreshOnlinePlayChallengeSummary(controller.onlinePlayState);
    controller.renderOnlinePlayScreen();
  } finally {
    global.window = previousWindow;
  }

  const latest = shown.at(-1);
  assert.equal(latest.username, "SettledGuestUser");
  assert.equal(latest.onlineChallengeSummary.daily.challenges[0].name, "Daily for SettledGuestUser");
  assert.equal(latest.onlineChallengeSummary.weekly.challenges[0].name, "Weekly for SettledGuestUser");
});

test("ui: appController refreshes local settled online win progression immediately after settlement", async () => {
  const previousWindow = global.window;
  const shown = [];
  const updatedProfile = {
    username: "OnlineWinner",
    playerLevel: 3,
    playerXP: 48,
    tokens: 225,
    chests: { basic: 1 },
    achievements: { first_flame: { count: 1 } },
    cosmeticRandomizeAfterMatch: {
      avatar: true,
      title: false,
      badge: false,
      elementCardVariant: false,
      cardBack: false,
      background: true
    },
    equippedCosmetics: {
      avatar: "default_avatar",
      background: "default_background"
    },
    dailyChallenges: { daily: { progress: { matchesPlayed: 1 } } },
    weeklyChallenges: { weekly: { progress: { matchesPlayed: 1 } } },
    modeStats: { online_pvp: { wins: 1, losses: 0 } }
  };
  const randomizedProfile = {
    ...updatedProfile,
    equippedCosmetics: {
      avatar: "fire_avatar_f",
      background: "water_background"
    }
  };
  const randomizeCalls = [];
  const challengeStatus = {
    daily: { msUntilReset: 1000, challenges: [] },
    weekly: { msUntilReset: 2000, challenges: [] },
    dailyLogin: null
  };

  global.window = {
    elemintz: {
      state: {
        getProfile: async (username) => {
          assert.equal(username, "OnlineWinner");
          return updatedProfile;
        },
        randomizeOwnedCosmetics: async (payload) => {
          randomizeCalls.push(payload);
          return { profile: randomizedProfile };
        },
        getDailyChallenges: async (username) => {
          assert.equal(username, "OnlineWinner");
          return challengeStatus;
        }
      }
    }
  };

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { show: () => {} }
  });

  try {
    controller.username = "OnlineWinner";
    controller.profile = {
      username: "OnlineWinner",
      playerLevel: 1,
      playerXP: 0,
      tokens: 200,
      chests: { basic: 0 },
      achievements: {}
    };
    await controller.refreshLocalProfileAfterOnlineSettlement({
      room: {
        roomCode: "ABC123",
        matchComplete: true,
        rewardSettlement: {
          granted: true,
          grantedAt: "2026-03-20T12:00:00.000Z",
          summary: {
            settledHostUsername: "OnlineWinner",
            settledGuestUsername: "OtherUser"
          }
        }
      }
    });
    controller.renderOnlinePlayScreen();

    assert.equal(controller.profile.tokens, 225);
    assert.equal(controller.profile.playerXP, 48);
    assert.equal(controller.profile.playerLevel, 3);
    assert.equal(controller.profile.chests.basic, 1);
    assert.equal(controller.profile.achievements.first_flame.count, 1);
    assert.equal(controller.dailyChallenges.daily, challengeStatus.daily);
    assert.equal(controller.dailyChallenges.weekly, challengeStatus.weekly);
    assert.deepEqual(randomizeCalls, [
      {
        username: "OnlineWinner",
        categories: ["avatar", "background"]
      }
    ]);
    assert.equal(controller.profile.equippedCosmetics.avatar, "fire_avatar_f");
    assert.equal(shown.at(-1).backgroundImage, getArenaBackground("water_background"));
  } finally {
    global.window = previousWindow;
  }
});

test("ui: appController refreshes local settled online loss progression immediately after settlement", async () => {
  const previousWindow = global.window;
  const updatedProfile = {
    username: "OnlineLoser",
    playerLevel: 2,
    playerXP: 15,
    tokens: 205,
    chests: { basic: 0 },
    achievements: {},
    dailyChallenges: { daily: { progress: { matchesPlayed: 1 } } },
    weeklyChallenges: { weekly: { progress: { matchesPlayed: 1 } } }
  };

  global.window = {
    elemintz: {
      state: {
        getProfile: async (username) => {
          assert.equal(username, "OnlineLoser");
          return updatedProfile;
        },
        getDailyChallenges: async () => ({
          daily: { msUntilReset: 1000, challenges: [] },
          weekly: { msUntilReset: 2000, challenges: [] },
          dailyLogin: null
        })
      }
    }
  };

  const controller = createRendererController();

  try {
    controller.username = "OnlineLoser";
    controller.profile = { username: "OnlineLoser", tokens: 200, playerXP: 0, playerLevel: 1, chests: { basic: 0 }, achievements: {} };
    await controller.refreshLocalProfileAfterOnlineSettlement({
      room: {
        roomCode: "ABC123",
        matchComplete: true,
        rewardSettlement: {
          granted: true,
          grantedAt: "2026-03-20T12:01:00.000Z",
          summary: {
            settledHostUsername: "WinnerUser",
            settledGuestUsername: "OnlineLoser"
          }
        }
      }
    });

    assert.equal(controller.profile.tokens, 205);
    assert.equal(controller.profile.playerXP, 15);
    assert.equal(controller.profile.playerLevel, 2);
    assert.equal(controller.profile.chests.basic, 0);
  } finally {
    global.window = previousWindow;
  }
});

test("ui: appController refreshes local settled online draw progression immediately after settlement", async () => {
  const previousWindow = global.window;
  const updatedProfile = {
    username: "OnlineDrawer",
    playerLevel: 2,
    playerXP: 10,
    tokens: 210,
    chests: { basic: 0 },
    achievements: { stalemate: { count: 1 } }
  };

  global.window = {
    elemintz: {
      state: {
        getProfile: async (username) => {
          assert.equal(username, "OnlineDrawer");
          return updatedProfile;
        },
        getDailyChallenges: async () => ({
          daily: { msUntilReset: 1000, challenges: [] },
          weekly: { msUntilReset: 2000, challenges: [] },
          dailyLogin: null
        })
      }
    }
  };

  const controller = createRendererController();

  try {
    controller.username = "OnlineDrawer";
    controller.profile = { username: "OnlineDrawer", tokens: 200, playerXP: 0, playerLevel: 1, chests: { basic: 0 }, achievements: {} };
    await controller.refreshLocalProfileAfterOnlineSettlement({
      room: {
        roomCode: "ABC123",
        matchComplete: true,
        rewardSettlement: {
          granted: true,
          grantedAt: "2026-03-20T12:02:00.000Z",
          summary: {
            settledHostUsername: "OnlineDrawer",
            settledGuestUsername: "OtherDrawer"
          }
        }
      }
    });

    assert.equal(controller.profile.tokens, 210);
    assert.equal(controller.profile.playerXP, 10);
    assert.equal(controller.profile.playerLevel, 2);
    assert.equal(controller.profile.achievements.stalemate.count, 1);
  } finally {
    global.window = previousWindow;
  }
});

test("ui: profile opened immediately after settled online refresh shows persisted values", async () => {
  const previousWindow = global.window;
  const shown = [];
  const updatedProfile = {
    username: "ProfileWinner",
    title: "Initiate",
    playerLevel: 4,
    playerXP: 83,
    tokens: 245,
    chests: { basic: 2 },
    achievements: { first_flame: { count: 1 } },
    wins: 3,
    losses: 1,
    warsEntered: 2,
    warsWon: 1,
    longestWar: 3,
    cardsCaptured: 6,
    gamesPlayed: 4,
    bestWinStreak: 2,
    modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 }, online_pvp: { wins: 3, losses: 1 } },
    equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none", background: "default_background" }
  };

  global.window = {
    elemintz: {
      state: {
        getProfile: async () => updatedProfile,
        getDailyChallenges: async () => ({
          daily: { msUntilReset: 1000, challenges: [] },
          weekly: { msUntilReset: 2000, challenges: [] },
          dailyLogin: null,
          xp: {}
        }),
        getCosmetics: async () => ({
          equipped: updatedProfile.equippedCosmetics,
          catalog: { avatar: [], cardBack: [], background: [], elementCardVariant: [], badge: [], title: [] }
        }),
        listProfiles: async () => [updatedProfile]
      }
    }
  };

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { show: () => {} }
  });

  try {
    controller.username = "ProfileWinner";
    controller.profile = { username: "ProfileWinner", tokens: 200, playerXP: 0, playerLevel: 1, chests: { basic: 0 }, achievements: {}, equippedCosmetics: { background: "default_background" } };
    await controller.refreshLocalProfileAfterOnlineSettlement({
      room: {
        roomCode: "ABC123",
        matchComplete: true,
        rewardSettlement: {
          granted: true,
          grantedAt: "2026-03-20T12:03:00.000Z",
          summary: {
            settledHostUsername: "ProfileWinner",
            settledGuestUsername: "OtherUser"
          }
        }
      }
    });
    await controller.showProfile();

    const profileContext = shown.at(-1);
    assert.equal(profileContext.profile.tokens, 245);
    assert.equal(profileContext.profile.playerXP, 83);
    assert.equal(profileContext.profile.playerLevel, 4);
    assert.equal(profileContext.profile.chests.basic, 2);
  } finally {
    global.window = previousWindow;
  }
});

test("ui: online settlement refresh stays keyed to the local settled player and does not duplicate on repeats", async () => {
  const previousWindow = global.window;
  const shown = [];
  let getProfileCalls = 0;
  let getDailyChallengeCalls = 0;
  const updatedProfile = {
    username: "SettledGuestUser",
    playerLevel: 2,
    playerXP: 12,
    tokens: 205,
    chests: { basic: 0 },
    achievements: {}
  };

  global.window = {
    elemintz: {
      state: {
        getProfile: async (username) => {
          getProfileCalls += 1;
          assert.equal(username, "SettledGuestUser");
          return updatedProfile;
        },
        getDailyChallenges: async (username) => {
          getDailyChallengeCalls += 1;
          assert.equal(username, "SettledGuestUser");
          return {
            daily: { msUntilReset: 1000, challenges: [] },
            weekly: { msUntilReset: 2000, challenges: [] },
            dailyLogin: null
          };
        }
      },
      multiplayer: {
        onUpdate: (listener) => {
          global.__onlineListener = listener;
          return () => {};
        }
      }
    }
  };

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: { show: () => {}, hide: () => {} },
    toastManager: { show: () => {} }
  });

  try {
    controller.username = "SettledGuestUser";
    controller.profile = { username: "SettledGuestUser", tokens: 200, playerXP: 0, playerLevel: 1, chests: { basic: 0 }, achievements: {}, equippedCosmetics: { background: "default_background" } };
    controller.screenFlow = "onlinePlay";
    controller.bindOnlinePlayUpdates();

    const settledState = {
      connectionStatus: "connected",
      socketId: "guest-2",
      room: {
        roomCode: "ABC123",
        status: "waiting",
        matchComplete: true,
        host: { socketId: "host-2", username: "MigratedHost" },
        guest: null,
        rewardSettlement: {
          granted: true,
          grantedAt: "2026-03-20T12:04:00.000Z",
          summary: {
            settledHostUsername: "SettledHostUser",
            settledGuestUsername: "SettledGuestUser",
            hostRewards: { tokens: 25, xp: 20, basicChests: 1 },
            guestRewards: { tokens: 5, xp: 5, basicChests: 0 }
          }
        }
      }
    };

    global.__onlineListener(settledState);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    global.__onlineListener(settledState);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(controller.profile.username, "SettledGuestUser");
    assert.equal(controller.profile.tokens, 205);
    assert.equal(getProfileCalls, 1);
    assert.equal(getDailyChallengeCalls, 1);

    global.__onlineListener({
      ...settledState,
      room: {
        ...settledState.room,
        status: "full",
        matchComplete: false,
        rewardSettlement: null,
        rematch: { hostReady: false, guestReady: false }
      }
    });
    await Promise.resolve();

    assert.equal(controller.profile.tokens, 205);
    assert.ok(shown.length >= 1);
  } finally {
    delete global.__onlineListener;
    global.window = previousWindow;
  }
});

test("ui: online play screen keeps settled host rewards after guest disconnect", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    username: "HostRewardUser",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      statusMessage: "Match complete in room ABC123. Ready up for rematch.",
      lastError: null,
      latestRoundResult: {
        roomCode: "ABC123",
        hostMove: "fire",
        guestMove: "earth",
        outcomeType: "resolved",
        matchComplete: true,
        winner: "host",
        winReason: "hand_exhaustion",
        hostResult: "win",
        guestResult: "lose"
      },
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "waiting",
        host: { socketId: "host-1", username: "HostRewardUser" },
        guest: null,
        hostScore: 5,
        guestScore: 3,
        roundNumber: 9,
        lastOutcomeType: "resolved",
        matchComplete: true,
        winner: "host",
        winReason: "hand_exhaustion",
        rewardSettlement: {
          granted: true,
          grantedAt: "2026-03-20T12:00:00.000Z",
          decision: {
            participants: {
              hostUsername: "HostRewardUser",
              guestUsername: "GuestRewardUser"
            },
            rewards: {
              host: { tokens: 25, xp: 20, basicChests: 1 },
              guest: { tokens: 5, xp: 5, basicChests: 0 }
            }
          },
          summary: {
            granted: true,
            winner: "host",
            settledHostUsername: "HostRewardUser",
            settledGuestUsername: "GuestRewardUser",
            hostRewards: { tokens: 25, xp: 20, basicChests: 1 },
            guestRewards: { tokens: 5, xp: 5, basicChests: 0 }
          }
        },
        rematch: { hostReady: false, guestReady: false },
        hostHand: { fire: 3, water: 2, earth: 4, wind: 3 },
        guestHand: { fire: 1, water: 1, earth: 0, wind: 1 },
        warPot: { host: [], guest: [] },
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: []
      }
    },
    actions: {}
  });

  assert.match(html, /Winner:<\/strong> You Win/);
  assert.match(html, /You Gained:<\/strong> \+25 Tokens, \+20 XP, \+1 Basic Chest/);
});

test("ui: online play screen renders no effect and war result labels", () => {
  const noEffectHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      statusMessage: "No Effect Room ABC123",
      lastError: null,
      latestRoundResult: {
        roomCode: "ABC123",
        hostMove: "fire",
        guestMove: "wind",
        outcomeType: "no_effect",
        hostResult: "no_effect",
        guestResult: "no_effect"
      },
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: true,
          submittedCount: 2,
          bothSubmitted: true,
          updatedAt: "2026-03-19T12:00:05.000Z"
        }
      }
    },
    actions: {}
  });

  const warHtml = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "guest-1",
      statusMessage: "WAR Room ABC123",
      lastError: null,
      latestRoundResult: {
        roomCode: "ABC123",
        hostMove: "fire",
        guestMove: "fire",
        outcomeType: "war",
        hostResult: "war",
        guestResult: "war"
      },
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 0,
        guestScore: 0,
        roundNumber: 2,
        lastOutcomeType: "war",
        warActive: true,
        warDepth: 1,
        warRounds: [
          {
            round: 1,
            hostMove: "fire",
            guestMove: "fire",
            outcomeType: "war"
          }
        ],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: true,
          submittedCount: 2,
          bothSubmitted: true,
          updatedAt: "2026-03-19T12:00:05.000Z"
        }
      }
    },
    actions: {}
  });

  assert.match(noEffectHtml, /data-round-center-result="true"/);
  assert.match(noEffectHtml, /data-round-center-headline="true">NO EFFECT</);
  assert.match(noEffectHtml, /NO EFFECT/);
  assert.doesNotMatch(noEffectHtml, /Why:<\/strong>/);
  assert.doesNotMatch(noEffectHtml, /Changed:<\/strong>/);
  assert.match(warHtml, /data-round-center-result="true"/);
  assert.match(warHtml, /data-round-center-headline="true">WAR</);
  assert.match(warHtml, /WAR started/);
  assert.doesNotMatch(warHtml, /Why:<\/strong>/);
  assert.doesNotMatch(warHtml, /Changed:<\/strong>/);
});

test("ui: online play screen keeps rendering the preserved battle log after live sync fields clear", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "guest-1",
      statusMessage: "1/2 move submission received for room ABC123.",
      lastError: null,
      latestRoundResult: null,
      latestAuthoritativeRoundResult: null,
      lastCompletedBattleResult: {
        outcomeType: "resolved",
        hostMove: "fire",
        guestMove: "water",
        hostResult: "lose",
        guestResult: "win",
        roundNumber: 2,
        matchComplete: false
      },
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 0,
        guestScore: 1,
        roundNumber: 3,
        lastOutcomeType: "resolved",
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: false,
          submittedCount: 1,
          bothSubmitted: false,
          updatedAt: "2026-03-19T12:01:00.000Z"
        }
      }
    },
    actions: {}
  });

  assert.match(html, /WATER BEATS FIRE/);
  assert.doesNotMatch(html, /Why:<\/strong>/);
  assert.doesNotMatch(html, /Changed:<\/strong>/);
  assert.doesNotMatch(html, /Battle log will appear here\./);
});

test("ui: online play screen keeps rendering a preserved no-effect battle log after live sync fields clear", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      statusMessage: "1/2 move submission received for room ABC123.",
      lastError: null,
      latestRoundResult: null,
      latestAuthoritativeRoundResult: null,
      lastCompletedBattleResult: {
        outcomeType: "no_effect",
        hostMove: "fire",
        guestMove: "wind",
        hostResult: "no_effect",
        guestResult: "no_effect",
        roundNumber: 4,
        matchComplete: false
      },
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 1,
        guestScore: 1,
        roundNumber: 5,
        lastOutcomeType: "no_effect",
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: false,
          submittedCount: 1,
          bothSubmitted: false,
          updatedAt: "2026-03-19T12:01:00.000Z"
        }
      }
    },
    actions: {}
  });

  assert.match(html, /NO EFFECT/);
  assert.doesNotMatch(html, /Why:<\/strong>/);
  assert.doesNotMatch(html, /Battle log will appear here\./);
});

test("ui: online play screen keeps rendering a preserved war resolved battle log after live sync fields clear", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "guest-1",
      statusMessage: "1/2 move submission received for room ABC123.",
      lastError: null,
      latestRoundResult: null,
      latestAuthoritativeRoundResult: null,
      lastCompletedBattleResult: {
        outcomeType: "war_resolved",
        hostMove: "water",
        guestMove: "fire",
        hostResult: "win",
        guestResult: "lose",
        roundNumber: 7,
        matchComplete: false
      },
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 2,
        guestScore: 1,
        roundNumber: 8,
        lastOutcomeType: "war_resolved",
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: false,
          submittedCount: 1,
          bothSubmitted: false,
          updatedAt: "2026-03-19T12:01:00.000Z"
        }
      }
    },
    actions: {}
  });

  assert.match(html, /WATER BEATS FIRE/);
  assert.doesNotMatch(html, /Why:<\/strong>/);
  assert.doesNotMatch(html, /Battle log will appear here\./);
});

test("ui: online play screen renders taunts feed for active rooms", () => {
  const html = onlinePlayScreen.render({
    username: "Hero",
    backgroundImage: "assets/backgrounds/fireBattleArena.png",
    taunts: {
      panelOpen: true,
      messages: [
        { speaker: "Hero", text: "Your move.", kind: "player" },
        { speaker: "Rival", text: "Interesting.", kind: "opponent" }
      ],
      presetLines: ["Your move.", "Interesting."]
    },
    multiplayer: {
      connectionStatus: "connected",
      statusMessage: "Room ABC123 is full.",
      room: {
        roomCode: "ABC123",
        status: "full",
        matchComplete: false,
        host: { socketId: "host-1", username: "Hero" },
        guest: { socketId: "guest-2", username: "Rival" },
        hostHand: { fire: 2, earth: 2, wind: 2, water: 2 },
        guestHand: { fire: 2, earth: 2, wind: 2, water: 2 },
        warPot: { host: [], guest: [] },
        warRounds: [],
        roundHistory: [],
        moveSync: { hostSubmitted: false, guestSubmitted: false, submittedCount: 0, bothSubmitted: false, updatedAt: null },
        taunts: []
      }
    },
    actions: {}
  });

  assert.match(html, /id="online-taunts-toggle-btn"/);
  assert.match(html, /Hero<\/strong>\s*<span>Your move\.<\/span>/);
  assert.match(html, /Rival<\/strong>\s*<span>Interesting\.<\/span>/);
  assert.match(html, /data-match-taunt-panel="online"/);
});

test("ui: online play screen still shows move controls for full rooms when moveSync is missing", () => {
  const hostResolvedIdentity = {
    slotLabel: "Host",
    username: "HostUser",
    connected: true,
    avatarImage: getAvatarImage("avatar_crystal_soul"),
    backgroundImage: getArenaBackground("bg_verdant_shrine"),
    cardBackImage: getCardBackImage("cardback_arcane_galaxy"),
    titleLabel: "Apprentice",
    titleIcon: "assets/titles/title_apprentice.png",
    badgeImage: getBadgeImage("badge_element_initiate"),
    variantImages: getVariantCardImages({
      fire: "fire_variant_crownfire",
      water: "water_variant_tidal_spirit",
      earth: "earth_variant_transparent_crystal",
      wind: "wind_variant_vortex_spirit"
    })
  };
  const guestResolvedIdentity = {
    slotLabel: "Guest",
    username: "GuestUser",
    connected: true,
    avatarImage: getAvatarImage("avatar_storm_oracle"),
    backgroundImage: getArenaBackground("bg_storm_temple"),
    cardBackImage: getCardBackImage("cardback_storm_spiral"),
    titleLabel: "Element Sovereign",
    titleIcon: "assets/titles/title_element_sovereign.png",
    badgeImage: getBadgeImage("badge_element_veteran"),
    variantImages: getVariantCardImages({
      fire: "fire_variant_ember",
      water: "water_variant_tidal_spirit",
      earth: "earth_variant_rooted_monolith",
      wind: "wind_variant_sky_serpent"
    })
  };
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      statusMessage: "Room ABC123 is full.",
      lastError: null,
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        hostResolvedIdentity,
        guestResolvedIdentity,
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 0,
        guestScore: 0,
        roundNumber: 1,
        lastOutcomeType: null,
        hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
        guestHand: { fire: 2, water: 2, earth: 2, wind: 2 },
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: []
      }
    },
    actions: {}
  });

  assert.doesNotMatch(html, /data-round-center-result="true"/);
  assert.doesNotMatch(html, /Battle log will appear here\./);
  assert.doesNotMatch(html, /Battle Result/);
  assert.doesNotMatch(html, /Why:<\/strong>/);
  assert.doesNotMatch(html, /Changed:<\/strong>/);
  assert.match(html, /1 Fire · 2 Earth · 3 Wind · 4 Water/);
  assert.match(html, /Sync:<\/strong> 0\/2 submitted\./);
  assert.match(html, /Choose your move for the current round\./);
  assert.match(html, /Round 1 \| Host 0 - Guest 0/);
  assert.match(html, /Move Sync: 0\/2 submitted\./);
  assert.match(html, /data-move="fire"/);
  assert.match(html, /title-icon/);
});

test("ui: online play screen renders war resolved result from player perspective", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      statusMessage: "WAR Won Room ABC123",
      lastError: null,
      latestRoundResult: {
        roomCode: "ABC123",
        hostMove: "water",
        guestMove: "fire",
        outcomeType: "war_resolved",
        hostScore: 1,
        guestScore: 0,
        roundNumber: 3,
        lastOutcomeType: "war_resolved",
        warActive: true,
        warDepth: 1,
        warRounds: [
          {
            round: 1,
            hostMove: "fire",
            guestMove: "fire",
            outcomeType: "war"
          },
          {
            round: 2,
            hostMove: "water",
            guestMove: "fire",
            outcomeType: "war_resolved"
          }
        ],
        hostResult: "win",
        guestResult: "lose"
      },
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 1,
        guestScore: 0,
        roundNumber: 3,
        lastOutcomeType: "war_resolved",
        warActive: true,
        warDepth: 1,
        warRounds: [
          {
            round: 1,
            hostMove: "fire",
            guestMove: "fire",
            outcomeType: "war"
          },
          {
            round: 2,
            hostMove: "water",
            guestMove: "fire",
            outcomeType: "war_resolved"
          }
        ],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: true,
          submittedCount: 2,
          bothSubmitted: true,
          updatedAt: "2026-03-19T12:00:05.000Z"
        }
      }
    },
    actions: {}
  });

  assert.match(html, /data-round-center-result="true"/);
  assert.match(html, /data-round-center-headline="true">WATER BEATS FIRE</);
  assert.match(html, /WAR Won/);
  assert.doesNotMatch(html, /Why:<\/strong>/);
  assert.doesNotMatch(html, /Changed:<\/strong>/);
});

test("ui: online play center result prefers synced equipped variant art when available", () => {
  const hostResolvedIdentity = {
    slotLabel: "Host",
    username: "LocalUser",
    connected: true,
    avatarImage: getAvatarImage("avatar_fourfold_lord"),
    backgroundImage: getArenaBackground("bg_elemental_throne"),
    cardBackId: "cardback_elemental_nexus",
    cardBackImage: getCardBackImage("cardback_elemental_nexus"),
    titleLabel: "War Master",
    variantSelection: {
      fire: "fire_variant_phoenix",
      water: "water_variant_crystal",
      earth: "earth_variant_titan",
      wind: "wind_variant_storm_eye"
    },
    variantImages: getVariantCardImages({
      fire: "fire_variant_phoenix",
      water: "water_variant_crystal",
      earth: "earth_variant_titan",
      wind: "wind_variant_storm_eye"
    })
  };
  const guestResolvedIdentity = {
    slotLabel: "Guest",
    username: "RemoteUser",
    connected: true,
    avatarImage: getAvatarImage("avatar_storm_oracle"),
    backgroundImage: getArenaBackground("bg_storm_temple"),
    cardBackId: "cardback_storm_spiral",
    cardBackImage: getCardBackImage("cardback_storm_spiral"),
    titleLabel: "Element Sovereign",
    variantSelection: {
      fire: "fire_variant_ember",
      water: "water_variant_tidal_spirit",
      earth: "earth_variant_rooted_monolith",
      wind: "wind_variant_sky_serpent"
    },
    variantImages: getVariantCardImages({
      fire: "fire_variant_ember",
      water: "water_variant_tidal_spirit",
      earth: "earth_variant_rooted_monolith",
      wind: "wind_variant_sky_serpent"
    })
  };
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "ABC123",
    multiplayer: {
      connectionStatus: "connected",
      socketId: "host-1",
      latestAuthoritativeRoundResult: {
        outcomeType: "resolved",
        submittedCards: { host: "fire", guest: "earth" },
        roundResult: {
          hostMove: "fire",
          guestMove: "earth",
          outcomeType: "resolved",
          hostResult: "win",
          guestResult: "lose",
          roundNumber: 3
        }
      },
      room: {
        roomCode: "ABC123",
        status: "full",
        createdAt: "2026-03-19T12:00:00.000Z",
        host: { socketId: "host-1", username: "LocalUser" },
        guest: { socketId: "guest-1", username: "RemoteUser" },
        hostResolvedIdentity,
        guestResolvedIdentity,
        hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
        guestHand: { fire: 2, water: 2, earth: 2, wind: 2 },
        hostScore: 1,
        guestScore: 0,
        roundNumber: 3,
        lastOutcomeType: "resolved",
        warActive: false,
        warDepth: 0,
        warRounds: [],
        roundHistory: [],
        moveSync: {
          hostSubmitted: true,
          guestSubmitted: true,
          submittedCount: 2,
          bothSubmitted: true,
          updatedAt: "2026-03-19T12:00:05.000Z"
        }
      }
    },
    actions: {}
  });

  assert.match(html, /data-round-center-result="true"/);
  assert.match(html, /data-round-center-headline="true">FIRE BEATS EARTH</);
  assert.match(html, /assets\/cards\/fire_variant_phoenix\.png/);
  assert.match(html, /assets\/cards\/earth_variant_rooted_monolith\.png/);
});

test("ui: online play screen renders a server-authoritative turn timer label in the status panel", () => {
  const html = onlinePlayScreen.render({
    backgroundImage: "assets/EleMintzIcon.png",
    joinCode: "ABC123",
    onlineTurnTimer: {
      visible: true,
      label: "Time to choose: 20s",
      lowTime: false
    },
    multiplayer: {
      connectionStatus: "connected",
      socketId: "guest-1",
      statusMessage: "Waiting for GuestUser to choose a move.",
      lastError: null,
      latestRoundResult: null,
      latestAuthoritativeRoundResult: null,
      lastCompletedBattleResult: null,
      room: {
        roomCode: "ABC123",
        createdAt: "2026-03-19T12:00:00.000Z",
        status: "full",
        host: { socketId: "host-1" },
        guest: { socketId: "guest-1" },
        hostScore: 0,
        guestScore: 0,
        roundNumber: 1,
        hostHand: { fire: 2, water: 2, earth: 2, wind: 2 },
        guestHand: { fire: 2, water: 2, earth: 2, wind: 2 },
        warActive: false,
        warDepth: 0,
        warPot: { host: [], guest: [] },
        warRounds: [],
        roundHistory: [],
        hostResolvedIdentity: {
          username: "HostUser",
          avatarImage: getAvatarImage("default_avatar"),
          backgroundImage: "assets/arena/default.webp",
          cardBackImage: getCardBackImage("default_card_back"),
          variantImages: getVariantCardImages(),
          variantSelection: null
        },
        guestResolvedIdentity: {
          username: "GuestUser",
          avatarImage: getAvatarImage("default_avatar"),
          backgroundImage: "assets/arena/default.webp",
          cardBackImage: getCardBackImage("default_card_back"),
          variantImages: getVariantCardImages(),
          variantSelection: null
        },
        moveSync: {
          hostSubmitted: false,
          guestSubmitted: false,
          submittedCount: 0,
          bothSubmitted: false,
          updatedAt: null
        },
        serverMatchState: {
          turnTimer: {
            active: true,
            stepId: "ABC123:match:1:round:1:step:round:warDepth:0",
            durationMs: 20000,
            startedAt: "2026-05-07T12:00:00.000Z",
            expiresAt: "2026-05-07T12:00:20.000Z"
          }
        }
      }
    },
    actions: {}
  });

  assert.match(html, /Time to choose: 20s/);
  assert.match(html, /online-status-header-row/);
  assert.match(html, /data-online-turn-timer-label="true"/);
  assert.match(html, /data-online-turn-timer-shell="true"/);
});

test("ui: online play screen bind delegates move button clicks to submitMove", async () => {
  const previousDocument = global.document;
  const previousFormData = global.FormData;
  const calls = [];
  const joinCalls = [];
  const visibilityCalls = [];
  let refreshHandler = null;
  let joinSubmitHandler = null;
  let publicJoinHandler = null;
  let moveClickHandler = null;
  const tauntCalls = [];
  const tauntToggleButton = createFakeElement();
  const refreshButton = createFakeElement();
  const privateVisibilityButton = createFakeElement();
  const publicVisibilityButton = createFakeElement();
  const publicJoinButton = {
    getAttribute: (name) => (name === "data-online-public-room-join" ? "PUB123" : null),
    addEventListener(type, handler) {
      if (type === "click") {
        publicJoinHandler = handler;
      }
    }
  };
  const tauntOptionButton = {
    listeners: new Map(),
    getAttribute: (name) => (name === "data-taunt-line" ? "Your move." : null),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
  };

  const moveActions = {
    addEventListener: (_type, handler) => {
      moveClickHandler = handler;
    }
  };

  global.document = {
    getElementById: (id) => {
      if (id === "online-create-room-btn" || id === "online-play-back-btn") {
        return { addEventListener: () => {} };
      }

      if (id === "online-refresh-public-rooms-btn") {
        return {
          addEventListener: (_type, handler) => {
            refreshHandler = handler;
          }
        };
      }

      if (id === "online-room-visibility-private-btn") {
        return {
          addEventListener: (_type, handler) => {
            privateVisibilityButton.handler = handler;
          }
        };
      }

      if (id === "online-room-visibility-public-btn") {
        return {
          addEventListener: (_type, handler) => {
            publicVisibilityButton.handler = handler;
          }
        };
      }

      if (id === "online-taunts-toggle-btn") {
        return tauntToggleButton;
      }

      if (id === "online-move-actions") {
        return moveActions;
      }

      if (id === "online-join-room-form") {
        return {
          addEventListener: (_type, handler) => {
            joinSubmitHandler = handler;
          }
        };
      }

      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === "[data-taunt-line]") {
        return [tauntOptionButton];
      }
      if (selector === "[data-online-public-room-join]") {
        return [publicJoinButton];
      }
      return [];
    }
  };
  global.FormData = class FakeFormData {
    constructor(target) {
      this.target = target;
    }

    get(name) {
      return this.target?.[name] ?? "";
    }
  };

  try {
    onlinePlayScreen.bind({
      actions: {
        createRoom: async () => {},
        back: async () => {},
        joinRoom: async (roomCode) => {
          joinCalls.push(roomCode);
        },
        browsePublicRooms: async () => {
          joinCalls.push("browse");
        },
        setCreateRoomVisibility: async (visibility) => {
          visibilityCalls.push(visibility);
        },
        toggleTauntsPanel: async () => {
          tauntCalls.push("toggle");
        },
        sendTaunt: async (line) => {
          tauntCalls.push(line);
        },
        submitMove: async (move) => {
          calls.push(move);
        }
      }
    });

    await moveClickHandler({
      target: {
        nodeName: "#text",
        parentNode: {
          classList: { contains: (value) => value === "online-move-btn" },
          hasAttribute: () => false,
          getAttribute: () => "fire",
          parentNode: null
        }
      },
      composedPath: () => []
    });
    await refreshHandler();
    await privateVisibilityButton.handler();
    await publicVisibilityButton.handler();
    await publicJoinHandler();
    await joinSubmitHandler({
      preventDefault: () => {},
      currentTarget: {
        roomCode: "ROOM42"
      }
    });
    await tauntToggleButton.listeners.get("click")();
    await tauntOptionButton.listeners.get("click")();

    assert.deepEqual(calls, ["fire"]);
    assert.deepEqual(tauntCalls, ["toggle", "Your move."]);
    assert.deepEqual(visibilityCalls, ["private", "public"]);
    assert.deepEqual(joinCalls, ["browse", "PUB123", "ROOM42"]);
  } finally {
    global.document = previousDocument;
    global.FormData = previousFormData;
  }
});

test("ui: online play screen keyboard shortcuts delegate to the existing submit path only when legal", async () => {
  const previousDocument = global.document;
  const calls = [];
  const listeners = {};
  const fireButton = createFakeElement();
  fireButton.getAttribute = (name) => {
    if (name === "data-move") return "fire";
    return null;
  };
  fireButton.hasAttribute = (name) => name === "disabled" ? false : false;
  fireButton.classList = { contains: (value) => value === "online-move-btn" };

  const earthButton = createFakeElement();
  earthButton.getAttribute = (name) => {
    if (name === "data-move") return "earth";
    return null;
  };
  earthButton.hasAttribute = () => true;
  earthButton.classList = { contains: (value) => value === "online-move-btn" };

  global.document = {
    activeElement: { tagName: "BODY", isContentEditable: false },
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    removeEventListener(type, handler) {
      if (listeners[type] === handler) {
        delete listeners[type];
      }
    },
    getElementById: (id) => {
      if (id === "online-create-room-btn" || id === "online-play-back-btn") {
        return { addEventListener: () => {} };
      }
      if (id === "online-join-room-form") {
        return { addEventListener: () => {} };
      }
      if (id === "online-move-actions") {
        return { addEventListener: () => {} };
      }
      return null;
    },
    querySelector: () => null,
    querySelectorAll: (selector) => {
      if (selector === "[data-taunt-line]") {
        return [];
      }
      if (selector === ".online-move-btn") {
        return [fireButton, earthButton];
      }
      return [];
    }
  };

  try {
    onlinePlayScreen.bind({
      actions: {
        createRoom: async () => {},
        back: async () => {},
        joinRoom: async () => {},
        toggleTauntsPanel: async () => {},
        sendTaunt: async () => {},
        submitMove: async (move) => {
          calls.push(move);
        }
      }
    });

    await listeners.keydown({
      key: "1",
      target: { tagName: "DIV", isContentEditable: false },
      preventDefault: () => {}
    });

    await listeners.keydown({
      key: "2",
      target: { tagName: "DIV", isContentEditable: false },
      preventDefault: () => {}
    });

    assert.deepEqual(calls, ["fire"]);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: online play screen keyboard shortcuts are ignored for editable targets and open modals", async () => {
  const previousDocument = global.document;
  const calls = [];
  const listeners = {};
  const fireButton = createFakeElement();
  fireButton.getAttribute = (name) => {
    if (name === "data-move") return "fire";
    return null;
  };
  fireButton.hasAttribute = () => false;
  fireButton.classList = { contains: (value) => value === "online-move-btn" };

  global.document = {
    activeElement: { tagName: "INPUT", isContentEditable: false },
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    removeEventListener(type, handler) {
      if (listeners[type] === handler) {
        delete listeners[type];
      }
    },
    getElementById: (id) => {
      if (id === "online-create-room-btn" || id === "online-play-back-btn") {
        return { addEventListener: () => {} };
      }
      if (id === "online-join-room-form") {
        return { addEventListener: () => {} };
      }
      if (id === "online-move-actions") {
        return { addEventListener: () => {} };
      }
      return null;
    },
    querySelector: (selector) => (selector === ".modal-overlay" ? {} : null),
    querySelectorAll: (selector) => {
      if (selector === "[data-taunt-line]") {
        return [];
      }
      if (selector === ".online-move-btn") {
        return [fireButton];
      }
      return [];
    }
  };

  try {
    onlinePlayScreen.bind({
      actions: {
        createRoom: async () => {},
        back: async () => {},
        joinRoom: async () => {},
        toggleTauntsPanel: async () => {},
        sendTaunt: async () => {},
        submitMove: async (move) => {
          calls.push(move);
        }
      }
    });

    await listeners.keydown({
      key: "1",
      target: { tagName: "INPUT", isContentEditable: false },
      preventDefault: () => {}
    });

    assert.deepEqual(calls, []);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: profile screen uses a chest count bubble and subtle empty helper text when no basic chests are available", () => {
  const html = profileScreen.render(
    createProfileScreenContext({
      profile: {
        ...createProfileScreenContext().profile,
        username: "ChestlessUser",
        chests: { basic: 0, milestone: 0, epic: 0, legendary: 0 }
      }
    })
  );

  assert.match(html, /src="(?:file:.*\/)?assets\/icons\/basic_chest\.png"/);
  assert.match(html, /id="open-basic-chest-btn"/);
  assert.match(html, /class="chest-count-bubble"[^>]*>0</);
  assert.match(html, /class="chest-open-trigger"/);
  assert.match(html, /class="text-muted chest-open-helper cosmetic-rarity-label rarity-common" data-basic-chest-label="true">No Basic Chests available<\/p>/);
  assert.match(html, /class="text-muted chest-open-helper cosmetic-rarity-label rarity-rare" data-milestone-chest-label="true">Milestone Chest<\/p>/);
  assert.match(html, /data-epic-chest-image="true"/);
  assert.match(html, /data-legendary-chest-image="true"/);
  assert.doesNotMatch(html, /No Chests available/);
  assert.doesNotMatch(html, /Basic Chests: <strong>/);
  assert.match(html, /disabled aria-disabled="true"/);
});

test("ui: profile screen enables open chest button when player has a basic chest", () => {
  const html = profileScreen.render(
    createProfileScreenContext({
      profile: {
        ...createProfileScreenContext().profile,
        username: "ChestOwner",
        chests: { basic: 2, milestone: 3, epic: 1, legendary: 0 }
      }
    })
  );

  assert.match(html, /class="chest-count-bubble"[^>]*>2</);
  assert.match(html, /id="open-milestone-chest-btn"/);
  assert.match(html, /data-milestone-chest-image="true"/);
  assert.match(html, /aria-label="Milestone Chest count">3</);
  assert.match(html, /class="text-muted chest-open-helper cosmetic-rarity-label rarity-common" data-basic-chest-label="true">Basic Chest<\/p>/);
  assert.match(html, /class="text-muted chest-open-helper cosmetic-rarity-label rarity-rare" data-milestone-chest-label="true">Milestone Chest<\/p>/);
  assert.match(html, /class="text-muted chest-open-helper cosmetic-rarity-label rarity-epic" data-epic-chest-label="true">Epic Chest<\/p>/);
  assert.match(html, /class="text-muted chest-open-helper cosmetic-rarity-label rarity-legendary" data-legendary-chest-label="true">Legendary Chest<\/p>/);
  assert.match(html, /aria-label="Epic Chest count">1</);
  assert.match(html, /aria-label="Legendary Chest count">0</);
  assert.doesNotMatch(html, /Basic Chests: <strong>/);
  assert.doesNotMatch(html, /id="open-basic-chest-btn"[^>]*disabled aria-disabled="true"/);
  assert.doesNotMatch(html, /id="open-milestone-chest-btn"[^>]*disabled aria-disabled="true"/);
});

test("ui: profile screen swaps to the open chest image when the local visual state is active", () => {
  const html = profileScreen.render(
    createProfileScreenContext({
      profile: {
        ...createProfileScreenContext().profile,
        username: "ChestOwner",
        chests: { basic: 1, milestone: 1, epic: 0, legendary: 0 }
      },
      basicChestVisualState: { basicOpen: true, milestoneOpen: true }
    })
  );

  assert.match(html, /data-basic-chest-image="true"/);
  assert.match(html, /src="(?:file:.*\/)?assets\/icons\/basic_chest_open\.png"/);
  assert.doesNotMatch(html, /src="(?:file:.*\/)?assets\/icons\/basic_chest\.png" alt="Basic Chest" data-basic-chest-image="true"/);
  assert.match(html, /data-milestone-chest-image="true"/);
  assert.match(html, /src="(?:file:.*\/)?assets\/icons\/loot_chest_open\.png"/);
});

test("ui: profile chest labels stay non-interactive while chest buttons remain clickable", () => {
  const previousDocument = global.document;
  const actions = [];
  const basicButton = { addEventListener: (_type, handler) => actions.push(["basic", handler]) };
  const milestoneButton = { addEventListener: (_type, handler) => actions.push(["milestone", handler]) };
  const epicButton = { addEventListener: (_type, handler) => actions.push(["epic", handler]) };
  const legendaryButton = { addEventListener: (_type, handler) => actions.push(["legendary", handler]) };
  const searchForm = { addEventListener: () => {} };

  global.document = {
    getElementById: (id) => {
      if (id === "profile-back-btn") {
        return { addEventListener: () => {} };
      }
      if (id === "open-basic-chest-btn") {
        return basicButton;
      }
      if (id === "open-milestone-chest-btn") {
        return milestoneButton;
      }
      if (id === "open-epic-chest-btn") {
        return epicButton;
      }
      if (id === "open-legendary-chest-btn") {
        return legendaryButton;
      }
      if (id === "profile-search-form") {
        return searchForm;
      }
      if (id === "profile-search-input") {
        return null;
      }
      if (id === "clear-viewed-profile-btn") {
        return null;
      }
      return null;
    },
    querySelector: () => null,
    querySelectorAll: () => []
  };

  try {
    profileScreen.bind(
      createProfileScreenContext({
        actions: {
          openBasicChest: () => "basic",
          openMilestoneChest: () => "milestone",
          openEpicChest: () => "epic",
          openLegendaryChest: () => "legendary",
          searchProfiles: () => {},
          viewProfile: () => {},
          clearViewed: () => {},
          back: () => {}
        }
      })
    );
  } finally {
    global.document = previousDocument;
  }

  assert.equal(actions.length, 4);
  assert.deepEqual(
    actions.map(([name]) => name),
    ["basic", "milestone", "epic", "legendary"]
  );
});

test("ui: profile chest row keeps milestone chest to the right of the basic chest with two reserved future slots", () => {
  const html = profileScreen.render(
    createProfileScreenContext({
      profile: {
        ...createProfileScreenContext().profile,
        username: "FutureChestUser",
        chests: { basic: 1, milestone: 3, epic: 2, legendary: 1 }
      }
    })
  );

  assert.ok(html.indexOf('id="open-basic-chest-btn"') < html.indexOf('id="open-milestone-chest-btn"'));
  assert.ok(html.indexOf('data-profile-chest-slot="milestone"') < html.indexOf('data-profile-chest-slot="epic"'));
  assert.ok(html.indexOf('data-profile-chest-slot="epic"') < html.indexOf('data-profile-chest-slot="legendary"'));
  assert.equal((html.match(/data-profile-chest-slot="/g) ?? []).length, 4);
  assert.match(html, /data-profile-chest-row="true"/);
  assert.match(html, /Basic Chest/);
  assert.match(html, /Milestone Chest/);
  assert.match(html, /Epic Chest/);
  assert.match(html, /Legendary Chest/);
});

test("ui: profile reward chest panel adds subtle spacing above the section", () => {
  const css = fs.readFileSync(
    "C:\\Users\\mxz\\Desktop\\Projects\\Codex EleMintz PC\\src\\renderer\\styles\\game.css",
    "utf8"
  );
  const html = profileScreen.render(createProfileScreenContext());

  assert.match(css, /\.profile-chest-panel\s*\{\s*margin-top:\s*16px;\s*\}/);
  assert.match(html, /class="stack-sm chest-panel profile-chest-panel"/);
});

test("ui: epic and legendary profile chest entries enable opening when inventory exists and support the open visual state", () => {
  const html = profileScreen.render(
    createProfileScreenContext({
      profile: {
        ...createProfileScreenContext().profile,
        username: "VisualChestUser",
        chests: { basic: 0, milestone: 0, epic: 4, legendary: 2 }
      },
      basicChestVisualState: {
        basicOpen: false,
        milestoneOpen: false,
        epicOpen: true,
        legendaryOpen: true
      }
    })
  );

  assert.match(html, /data-epic-chest-image="true"/);
  assert.match(html, /data-legendary-chest-image="true"/);
  assert.match(html, /id="open-epic-chest-btn"/);
  assert.match(html, /id="open-legendary-chest-btn"/);
  assert.match(html, /aria-label="Open Epic Chest"/);
  assert.match(html, /aria-label="Open Legendary Chest"/);
  assert.match(html, /src="(?:file:.*\/)?assets\/icons\/epic_chest_open\.png"/);
  assert.match(html, /src="(?:file:.*\/)?assets\/icons\/legendary_chest_open\.png"/);
  assert.doesNotMatch(html, /id="open-epic-chest-btn"[^>]*disabled/);
  assert.doesNotMatch(html, /id="open-legendary-chest-btn"[^>]*disabled/);
});

test("ui: profile chest buttons disable and show opening state while a chest open is in flight", () => {
  const html = profileScreen.render(
    createProfileScreenContext({
      profile: {
        ...createProfileScreenContext().profile,
        username: "OpeningChestUser",
        chests: { basic: 2, milestone: 1, epic: 4, legendary: 3 }
      },
      profileChestOpenInFlight: true
    })
  );

  assert.match(html, /id="open-basic-chest-btn"[^>]*disabled aria-disabled="true"/);
  assert.match(html, /id="open-milestone-chest-btn"[^>]*disabled aria-disabled="true"/);
  assert.match(html, /id="open-epic-chest-btn"[^>]*disabled aria-disabled="true"/);
  assert.match(html, /id="open-legendary-chest-btn"[^>]*disabled aria-disabled="true"/);
  assert.match(html, /data-basic-chest-label="true">Opening\.\.\.</);
  assert.match(html, /data-legendary-chest-label="true">Opening\.\.\.</);
});

test("ui: profile shows the new milestone chest popup with the exact grant message and acknowledges it once", async () => {
  const previousWindow = global.window;
  const shown = [];
  const modalCalls = [];
  const acknowledged = [];
  let liveProfile = {
    ...createProfileScreenContext().profile,
    username: "RewardHero",
    playerLevel: 10,
    chests: { basic: 0, milestone: 1 },
    pendingMilestoneChestRewardLevel: 10
  };
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: {
      show: (config) => modalCalls.push(config),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  global.window = {
    elemintz: {
      state: {
        getProfile: async () => liveProfile,
        getCosmetics: async () => createProfileScreenContext().cosmetics,
        getDailyChallenges: async () => ({ xp: {} }),
        listProfiles: async () => [liveProfile],
        acknowledgeMilestoneChestReward: async ({ username, level }) => {
          acknowledged.push({ username, level });
          liveProfile = { ...liveProfile, pendingMilestoneChestRewardLevel: null };
          return { profile: liveProfile };
        }
      }
    }
  };

  try {
    app.username = "RewardHero";
    await app.showProfile();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(modalCalls.length, 1);
    assert.equal(modalCalls[0].body, "Congrats RewardHero on level 10, a FREE Token Reward is now Available");

    await modalCalls[0].actions[0].onClick();
    assert.deepEqual(acknowledged, [{ username: "RewardHero", level: 10 }]);
    assert.equal(shown.at(-1).profile.pendingMilestoneChestRewardLevel, null);
  } finally {
    global.window = previousWindow;
  }
});

test("ui: modal manager supports large profile modal classes without changing default modal markup", () => {
  const buttons = [];
  const rootNode = {
    innerHTML: "",
    querySelectorAll: () => buttons
  };
  const manager = new ModalManager(rootNode);

  manager.show({
    title: "Viewing: Rival",
    bodyHtml: "<div>Read-only player profile</div>",
    modalClassName: "viewed-profile-modal",
    bodyClassName: "viewed-profile-modal-body",
    actions: [{ label: "Close", onClick: () => {} }]
  });

  assert.match(rootNode.innerHTML, /class="modal viewed-profile-modal"/);
  assert.match(rootNode.innerHTML, /class="modal-body viewed-profile-modal-body"/);

  manager.show({
    title: "Simple Modal",
    body: "Hello there",
    actions: []
  });

  assert.match(rootNode.innerHTML, /class="modal"/);
  assert.doesNotMatch(rootNode.innerHTML, /viewed-profile-modal-body/);
  assert.match(rootNode.innerHTML, /<p class="modal-body">Hello there<\/p>/);
});

test("ui: appController fetches authenticated featured shop rotation and passes it into the store screen", async () => {
  const previousWindow = global.window;
  const shown = [];
  const profileSnapshot = {
    authority: "server",
    source: "multiplayer",
    profile: {
      username: "StoreKeeper",
      tokens: 225,
      playerXP: 18,
      playerLevel: 1,
      equippedCosmetics: {
        avatar: "default_avatar",
        background: "default_background",
        cardBack: "default_card_back",
        elementCardVariant: {
          fire: "default_fire_card",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        },
        badge: "none",
        title: "Initiate"
      },
      ownedCosmetics: {
        avatar: ["default_avatar"],
        background: ["default_background"],
        cardBack: ["default_card_back"],
        elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
        badge: ["none"],
        title: ["Initiate"]
      }
    },
    progression: {
      xp: { playerXP: 18, playerLevel: 1 },
      dailyChallenges: { challenges: [] },
      weeklyChallenges: { challenges: [] },
      dailyLogin: { eligible: false }
    }
  };

  global.window = {
    elemintz: {
      state: {
        getStore: async () => ({
          tokens: 225,
          supporterPass: false,
          catalog: {
            avatar: [],
            title: [],
            badge: [],
            cardBack: [],
            background: [],
            elementCardVariant: []
          }
        })
      },
      multiplayer: {
        getProfile: async () => profileSnapshot,
        getActiveShopRotation: async () => ({
          activeRotationId: "void-week-01",
          title: "Void Week",
          message: "Void Collection cosmetics are featured this week.",
          startsAt: null,
          endsAt: null,
          featuredCosmeticIds: ["avatar_voidbound_entity", "cardback_void_tease"],
          allowLimitedCosmeticIds: ["avatar_voidbound_entity"]
        }),
        buyStoreItem: async () => {
          throw new Error("Unexpected test purchase.");
        },
        equipCosmetic: async () => {
          throw new Error("Unexpected test equip.");
        }
      }
    }
  };

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (_screenId, context) => shown.push(context)
    },
    modalManager: {
      show: () => {},
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  try {
    controller.username = "StoreKeeper";
    controller.onlinePlayState = {
      connectionStatus: "connected",
      session: {
        active: true,
        authenticated: true,
        username: "StoreKeeper",
        profileKey: "StoreKeeper",
        accountId: "account-id-1"
      }
    };

    await controller.showStore();

    assert.equal(shown.length, 1);
    assert.equal(shown[0].store.catalog.avatar.some((item) => item.id === "avatar_voidbound_entity"), false);
    assert.equal(shown[0].featuredRotation?.activeRotationId, "void-week-01");
    assert.equal(shown[0].featuredRotation?.featuredItems?.length, 2);
    assert.deepEqual(
      shown[0].featuredRotation?.featuredItems?.map((entry) => entry.id),
      ["avatar_voidbound_entity", "cardback_void_tease"]
    );
  } finally {
    global.window = previousWindow;
  }
});

test("ui: rotationOnly featured ids require allowLimitedCosmeticIds while normal featured items still render", async () => {
  const previousWindow = global.window;
  const shown = [];
  const profileSnapshot = {
    authority: "server",
    source: "multiplayer",
    profile: {
      username: "RotationRules",
      tokens: 225,
      playerXP: 18,
      playerLevel: 1,
      equippedCosmetics: {
        avatar: "default_avatar",
        background: "default_background",
        cardBack: "default_card_back",
        elementCardVariant: {
          fire: "default_fire_card",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        },
        badge: "none",
        title: "Initiate"
      },
      ownedCosmetics: {
        avatar: ["default_avatar"],
        background: ["default_background"],
        cardBack: ["default_card_back"],
        elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
        badge: ["none"],
        title: ["Initiate"]
      }
    },
    progression: {
      xp: { playerXP: 18, playerLevel: 1 },
      dailyChallenges: { challenges: [] },
      weeklyChallenges: { challenges: [] },
      dailyLogin: { eligible: false }
    }
  };

  global.window = {
    elemintz: {
      state: {
        getStore: async () => {
          throw new Error("local store should not be used for authenticated rotation test");
        }
      },
      multiplayer: {
        getProfile: async () => profileSnapshot,
        getActiveShopRotation: async () => ({
          activeRotationId: "mixed-week-01",
          title: "Mixed Week",
          message: "A mixed featured set is live.",
          startsAt: null,
          endsAt: null,
          featuredCosmeticIds: ["avatar_voidbound_entity", "cardback_void_tease"],
          allowLimitedCosmeticIds: []
        }),
        buyStoreItem: async () => {
          throw new Error("Unexpected test purchase.");
        },
        equipCosmetic: async () => {
          throw new Error("Unexpected test equip.");
        }
      }
    }
  };

  const controller = new AppController({
    screenManager: {
      register: () => {},
      show: (_screenId, context) => shown.push(context)
    },
    modalManager: {
      show: () => {},
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  try {
    controller.username = "RotationRules";
    controller.onlinePlayState = {
      connectionStatus: "connected",
      session: {
        active: true,
        authenticated: true,
        username: "RotationRules",
        profileKey: "RotationRules",
        accountId: "account-id-2"
      }
    };

    await controller.showStore();

    assert.equal(shown.length, 1);
    assert.deepEqual(
      shown[0].featuredRotation?.featuredItems?.map((entry) => entry.id),
      ["cardback_void_tease"]
    );
    assert.equal(shown[0].store.catalog.avatar.some((item) => item.id === "avatar_voidbound_entity"), false);
    assert.equal(shown[0].store.catalog.cardBack.some((item) => item.id === "cardback_void_tease"), true);
  } finally {
    global.window = previousWindow;
  }
});

test("ui: authenticated profile milestone reward popup uses multiplayer acknowledgement and does not reopen after refresh or re-entry", async () => {
  const previousWindow = global.window;
  const shown = [];
  const modalCalls = [];
  const localAckCalls = [];
  const multiplayerAckCalls = [];
  let liveServerProfile = {
    authority: "server",
    username: "Enab",
    profile: {
      ...createProfileScreenContext().profile,
      username: "Enab",
      playerLevel: 5,
      chests: { basic: 0, milestone: 1 },
      pendingMilestoneChestRewardLevel: 5
    },
    progression: {
      xp: {}
    }
  };
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: {
      show: (config) => modalCalls.push(config),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  global.window = {
    elemintz: {
      multiplayer: {
        getProfile: async () => liveServerProfile,
        getCosmetics: async () => createProfileScreenContext().cosmetics,
        acknowledgeMilestoneChestReward: async ({ username, level }) => {
          multiplayerAckCalls.push({ username, level });
          liveServerProfile = {
            ...liveServerProfile,
            profile: {
              ...liveServerProfile.profile,
              pendingMilestoneChestRewardLevel: null
            }
          };
          return {
            pendingMilestoneChestRewardLevel: null,
            snapshot: liveServerProfile
          };
        }
      },
      state: {
        getProfile: async () => {
          throw new Error("local profile read should not be used for authenticated profile refresh");
        },
        getCosmetics: async () => createProfileScreenContext().cosmetics,
        getDailyChallenges: async () => ({ xp: {} }),
        listProfiles: async () => [liveServerProfile.profile],
        acknowledgeMilestoneChestReward: async ({ username, level }) => {
          localAckCalls.push({ username, level });
          return {
            profile: {
              ...liveServerProfile.profile,
              pendingMilestoneChestRewardLevel: null
            }
          };
        }
      }
    }
  };

  try {
    app.username = "Enab";
    app.profile = {
      username: "Enab",
      pendingMilestoneChestRewardLevel: 5
    };
    app.onlinePlayState = {
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "Enab"
      }
    };

    await app.showProfile();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(modalCalls.length, 1);
    assert.equal(modalCalls[0].title, "Level Reward Available");

    await modalCalls[0].actions[0].onClick();
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(multiplayerAckCalls, [{ username: "Enab", level: 5 }]);
    assert.deepEqual(localAckCalls, []);
    assert.equal(shown.at(-1).profile.pendingMilestoneChestRewardLevel, null);
    assert.equal(modalCalls.length, 1);

    await app.showProfile();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(modalCalls.length, 1);

    liveServerProfile = {
      ...liveServerProfile,
      profile: {
        ...liveServerProfile.profile,
        playerLevel: 10,
        pendingMilestoneChestRewardLevel: 10
      }
    };

    await app.showProfile();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(modalCalls.length, 2);
    assert.equal(modalCalls.at(-1)?.body, "Congrats Enab on level 10, a FREE Token Reward is now Available");
  } finally {
    global.window = previousWindow;
  }
});

test("ui: opening a milestone chest reuses the profile chest open flow and updates tokens immediately", async () => {
  const previousWindow = global.window;
  const previousSetTimeout = global.setTimeout;
  const shown = [];
  const openCalls = [];
  const toastCalls = [];
  const levelUpCalls = [];
  let liveProfile = {
    ...createProfileScreenContext().profile,
    username: "MilestoneOpener",
    tokens: 15,
    chests: { basic: 0, milestone: 1 }
  };
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: {
      show: () => {},
      hide: () => {}
    },
    toastManager: {
      showChestOpenReward: (payload) => toastCalls.push(payload),
      showLevelUp: (payload) => levelUpCalls.push(payload)
    }
  });

  global.setTimeout = (handler) => {
    handler();
    return 0;
  };
  global.window = {
    elemintz: {
      state: {
        getProfile: async () => liveProfile,
        getCosmetics: async () => createProfileScreenContext().cosmetics,
        getDailyChallenges: async () => ({ xp: {} }),
        listProfiles: async () => [liveProfile],
        openChest: async ({ username, chestType }) => {
          openCalls.push({ username, chestType });
          liveProfile = {
            ...liveProfile,
            tokens: 42,
            chests: { ...liveProfile.chests, milestone: 0 }
          };
          return {
            profile: liveProfile,
            rewards: {
              xp: 0,
              tokens: 27,
              cosmetic: null
            },
            chestType: "milestone",
            levelBefore: 9,
            levelAfter: 10,
            levelRewards: [{ kind: "tokens", amount: 25, label: "Level 10 Reward" }]
          };
        }
      }
    }
  };

  try {
    app.username = "MilestoneOpener";
    await app.showProfile();
    const openAction = shown.at(-1).actions.openMilestoneChest;
    await openAction();

    assert.deepEqual(openCalls, [{ username: "MilestoneOpener", chestType: "milestone" }]);
    assert.equal(toastCalls.length, 1);
    assert.deepEqual(levelUpCalls, [{
      fromLevel: 9,
      toLevel: 10,
      rewards: [{ kind: "tokens", amount: 25, label: "Level 10 Reward" }],
      playerName: "MilestoneOpener"
    }]);
    assert.ok(shown.some((context) => context.basicChestVisualState?.milestoneOpen === true));
    assert.equal(shown.at(-1).profile.tokens, 42);
    assert.equal(shown.at(-1).profile.chests.milestone, 0);
  } finally {
    global.window = previousWindow;
    global.setTimeout = previousSetTimeout;
  }
});

test("ui: failed chest opens clear the renderer in-flight state and exit the opening visual", async () => {
  const previousWindow = global.window;
  const previousSetTimeout = global.setTimeout;
  const shown = [];
  const modalCalls = [];
  let showProfileCalls = 0;
  let failRefreshAfterOpen = true;
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: {
      show: (config) => modalCalls.push(config),
      hide: () => {}
    },
    toastManager: {
      showChestOpenReward: () => {}
    }
  });

  global.setTimeout = (handler) => {
    handler();
    return 0;
  };
  global.window = {
    elemintz: {
      state: {
        getProfile: async () => ({
          ...createProfileScreenContext().profile,
          username: "FailureChestUser",
          chests: { basic: 0, milestone: 0, epic: 0, legendary: 1 }
        }),
        getCosmetics: async () => createProfileScreenContext().cosmetics,
        getDailyChallenges: async () => ({ xp: {} }),
        listProfiles: async () => [],
        openChest: async () => {
          throw new Error("boom");
        }
      }
    }
  };

  const originalShowProfile = app.showProfile.bind(app);
  app.showProfile = async (...args) => {
    showProfileCalls += 1;
    if (failRefreshAfterOpen && showProfileCalls >= 3) {
      failRefreshAfterOpen = false;
      throw new Error("refresh failed");
    }
    return originalShowProfile(...args);
  };

  try {
    app.username = "FailureChestUser";
    await app.showProfile();
    const openAction = shown.at(-1).actions.openLegendaryChest;
    await openAction();

    assert.equal(app.profileChestOpenInFlight, false);
    assert.equal(app.profileChestVisualState.legendaryOpen, false);
    assert.equal(modalCalls.at(-1)?.title, "Chest Open Failed");
    assert.ok(shown.some((context) => context.basicChestVisualState?.legendaryOpen === true));
    assert.equal(shown.at(-1).profileChestOpenInFlight, false);
  } finally {
    global.window = previousWindow;
    global.setTimeout = previousSetTimeout;
  }
});

test("ui: chest XP rewards do not show a Level Up toast when the player does not level", async () => {
  const previousWindow = global.window;
  const previousSetTimeout = global.setTimeout;
  const shown = [];
  const chestToastCalls = [];
  const levelUpCalls = [];
  let liveProfile = {
    ...createProfileScreenContext().profile,
    username: "ChestNoLevelUser",
    tokens: 10,
    playerLevel: 7,
    playerXP: 120,
    chests: { basic: 1, milestone: 0, epic: 0, legendary: 0 }
  };
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: {
      show: () => {},
      hide: () => {}
    },
    toastManager: {
      showChestOpenReward: (payload) => chestToastCalls.push(payload),
      showLevelUp: (payload) => levelUpCalls.push(payload)
    }
  });

  global.setTimeout = (handler) => {
    handler();
    return 0;
  };
  global.window = {
    elemintz: {
      state: {
        getProfile: async () => liveProfile,
        getCosmetics: async () => createProfileScreenContext().cosmetics,
        getDailyChallenges: async () => ({ xp: {} }),
        listProfiles: async () => [liveProfile],
        openChest: async () => {
          liveProfile = {
            ...liveProfile,
            playerXP: 125,
            chests: { ...liveProfile.chests, basic: 0 }
          };
          return {
            profile: liveProfile,
            rewards: {
              xp: 5,
              tokens: 0,
              cosmetic: null
            },
            chestType: "basic",
            levelBefore: 7,
            levelAfter: 7,
            levelRewards: []
          };
        }
      }
    }
  };

  try {
    app.username = "ChestNoLevelUser";
    await app.showProfile();
    const openAction = shown.at(-1).actions.openBasicChest;
    await openAction();

    assert.equal(chestToastCalls.length, 1);
    assert.equal(levelUpCalls.length, 0);
  } finally {
    global.window = previousWindow;
    global.setTimeout = previousSetTimeout;
  }
});

test("ui: appController shows and confirms an incoming admin reward notice through multiplayer authority", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const modalCalls = [];
  const shown = [];
  const multiplayerListeners = [];
  const confirmCalls = [];
  const levelUpCalls = [];

  global.document = {
    querySelector: () => null
  };

  global.window = {
    elemintz: {
      multiplayer: {
        onUpdate: (listener) => {
          multiplayerListeners.push(listener);
          return () => {};
        },
        confirmAdminGrantNotice: async (payload) => {
          confirmCalls.push(payload);
          return {
            transactionId: payload?.transactionId ?? null,
            confirmationStatus: "confirmed",
            result: {
              applied: {
                levelBefore: 34,
                levelAfter: 35,
                levelRewards: [{ kind: "tokens", amount: 50, label: "Level 35 Reward" }]
              }
            }
          };
        },
        getState: async () => ({
          connectionStatus: "connected",
          session: {
            username: "NoticePlayer",
            authenticated: true
          },
          pendingAdminGrantNotices: []
        })
      }
    }
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: (_name, context) => shown.push(context)
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: {
      show: () => {},
      showLevelUp: (payload) => levelUpCalls.push(payload)
    }
  });

  try {
    app.username = "NoticePlayer";
    app.screenFlow = "menu";
    app.bindOnlinePlayUpdates();

    multiplayerListeners[0]?.({
      connectionStatus: "connected",
      session: {
        username: "NoticePlayer",
        authenticated: true
      },
      pendingAdminGrantNotices: [
        {
          transactionId: "admin-grant-1",
          targetUsername: "NoticePlayer",
          message: "EleMintz has sent you 50 XP. Click OK to confirm.",
          payload: { xp: 50, tokens: 0, chests: [] },
          timestamp: "2026-04-05T12:00:00.000Z"
        }
      ]
    });

    assert.equal(modalCalls.length, 1);
    assert.equal(modalCalls[0].title, "Reward Confirmation");
    assert.match(modalCalls[0].bodyHtml, /EleMintz has sent you 50 XP\. Click OK to confirm\./);

    await modalCalls[0].actions?.[0]?.onClick?.();

    assert.deepEqual(confirmCalls, [{ transactionId: "admin-grant-1" }]);
    assert.deepEqual(levelUpCalls, [{
      fromLevel: 34,
      toLevel: 35,
      rewards: [{ kind: "tokens", amount: 50, label: "Level 35 Reward" }],
      playerName: "NoticePlayer"
    }]);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: appController queues admin reward notices until the menu screen is active", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const modalCalls = [];
  const confirmCalls = [];
  const renderedScreens = [];

  global.document = {
    querySelector: () => null
  };

  global.window = {
    elemintz: {
      multiplayer: {
        confirmAdminGrantNotice: async (payload) => {
          confirmCalls.push(payload);
          return {
            transactionId: payload?.transactionId ?? null,
            confirmationStatus: "confirmed"
          };
        }
      }
    }
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  try {
    app.username = "QueuedNoticePlayer";
    app.onlinePlayState = {
      connectionStatus: "connected",
      session: {
        username: "QueuedNoticePlayer",
        authenticated: true
      },
      pendingAdminGrantNotices: [
        {
          transactionId: "queued-admin-grant-1",
          targetUsername: "QueuedNoticePlayer",
          message: "EleMintz has sent you 25 Tokens. Click OK to confirm.",
          payload: { xp: 0, tokens: 25, chests: [] },
          timestamp: "2026-04-05T12:00:00.000Z"
        }
      ]
    };
    app.screenFlow = "login";
    app.renderMenuScreen = () => {
      renderedScreens.push("menu");
    };
    app.refreshDailyChallengesForMenu = async () => {};
    app.updateOnlineReconnectReminderModal = () => {};
    app.maybeShowLoadoutUnlockNotice = () => {};
    app.syncOnlinePlayState = async () => app.onlinePlayState;

    app.maybeShowPendingAdminGrantNotice(app.onlinePlayState);

    assert.equal(modalCalls.length, 0);
    assert.deepEqual(app.queuedAdminGrantNoticeIds, ["queued-admin-grant-1"]);

    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await Promise.resolve();

    assert.deepEqual(renderedScreens, ["menu"]);
    assert.equal(modalCalls.length, 1);
    assert.equal(modalCalls[0].title, "Reward Confirmation");
    assert.match(modalCalls[0].bodyHtml, /25 Tokens/);

    await modalCalls[0].actions?.[0]?.onClick?.();

    assert.deepEqual(confirmCalls, [{ transactionId: "queued-admin-grant-1" }]);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: admin reward confirmation does not show a Level Up toast without a level increase", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const modalCalls = [];
  const multiplayerListeners = [];
  const levelUpCalls = [];

  global.document = {
    querySelector: () => null
  };

  global.window = {
    elemintz: {
      multiplayer: {
        onUpdate: (listener) => {
          multiplayerListeners.push(listener);
          return () => {};
        },
        confirmAdminGrantNotice: async (payload) => ({
          transactionId: payload?.transactionId ?? null,
          confirmationStatus: "confirmed",
          result: {
            applied: {
              levelBefore: 20,
              levelAfter: 20,
              levelRewards: []
            }
          }
        }),
        getState: async () => ({
          connectionStatus: "connected",
          session: {
            username: "NoticePlayer",
            authenticated: true
          },
          pendingAdminGrantNotices: []
        })
      }
    }
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: {
      show: () => {},
      showLevelUp: (payload) => levelUpCalls.push(payload)
    }
  });

  try {
    app.username = "NoticePlayer";
    app.screenFlow = "menu";
    app.bindOnlinePlayUpdates();

    multiplayerListeners[0]?.({
      connectionStatus: "connected",
      session: {
        username: "NoticePlayer",
        authenticated: true
      },
      pendingAdminGrantNotices: [
        {
          transactionId: "admin-grant-2",
          targetUsername: "NoticePlayer",
          message: "EleMintz has sent you 10 XP. Click OK to confirm.",
          payload: { xp: 10, tokens: 0, chests: [] },
          timestamp: "2026-04-05T12:05:00.000Z"
        }
      ]
    });

    await modalCalls[0].actions?.[0]?.onClick?.();

    assert.equal(levelUpCalls.length, 0);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: new cosmetics announcement appears once for an unseen profile on the menu", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const modalCalls = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  global.document = {
    querySelector: () => null
  };
  global.window = {
    elemintz: {
      state: {
        acknowledgeAnnouncement: async ({ username, key }) => ({
          key,
          seen: true,
          profile: {
            username,
            seenAnnouncements: {
              [key]: true
            }
          }
        })
      }
    }
  };

  try {
    app.username = "AnnouncementUser";
    app.profile = {
      username: "AnnouncementUser",
      seenAnnouncements: {},
      equippedCosmetics: { background: "default_background" }
    };
    app.releaseQueuedAdminGrantNotice = () => {};
    app.maybeShowLoadoutUnlockNotice = async () => {};
    app.refreshDailyChallengesForMenu = async () => {};
    app.updateOnlineReconnectReminderModal = () => {};

    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(modalCalls.length, 1);
    assert.equal(modalCalls[0].title, "New Cosmetics Added!");
    assert.match(modalCalls[0].bodyHtml, /26 new titles and avatars are now available in the Store\./);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: dismissing the new cosmetics announcement marks it seen and keeps the current screen", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const modalCalls = [];
  const ackCalls = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  global.document = {
    querySelector: () => null
  };
  global.window = {
    elemintz: {
      state: {
        acknowledgeAnnouncement: async (payload) => {
          ackCalls.push(payload);
          return {
            key: payload.key,
            seen: true,
            profile: {
              username: payload.username,
              seenAnnouncements: {
                [payload.key]: true
              }
            }
          };
        }
      }
    }
  };

  try {
    app.username = "AnnouncementUser";
    app.profile = {
      username: "AnnouncementUser",
      seenAnnouncements: {},
      equippedCosmetics: { background: "default_background" }
    };
    app.screenFlow = "menu";

    await app.maybeShowNewCosmeticsAnnouncement();
    await modalCalls[0].actions?.[1]?.onClick?.();

    assert.deepEqual(ackCalls, [{ username: "AnnouncementUser", key: "cosmetics_v0.1.6" }]);
    assert.equal(app.profile.seenAnnouncements["cosmetics_v0.1.6"], true);
    assert.equal(app.screenFlow, "menu");

    app.releaseQueuedAdminGrantNotice = () => {};
    app.maybeShowLoadoutUnlockNotice = async () => {};
    app.refreshDailyChallengesForMenu = async () => {};
    app.updateOnlineReconnectReminderModal = () => {};
    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(modalCalls.length, 1);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: opening the store from the new cosmetics announcement marks it seen and navigates", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const modalCalls = [];
  const ackCalls = [];
  const storeCalls = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  global.document = {
    querySelector: () => null
  };
  global.window = {
    elemintz: {
      state: {
        acknowledgeAnnouncement: async (payload) => {
          ackCalls.push(payload);
          return {
            key: payload.key,
            seen: true,
            profile: {
              username: payload.username,
              seenAnnouncements: {
                [payload.key]: true
              }
            }
          };
        }
      }
    }
  };

  try {
    app.username = "AnnouncementUser";
    app.profile = {
      username: "AnnouncementUser",
      seenAnnouncements: {},
      equippedCosmetics: { background: "default_background" }
    };
    app.screenFlow = "menu";
    app.showStore = async () => {
      storeCalls.push("store");
    };

    await app.maybeShowNewCosmeticsAnnouncement();
    await modalCalls[0].actions?.[0]?.onClick?.();

    assert.deepEqual(ackCalls, [{ username: "AnnouncementUser", key: "cosmetics_v0.1.6" }]);
    assert.equal(app.profile.seenAnnouncements["cosmetics_v0.1.6"], true);
    assert.deepEqual(storeCalls, ["store"]);

    app.releaseQueuedAdminGrantNotice = () => {};
    app.maybeShowLoadoutUnlockNotice = async () => {};
    app.refreshDailyChallengesForMenu = async () => {};
    app.updateOnlineReconnectReminderModal = () => {};
    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(modalCalls.length, 1);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: dismissing the new cosmetics announcement persists it through the authenticated multiplayer profile path", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const modalCalls = [];
  const multiplayerAckCalls = [];
  const localAckCalls = [];
  let seenOnServer = false;
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  global.document = {
    querySelector: () => null
  };
  global.window = {
    elemintz: {
      state: {
        acknowledgeAnnouncement: async ({ username, key }) => {
          localAckCalls.push({ username, key });
          return {
            key,
            seen: true,
            profile: {
              username,
              seenAnnouncements: {
                [key]: true
              },
              equippedCosmetics: { background: "default_background" }
            }
          };
        },
        getProfile: async (username) => ({
          username,
          seenAnnouncements: seenOnServer ? { "cosmetics_v0.1.6": true } : {},
          equippedCosmetics: { background: "default_background" }
        })
      },
      multiplayer: {
        getProfile: async ({ username }) => ({
          username,
          profile: {
            username,
            seenAnnouncements: seenOnServer ? { "cosmetics_v0.1.6": true } : {},
            equippedCosmetics: { background: "default_background" }
          }
        }),
        acknowledgeAnnouncement: async (payload) => {
          multiplayerAckCalls.push(payload);
          seenOnServer = true;
          return {
            key: payload.key,
            seen: true,
            snapshot: {
              username: payload.username,
              profile: {
                username: payload.username,
                seenAnnouncements: {
                  [payload.key]: true
                },
                equippedCosmetics: { background: "default_background" }
              }
            }
          };
        }
      }
    }
  };

  try {
    app.username = "AnnouncementUser";
    app.profile = {
      username: "AnnouncementUser",
      seenAnnouncements: {},
      equippedCosmetics: { background: "default_background" }
    };
    app.onlinePlayState = {
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "AnnouncementUser"
      }
    };
    app.screenFlow = "menu";

    await app.maybeShowNewCosmeticsAnnouncement();
    await modalCalls[0].actions?.[1]?.onClick?.();

    assert.deepEqual(localAckCalls, [{ username: "AnnouncementUser", key: "cosmetics_v0.1.6" }]);
    assert.deepEqual(multiplayerAckCalls, [{ username: "AnnouncementUser", key: "cosmetics_v0.1.6" }]);
    assert.equal(app.profile.seenAnnouncements["cosmetics_v0.1.6"], true);

    app.profile = null;
    await app.loadPreferredProfileForOnlineSession({
      username: "AnnouncementUser",
      onlineState: app.onlinePlayState,
      allowEnsureLocal: false
    });

    const shownAfterRelogin = await app.maybeShowNewCosmeticsAnnouncement();
    assert.equal(shownAfterRelogin, false);
    assert.equal(app.profile.seenAnnouncements["cosmetics_v0.1.6"], true);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: opening the store from the new cosmetics announcement persists it through the authenticated multiplayer profile path", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const modalCalls = [];
  const multiplayerAckCalls = [];
  const localAckCalls = [];
  const storeCalls = [];
  let seenOnServer = false;
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  global.document = {
    querySelector: () => null
  };
  global.window = {
    elemintz: {
      state: {
        acknowledgeAnnouncement: async ({ username, key }) => {
          localAckCalls.push({ username, key });
          return {
            key,
            seen: true,
            profile: {
              username,
              seenAnnouncements: {
                [key]: true
              },
              equippedCosmetics: { background: "default_background" }
            }
          };
        },
        getProfile: async (username) => ({
          username,
          seenAnnouncements: seenOnServer ? { "cosmetics_v0.1.6": true } : {},
          equippedCosmetics: { background: "default_background" }
        })
      },
      multiplayer: {
        getProfile: async ({ username }) => ({
          username,
          profile: {
            username,
            seenAnnouncements: seenOnServer ? { "cosmetics_v0.1.6": true } : {},
            equippedCosmetics: { background: "default_background" }
          }
        }),
        acknowledgeAnnouncement: async (payload) => {
          multiplayerAckCalls.push(payload);
          seenOnServer = true;
          return {
            key: payload.key,
            seen: true,
            snapshot: {
              username: payload.username,
              profile: {
                username: payload.username,
                seenAnnouncements: {
                  [payload.key]: true
                },
                equippedCosmetics: { background: "default_background" }
              }
            }
          };
        }
      }
    }
  };

  try {
    app.username = "AnnouncementUser";
    app.profile = {
      username: "AnnouncementUser",
      seenAnnouncements: {},
      equippedCosmetics: { background: "default_background" }
    };
    app.onlinePlayState = {
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "AnnouncementUser"
      }
    };
    app.screenFlow = "menu";
    app.showStore = async () => {
      storeCalls.push("store");
    };

    await app.maybeShowNewCosmeticsAnnouncement();
    await modalCalls[0].actions?.[0]?.onClick?.();

    assert.deepEqual(localAckCalls, [{ username: "AnnouncementUser", key: "cosmetics_v0.1.6" }]);
    assert.deepEqual(multiplayerAckCalls, [{ username: "AnnouncementUser", key: "cosmetics_v0.1.6" }]);
    assert.equal(app.profile.seenAnnouncements["cosmetics_v0.1.6"], true);
    assert.deepEqual(storeCalls, ["store"]);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: relogin path keeps the announcement hidden when local persistence is ahead of the multiplayer snapshot", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const modalCalls = [];
  let localSeen = false;
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  global.document = {
    querySelector: () => null
  };
  global.window = {
    elemintz: {
      state: {
        acknowledgeAnnouncement: async ({ username, key }) => {
          localSeen = true;
          return {
            key,
            seen: true,
            profile: {
              username,
              seenAnnouncements: {
                [key]: true
              },
              equippedCosmetics: { background: "default_background" }
            }
          };
        },
        getProfile: async (username) => ({
          username,
          seenAnnouncements: localSeen ? { "cosmetics_v0.1.6": true } : {},
          equippedCosmetics: { background: "default_background" }
        })
      },
      multiplayer: {
        getProfile: async ({ username }) => ({
          username,
          profile: {
            username,
            seenAnnouncements: {},
            equippedCosmetics: { background: "default_background" }
          }
        }),
        acknowledgeAnnouncement: async ({ username, key }) => ({
          key,
          seen: true,
          snapshot: {
            username,
            profile: {
              username,
              seenAnnouncements: {},
              equippedCosmetics: { background: "default_background" }
            }
          }
        })
      }
    }
  };

  try {
    app.username = "AnnouncementUser";
    app.profile = {
      username: "AnnouncementUser",
      seenAnnouncements: {},
      equippedCosmetics: { background: "default_background" }
    };
    app.onlinePlayState = {
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "AnnouncementUser"
      }
    };
    app.screenFlow = "menu";

    await app.maybeShowNewCosmeticsAnnouncement();
    await modalCalls[0].actions?.[1]?.onClick?.();

    app.profile = null;
    modalCalls.length = 0;
    await app.loadPreferredProfileForOnlineSession({
      username: "AnnouncementUser",
      onlineState: app.onlinePlayState,
      allowEnsureLocal: false
    });

    const shownAfterRelogin = await app.maybeShowNewCosmeticsAnnouncement();
    assert.equal(shownAfterRelogin, false);
    assert.equal(app.profile.seenAnnouncements["cosmetics_v0.1.6"], true);
    assert.equal(modalCalls.length, 0);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: app restart path keeps the announcement hidden after daily login refresh rebuilds the profile", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const modalCalls = [];
  let durableSeen = true;
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  global.document = {
    querySelector: () => null
  };
  global.window = {
    elemintz: {
      state: {
        getProfile: async (username) => ({
          username,
          seenAnnouncements: durableSeen ? { "cosmetics_v0.1.6": true } : {},
          equippedCosmetics: { background: "default_background" }
        })
      },
      multiplayer: {
        getProfile: async ({ username }) => ({
          username,
          profile: {
            username,
            seenAnnouncements: durableSeen ? { "cosmetics_v0.1.6": true } : {},
            equippedCosmetics: { background: "default_background" }
          }
        }),
        claimDailyLoginReward: async ({ username }) => ({
          granted: false,
          profile: {
            username,
            equippedCosmetics: { background: "default_background" }
          },
          snapshot: {
            username,
            profile: {
              username,
              seenAnnouncements: durableSeen ? { "cosmetics_v0.1.6": true } : {},
              equippedCosmetics: { background: "default_background" }
            }
          }
        })
      }
    }
  };

  try {
    app.username = "AnnouncementUser";
    app.onlinePlayState = {
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "AnnouncementUser"
      }
    };
    app.screenFlow = "menu";

    await app.loadPreferredProfileForOnlineSession({
      username: "AnnouncementUser",
      onlineState: app.onlinePlayState,
      allowEnsureLocal: false
    });

    assert.equal(app.profile.seenAnnouncements["cosmetics_v0.1.6"], true);

    await app.ensureDailyLoginAutoClaim({ showToasts: false, requestKey: "restart-test" });

    assert.equal(app.profile.seenAnnouncements["cosmetics_v0.1.6"], true);

    const shownAfterRestart = await app.maybeShowNewCosmeticsAnnouncement();
    assert.equal(shownAfterRestart, false);
    assert.equal(modalCalls.length, 0);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: manual login path keeps the announcement hidden after the durable seen flag is reloaded", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const modalCalls = [];
  let durableSeen = true;
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  global.document = {
    querySelector: () => null
  };
  global.window = {
    elemintz: {
      state: {
        getProfile: async (username) => ({
          username,
          seenAnnouncements: durableSeen ? { "cosmetics_v0.1.6": true } : {},
          equippedCosmetics: { background: "default_background" }
        })
      },
      multiplayer: {
        getProfile: async ({ username }) => ({
          username,
          profile: {
            username,
            seenAnnouncements: durableSeen ? { "cosmetics_v0.1.6": true } : {},
            equippedCosmetics: { background: "default_background" }
          }
        })
      }
    }
  };

  try {
    app.username = "AnnouncementUser";
    app.onlinePlayState = {
      connectionStatus: "connected",
      session: {
        authenticated: true,
        username: "AnnouncementUser"
      }
    };
    app.screenFlow = "menu";

    await app.loadPreferredProfileForOnlineSession({
      username: "AnnouncementUser",
      onlineState: app.onlinePlayState,
      allowEnsureLocal: false
    });

    assert.equal(app.profile.seenAnnouncements["cosmetics_v0.1.6"], true);

    const shownAfterManualLogin = await app.maybeShowNewCosmeticsAnnouncement();
    assert.equal(shownAfterManualLogin, false);
    assert.equal(modalCalls.length, 0);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: new cosmetics announcement does not show again after being seen", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const modalCalls = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  global.document = {
    querySelector: () => null
  };
  global.window = {
    elemintz: {
      state: {
        acknowledgeAnnouncement: async () => ({ seen: true })
      }
    }
  };

  try {
    app.username = "AnnouncementUser";
    app.profile = {
      username: "AnnouncementUser",
      seenAnnouncements: {
        "cosmetics_v0.1.6": true
      },
      equippedCosmetics: { background: "default_background" }
    };
    app.screenFlow = "menu";

    const shown = await app.maybeShowNewCosmeticsAnnouncement();
    assert.equal(shown, false);
    assert.equal(modalCalls.length, 0);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: new cosmetics announcement does not show during active game flow", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const modalCalls = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  global.document = {
    querySelector: () => null
  };
  global.window = {
    elemintz: {
      state: {
        acknowledgeAnnouncement: async () => ({ seen: true })
      }
    }
  };

  try {
    app.username = "AnnouncementUser";
    app.profile = {
      username: "AnnouncementUser",
      seenAnnouncements: {},
      equippedCosmetics: { background: "default_background" }
    };
    app.screenFlow = "game";

    const shown = await app.maybeShowNewCosmeticsAnnouncement();
    assert.equal(shown, false);
    assert.equal(modalCalls.length, 0);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: a different profile without the announcement flag still gets the cosmetics popup", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const modalCalls = [];
  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  global.document = {
    querySelector: () => null
  };
  global.window = {
    elemintz: {
      state: {
        acknowledgeAnnouncement: async ({ username, key }) => ({
          key,
          seen: true,
          profile: {
            username,
            seenAnnouncements: {
              [key]: true
            }
          }
        })
      }
    }
  };

  try {
    app.releaseQueuedAdminGrantNotice = () => {};
    app.maybeShowLoadoutUnlockNotice = async () => {};
    app.refreshDailyChallengesForMenu = async () => {};
    app.updateOnlineReconnectReminderModal = () => {};

    app.username = "SeenPlayer";
    app.profile = {
      username: "SeenPlayer",
      seenAnnouncements: {
        "cosmetics_v0.1.6": true
      },
      equippedCosmetics: { background: "default_background" }
    };
    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await Promise.resolve();
    await Promise.resolve();

    app.username = "FreshPlayer";
    app.profile = {
      username: "FreshPlayer",
      seenAnnouncements: {},
      equippedCosmetics: { background: "default_background" }
    };
    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(modalCalls.length, 1);
    assert.equal(modalCalls[0].title, "New Cosmetics Added!");
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: temporary announcement debug logs are removed from runtime source files", () => {
  const appControllerSource = fs.readFileSync(
    "C:\\Users\\mxz\\Desktop\\Projects\\Codex EleMintz PC\\src\\renderer\\systems\\appController.js",
    "utf8"
  );
  const stateCoordinatorSource = fs.readFileSync(
    "C:\\Users\\mxz\\Desktop\\Projects\\Codex EleMintz PC\\src\\state\\stateCoordinator.js",
    "utf8"
  );
  const profileAuthoritySource = fs.readFileSync(
    "C:\\Users\\mxz\\Desktop\\Projects\\Codex EleMintz PC\\src\\multiplayer\\profileAuthority.js",
    "utf8"
  );

  assert.equal(appControllerSource.includes("[AnnouncementDebug]"), false);
  assert.equal(stateCoordinatorSource.includes("[AnnouncementDebug]"), false);
  assert.equal(profileAuthoritySource.includes("[AnnouncementDebug]"), false);
});

test("ui: renderer-shared state modules do not import the server-only boost event store or node-only server modules", () => {
  const stateCoordinatorSource = fs.readFileSync(
    "C:\\Users\\mxz\\Desktop\\Projects\\Codex EleMintz PC\\src\\state\\stateCoordinator.js",
    "utf8"
  );
  const dailyChallengesSource = fs.readFileSync(
    "C:\\Users\\mxz\\Desktop\\Projects\\Codex EleMintz PC\\src\\state\\dailyChallengesSystem.js",
    "utf8"
  );
  const sharedBoostRulesSource = fs.readFileSync(
    "C:\\Users\\mxz\\Desktop\\Projects\\Codex EleMintz PC\\src\\shared\\boostEventRules.js",
    "utf8"
  );

  assert.equal(stateCoordinatorSource.includes("../multiplayer/boostEventStore.js"), false);
  assert.equal(dailyChallengesSource.includes("../multiplayer/boostEventStore.js"), false);
  assert.equal(stateCoordinatorSource.includes("node:path"), false);
  assert.equal(stateCoordinatorSource.includes("fs/promises"), false);
  assert.equal(dailyChallengesSource.includes("node:path"), false);
  assert.equal(dailyChallengesSource.includes("fs/promises"), false);
  assert.equal(sharedBoostRulesSource.includes("node:path"), false);
  assert.equal(sharedBoostRulesSource.includes("fs/promises"), false);
});

test("ui: appController refreshes the open profile screen when an admin reward notice arrives", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const modalCalls = [];
  const multiplayerListeners = [];
  const profileRefreshes = [];

  global.document = {
    querySelector: () => null
  };

  global.window = {
    elemintz: {
      multiplayer: {
        onUpdate: (listener) => {
          multiplayerListeners.push(listener);
          return () => {};
        },
        confirmAdminGrantNotice: async () => ({
          confirmationStatus: "confirmed"
        })
      }
    }
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  try {
    app.username = "ProfileNoticePlayer";
    app.screenFlow = "profile";
    app.showProfile = async ({ preserveModal = false } = {}) => {
      profileRefreshes.push({ preserveModal });
    };
    app.bindOnlinePlayUpdates();

    multiplayerListeners[0]?.({
      connectionStatus: "connected",
      session: {
        username: "ProfileNoticePlayer",
        authenticated: true
      },
      pendingAdminGrantNotices: [
        {
          transactionId: "profile-notice-1",
          targetUsername: "ProfileNoticePlayer",
          message: "EleMintz has sent you 30 XP. Click OK to confirm.",
          payload: { xp: 30, tokens: 0, chests: [] },
          timestamp: "2026-04-05T12:00:00.000Z"
        }
      ]
    });

    assert.deepEqual(profileRefreshes, [{ preserveModal: true }]);
    assert.equal(modalCalls.length, 1);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: appController refreshes the open profile screen after confirming an admin reward notice", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const modalCalls = [];
  const confirmCalls = [];
  const profileRefreshes = [];

  global.document = {
    querySelector: () => null
  };

  global.window = {
    elemintz: {
      multiplayer: {
        confirmAdminGrantNotice: async (payload) => {
          confirmCalls.push(payload);
          return {
            transactionId: payload?.transactionId ?? null,
            confirmationStatus: "confirmed"
          };
        }
      }
    }
  };

  const app = new AppController({
    screenManager: {
      register: () => {},
      show: () => {}
    },
    modalManager: {
      show: (payload) => modalCalls.push(payload),
      hide: () => {}
    },
    toastManager: { show: () => {} }
  });

  try {
    app.username = "ProfileConfirmPlayer";
    app.screenFlow = "profile";
    app.onlinePlayState = {
      connectionStatus: "connected",
      session: {
        username: "ProfileConfirmPlayer",
        authenticated: true
      },
      pendingAdminGrantNotices: [
        {
          transactionId: "profile-confirm-1",
          targetUsername: "ProfileConfirmPlayer",
          message: "EleMintz has sent you 10 Tokens. Click OK to confirm.",
          payload: { xp: 0, tokens: 10, chests: [] },
          timestamp: "2026-04-05T12:00:00.000Z"
        }
      ]
    };
    app.showProfile = async ({ preserveModal = false } = {}) => {
      profileRefreshes.push({ preserveModal });
    };
    app.syncOnlinePlayState = async () => {
      app.onlinePlayState = {
        ...app.onlinePlayState,
        pendingAdminGrantNotices: []
      };
      return app.onlinePlayState;
    };

    app.maybeShowPendingAdminGrantNotice(app.onlinePlayState);
    await modalCalls[0].actions?.[0]?.onClick?.();

    assert.deepEqual(confirmCalls, [{ transactionId: "profile-confirm-1" }]);
    assert.deepEqual(profileRefreshes, [{ preserveModal: false }]);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("ui: profile unlocked achievements render comeback_win badge once earned", () => {
  const html = profileScreen.render({
    profile: {
      username: "ComebackHero",
      title: "Initiate",
      wins: 3,
      losses: 2,
      warsEntered: 1,
      warsWon: 1,
      longestWar: 1,
      cardsCaptured: 5,
      gamesPlayed: 5,
      bestWinStreak: 2,
      tokens: 10,
      achievements: {
        comeback_win: {
          count: 1,
          firstUnlockedAt: "2026-03-10T00:00:00.000Z",
          lastUnlockedAt: "2026-03-10T00:00:00.000Z"
        }
      },
      modeStats: { pve: { wins: 3, losses: 2 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: {
          fire: "default_fire_card",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default Card Back", owned: true }],
        background: [{ id: "default_background", name: "EleMintz Table", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    titleIcon: null,
    backgroundImage: "assets/EleMintzIcon.png",
    searchQuery: "",
    searchResults: [],
    profileAchievementsExpanded: true,
    viewedProfileAchievementsExpanded: false,
    viewedProfile: null,
    actions: {
      equip: () => {},
      searchProfiles: () => {},
      viewProfile: () => {},
      clearViewed: () => {},
      back: () => {}
    }
  });

  assert.match(html, /Come Back Win/);
  assert.match(html, /assets\/badges\/comeback_win\.png/);
});

test("ui: profile unlocked achievements treat legacy boolean comeback_win as unlocked", () => {
  const html = profileScreen.render({
    profile: {
      username: "LegacyComebackHero",
      title: "Initiate",
      wins: 1,
      losses: 0,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 0,
      gamesPlayed: 1,
      bestWinStreak: 1,
      tokens: 0,
      achievements: {
        comeback_win: true
      },
      modeStats: { pve: { wins: 1, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        elementCardVariant: {
          fire: "default_fire_card",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        },
        badge: "none",
        title: "Initiate"
      },
      catalog: {
        avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }],
        cardBack: [{ id: "default_card_back", name: "Default Card Back", owned: true }],
        background: [{ id: "default_background", name: "EleMintz Table", owned: true }],
        elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }],
        badge: [{ id: "none", name: "No Badge", owned: true }],
        title: [{ id: "Initiate", name: "Initiate", owned: true }]
      }
    },
    titleIcon: null,
    backgroundImage: "assets/EleMintzIcon.png",
    searchQuery: "",
    searchResults: [],
    profileAchievementsExpanded: true,
    viewedProfileAchievementsExpanded: false,
    viewedProfile: null,
    actions: {
      equip: () => {},
      searchProfiles: () => {},
      viewProfile: () => {},
      clearViewed: () => {},
      back: () => {}
    }
  });

  assert.match(html, /Come Back Win/);
  assert.match(html, /assets\/badges\/comeback_win\.png/);
});

test("ui: match complete payload renders polished PvE winner, stats, and actions", () => {
  const controller = createRendererController();
  controller.username = "VampyrLee";
  controller.profile = { username: "VampyrLee" };
  controller.gameController = { captured: { p1: 4, p2: 3 } };

  const payload = controller.buildMatchCompleteModalPayload(
    "pve",
    {
      winner: "p1",
      endReason: "normal",
      difficulty: "normal",
      history: [
        { result: "p1", capturedCards: 2, capturedOpponentCards: 1 },
        { result: "p2", capturedCards: 6, capturedOpponentCards: 3 },
        { result: "none", capturedCards: 0, capturedOpponentCards: 0 },
        { result: "p1", capturedCards: 6, capturedOpponentCards: 3 }
      ],
      players: {
        p1: { hand: ["fire", "water"] },
        p2: { hand: [] }
      }
    },
    {
      stats: {
        cardsCaptured: 4,
        warsEntered: 2,
        longestWar: 4
      }
    }
  );

  assert.match(payload.bodyHtml, /class="match-complete-modal is-victory"/);
  assert.match(payload.bodyHtml, /<h4 class="match-complete-outcome">Victory<\/h4>/);
  assert.match(payload.bodyHtml, /VampyrLee defeated Elemental AI\./);
  assert.match(payload.bodyHtml, /VampyrLee • 4 \| Elemental AI • 3/);
  assert.match(payload.bodyHtml, /Captured Opponent Cards/);
  assert.match(payload.bodyHtml, /Captured totals reflect opponent cards won across the full match\./);
  assert.match(payload.bodyHtml, /WARs Entered/);
  assert.match(payload.bodyHtml, /Longest WAR/);
  assert.match(payload.bodyHtml, /Rounds Played/);
  assert.match(payload.bodyHtml, /Final Hands/);
  assert.match(payload.bodyHtml, /<strong>Difficulty:<\/strong> Normal/);
  assert.match(payload.bodyHtml, /<strong>XP Gained:<\/strong> 0/);
  assert.match(payload.bodyHtml, /<strong>Tokens Gained:<\/strong> 0/);
  assert.match(payload.bodyHtml, /id="match-complete-play-again"/);
  assert.match(payload.bodyHtml, /id="match-complete-return-menu"/);
});

test("ui: PvE match complete payload shows max level bonus line when xp conversion occurs", () => {
  const controller = createRendererController();
  controller.username = "CapUser";
  controller.profile = { username: "CapUser" };
  controller.gameController = { captured: { p1: 2, p2: 1 } };

  const payload = controller.buildMatchCompleteModalPayload(
    "pve",
    {
      winner: "p1",
      endReason: "normal",
      difficulty: "hard",
      history: [{ result: "p1" }],
      players: {
        p1: { hand: ["fire"] },
        p2: { hand: [] }
      }
    },
    {
      stats: {
        cardsCaptured: 2,
        warsEntered: 1,
        longestWar: 1
      },
      xpDelta: 0,
      tokenDelta: 7,
      xpConversionTokenBonus: 2
    }
  );

  assert.match(payload.bodyHtml, /<strong>Max Level Bonus:<\/strong> \+2 Tokens/);
});

test("ui: PvE match complete payload omits max level bonus line when no xp conversion occurs", () => {
  const controller = createRendererController();
  controller.username = "NoCapUser";
  controller.profile = { username: "NoCapUser" };
  controller.gameController = { captured: { p1: 2, p2: 1 } };

  const payload = controller.buildMatchCompleteModalPayload(
    "pve",
    {
      winner: "p1",
      endReason: "normal",
      difficulty: "hard",
      history: [{ result: "p1" }],
      players: {
        p1: { hand: ["fire"] },
        p2: { hand: [] }
      }
    },
    {
      stats: {
        cardsCaptured: 2,
        warsEntered: 1,
        longestWar: 1
      },
      xpDelta: 4,
      tokenDelta: 5,
      xpConversionTokenBonus: 0
    }
  );

  assert.doesNotMatch(payload.bodyHtml, /<strong>Max Level Bonus:<\/strong>/);
});

test("ui: featured rival match complete payload uses the rival name instead of Elemental AI", () => {
  const controller = createRendererController();
  controller.username = "VampyrLee";
  controller.profile = { username: "VampyrLee" };
  controller.gameController = { captured: { p1: 4, p2: 3 } };
  controller.pveFeaturedRivalId = "crownfire_duelist";
  controller.opponentDisplayName = "Crownfire Duelist";

  const payload = controller.buildMatchCompleteModalPayload(
    "pve",
    {
      winner: "p1",
      endReason: "normal",
      difficulty: "hard",
      history: [
        { result: "p1", capturedCards: 2, capturedOpponentCards: 1 },
        { result: "p2", capturedCards: 6, capturedOpponentCards: 3 },
        { result: "p1", capturedCards: 6, capturedOpponentCards: 3 }
      ],
      players: {
        p1: { hand: ["fire", "water"] },
        p2: { hand: [] }
      }
    },
    {
      stats: {
        cardsCaptured: 4,
        warsEntered: 2,
        longestWar: 4
      }
    }
  );

  assert.match(payload.bodyHtml, /<h4 class="match-complete-outcome">Boss Defeated<\/h4>/);
  assert.match(payload.bodyHtml, /You defeated Crownfire Duelist\./);
  assert.match(payload.bodyHtml, /VampyrLee • 4 \| Crownfire Duelist • 3/);
  assert.doesNotMatch(payload.bodyHtml, /Elemental AI/);
  assert.deepEqual(payload.startOptions, { featuredRivalId: "crownfire_duelist" });
});

test("ui: featured rival match complete payload shows the Crownfire first-win bonus when earned", () => {
  const controller = createRendererController();
  controller.username = "VampyrLee";
  controller.profile = { username: "VampyrLee" };
  controller.gameController = { captured: { p1: 4, p2: 3 } };
  controller.pveFeaturedRivalId = "crownfire_duelist";
  controller.opponentDisplayName = "Crownfire Duelist";

  const payload = controller.buildMatchCompleteModalPayload(
    "pve",
    {
      winner: "p1",
      endReason: "normal",
      difficulty: "hard",
      history: [{ result: "p1" }],
      players: {
        p1: { hand: ["fire", "water"] },
        p2: { hand: [] }
      }
    },
    {
      stats: {
        cardsCaptured: 4,
        warsEntered: 2,
        longestWar: 4
      },
      xpDelta: 47,
      tokenDelta: 27,
      featuredRivalReward: {
        rivalId: "crownfire_duelist",
        granted: true,
        xpDelta: 30,
        tokenDelta: 15,
        label: "Crownfire First Win Bonus"
      }
    }
  );

  assert.match(payload.bodyHtml, /<strong>Crownfire First Win Bonus:<\/strong> \+30 XP \/ \+15 tokens/);
});

test("ui: featured rival match complete payload uses boss-specific loss wording", () => {
  const controller = createRendererController();
  controller.username = "VampyrLee";
  controller.profile = { username: "VampyrLee" };
  controller.gameController = { captured: { p1: 3, p2: 5 } };
  controller.pveFeaturedRivalId = "crownfire_duelist";
  controller.opponentDisplayName = "Crownfire Duelist";

  const payload = controller.buildMatchCompleteModalPayload(
    "pve",
    {
      winner: "p2",
      endReason: "normal",
      difficulty: "hard",
      history: [{ result: "p2" }],
      players: {
        p1: { hand: [] },
        p2: { hand: ["fire", "water"] }
      }
    },
    {
      stats: {
        cardsCaptured: 3,
        warsEntered: 2,
        longestWar: 4
      },
      featuredRivalReward: {
        rivalId: "crownfire_duelist",
        granted: false,
        xpDelta: 0,
        tokenDelta: 0,
        label: "Crownfire First Win Bonus"
      }
    }
  );

  assert.match(payload.bodyHtml, /<h4 class="match-complete-outcome">Boss Survived<\/h4>/);
  assert.match(payload.bodyHtml, /Crownfire Duelist defeated you\./);
  assert.match(payload.bodyHtml, /No Crownfire First Win Bonus earned\./);
  assert.doesNotMatch(payload.bodyHtml, /<strong>Crownfire First Win Bonus:<\/strong>/);
});

test("ui: featured rival match complete payload keeps boost messaging separate from the Crownfire bonus", () => {
  const controller = createRendererController();
  controller.username = "VampyrLee";
  controller.profile = { username: "VampyrLee" };
  controller.gameController = { captured: { p1: 4, p2: 3 } };
  controller.pveFeaturedRivalId = "crownfire_duelist";
  controller.opponentDisplayName = "Crownfire Duelist";

  const payload = controller.buildMatchCompleteModalPayload(
    "pve",
    {
      winner: "p1",
      endReason: "normal",
      difficulty: "hard",
      history: [{ result: "p1" }],
      players: {
        p1: { hand: ["fire", "water"] },
        p2: { hand: [] }
      }
    },
    {
      stats: {
        cardsCaptured: 4,
        warsEntered: 2,
        longestWar: 4
      },
      xpDelta: 62,
      tokenDelta: 39,
      featuredRivalReward: {
        rivalId: "crownfire_duelist",
        granted: true,
        xpDelta: 30,
        tokenDelta: 15,
        label: "Crownfire First Win Bonus"
      },
      boostDisplay: {
        xpApplied: true,
        tokenApplied: true,
        xpMultiplier: 2,
        tokenMultiplier: 2
      }
    }
  );

  assert.match(payload.bodyHtml, /<strong>Crownfire First Win Bonus:<\/strong> \+30 XP \/ \+15 tokens/);
  assert.match(payload.bodyHtml, /<strong>Boost Event:<\/strong> 2x XP \/ 2x Tokens applied/);
});

test("ui: PvE match complete payload prefers authoritative live capture totals over trimmed history", () => {
  const controller = createRendererController();
  controller.username = "VampyrLee";
  controller.profile = { username: "VampyrLee" };
  controller.gameController = { captured: { p1: 8, p2: 0 } };

  const payload = controller.buildMatchCompleteModalPayload(
    "pve",
    {
      winner: "p1",
      endReason: "hand_exhaustion",
      mode: "pve",
      difficulty: "hard",
      history: [
        { result: "p1", capturedCards: 2, capturedOpponentCards: 1, warClashes: 0 },
        { result: "p2", capturedCards: 6, capturedOpponentCards: 3, warClashes: 2 },
        { result: "none", capturedCards: 0, capturedOpponentCards: 0, warClashes: 0 },
        { result: "p1", capturedCards: 6, capturedOpponentCards: 3, warClashes: 2 }
      ],
      players: {
        p1: { hand: ["fire", "water", "earth", "wind", "fire", "water", "earth", "wind"] },
        p2: { hand: [] }
      }
    },
    {
      stats: {
        cardsCaptured: 8,
        warsEntered: 2,
        longestWar: 4
      },
      xpDelta: 17,
      tokenDelta: 12,
      xpBreakdown: {
        lines: [
          { label: "Match Win", amount: 6 },
          { label: "WAR Winner", amount: 6 },
          { label: "Hard AI Victory Bonus", amount: 5 }
        ],
        total: 17
      },
      boostDisplay: {
        xpApplied: true,
        tokenApplied: true,
        xpMultiplier: 2,
        tokenMultiplier: 1.5
      }
    }
  );

  assert.match(payload.bodyHtml, /VampyrLee.*8 \| Elemental AI.*0/);
  assert.match(payload.bodyHtml, /<strong class="match-complete-stat-value">8 \| 0<\/strong>/);
  assert.match(payload.bodyHtml, /<strong>End Reason:<\/strong> hand_exhaustion/);
  assert.match(payload.bodyHtml, /<strong>Difficulty:<\/strong> Hard/);
  assert.match(payload.bodyHtml, /<strong>XP Gained:<\/strong> 17/);
  assert.match(payload.bodyHtml, /<strong>Tokens Gained:<\/strong> 12/);
  assert.match(payload.bodyHtml, /<strong>Hard AI Victory Bonus:<\/strong> \+5 XP \/ \+5 tokens/);
  assert.match(payload.bodyHtml, /<strong>Boost Event:<\/strong> 2x XP \/ 1\.5x Tokens applied/);
  assert.match(payload.bodyHtml, /<strong>Basic Chest Win Chance:<\/strong> 12%/);
  assert.doesNotMatch(payload.bodyHtml, /Crownfire First Win Bonus/);
});

test("ui: PvE match complete payload shows boost line when only XP boost applies", () => {
  const controller = createRendererController();
  controller.username = "BoostXPOnly";
  controller.profile = { username: "BoostXPOnly" };
  controller.gameController = { captured: { p1: 3, p2: 2 } };

  const payload = controller.buildMatchCompleteModalPayload(
    "pve",
    {
      winner: "p1",
      endReason: "normal",
      mode: "pve",
      difficulty: "normal",
      history: [{ result: "p1" }, { result: "p2" }, { result: "p1" }],
      players: {
        p1: { hand: ["fire"] },
        p2: { hand: [] }
      }
    },
    {
      stats: {
        cardsCaptured: 3,
        warsEntered: 1,
        longestWar: 2
      },
      xpDelta: 12,
      tokenDelta: 8,
      boostDisplay: {
        xpApplied: true,
        tokenApplied: false,
        xpMultiplier: 2,
        tokenMultiplier: 1
      }
    }
  );

  assert.match(payload.bodyHtml, /<strong>Boost Event:<\/strong> 2x XP applied/);
});

test("ui: PvE match complete payload shows boost line when only token boost applies", () => {
  const controller = createRendererController();
  controller.username = "BoostTokenOnly";
  controller.profile = { username: "BoostTokenOnly" };
  controller.gameController = { captured: { p1: 3, p2: 2 } };

  const payload = controller.buildMatchCompleteModalPayload(
    "pve",
    {
      winner: "p1",
      endReason: "normal",
      mode: "pve",
      difficulty: "normal",
      history: [{ result: "p1" }, { result: "p2" }, { result: "p1" }],
      players: {
        p1: { hand: ["fire"] },
        p2: { hand: [] }
      }
    },
    {
      stats: {
        cardsCaptured: 3,
        warsEntered: 1,
        longestWar: 2
      },
      xpDelta: 9,
      tokenDelta: 11,
      boostDisplay: {
        xpApplied: false,
        tokenApplied: true,
        xpMultiplier: 1,
        tokenMultiplier: 1.5
      }
    }
  );

  assert.match(payload.bodyHtml, /<strong>Boost Event:<\/strong> 1\.5x Tokens applied/);
});

test("ui: PvE match complete payload omits boost line when no boost applied", () => {
  const controller = createRendererController();
  controller.username = "NoBoost";
  controller.profile = { username: "NoBoost" };
  controller.gameController = { captured: { p1: 2, p2: 1 } };

  const payload = controller.buildMatchCompleteModalPayload(
    "pve",
    {
      winner: "p1",
      endReason: "normal",
      mode: "pve",
      difficulty: "normal",
      history: [{ result: "p1" }, { result: "p1" }],
      players: {
        p1: { hand: ["fire"] },
        p2: { hand: [] }
      }
    },
    {
      stats: {
        cardsCaptured: 2,
        warsEntered: 0,
        longestWar: 0
      },
      xpDelta: 6,
      tokenDelta: 5,
      boostDisplay: null
    }
  );

  assert.doesNotMatch(payload.bodyHtml, /<strong>Boost Event:<\/strong>/);
});

test("ui: easy PvE match complete payload shows practice-mode reward suppression clarity", () => {
  const controller = createRendererController();
  controller.username = "test";
  controller.profile = { username: "test" };
  controller.gameController = { captured: { p1: 0, p2: 0 } };

  const payload = controller.buildMatchCompleteModalPayload(
    "pve",
    {
      winner: "p2",
      endReason: "hand_exhaustion",
      mode: "pve",
      difficulty: "easy",
      history: [],
      players: {
        p1: { hand: [] },
        p2: { hand: ["fire", "water"] }
      }
    },
    {
      stats: {
        cardsCaptured: 0,
        warsEntered: 0,
        longestWar: 0
      },
      xpDelta: 0,
      tokenDelta: 0
    }
  );

  assert.match(payload.bodyHtml, /<strong>Difficulty:<\/strong> Easy \/ Practice Mode/);
  assert.match(payload.bodyHtml, /No rewards, stats, achievements, or challenge progress\./);
});

test("ui: match complete payload renders polished local PvP naming and draw state", () => {
  const controller = createRendererController();
  controller.localPlayers = { p1: "Asha", p2: "Bram" };

  const payload = controller.buildMatchCompleteModalPayload(
    "local_pvp",
    {
      winner: "draw",
      endReason: "time_limit",
      history: [{ result: "p1" }, { result: "p2" }, { result: "war" }, { result: "draw" }]
    },
    {
      p1: { stats: { cardsCaptured: 4, warsEntered: 3, longestWar: 5 } },
      p2: { stats: { cardsCaptured: 6, warsEntered: 2, longestWar: 5 } }
    }
  );

  assert.match(payload.bodyHtml, /class="match-complete-modal is-draw"/);
  assert.match(payload.bodyHtml, /<h4 class="match-complete-outcome">Draw<\/h4>/);
  assert.match(payload.bodyHtml, /Asha and Bram finished even\./);
  assert.match(payload.bodyHtml, /Asha • 4 \| Bram • 6/);
  assert.match(payload.bodyHtml, /<strong class="match-complete-stat-value">3 \| 2<\/strong>/);
  assert.match(payload.bodyHtml, /<strong class="match-complete-stat-value">5 \| 5<\/strong>/);
  assert.match(payload.bodyHtml, /<strong class="match-complete-stat-value">4<\/strong>/);
  assert.doesNotMatch(payload.bodyHtml, /Player 1 •/);
  assert.doesNotMatch(payload.bodyHtml, /Player 2 •/);
});
test("ui: own profile renders top Profile Overview panels near the top", () => {
  const context = createProfileScreenContext({
    profile: {
      ...createProfileScreenContext().profile,
      title: "Elementalist",
      playerLevel: 18,
      playerXP: 640,
      tokens: 345,
      supporterPass: true,
      chests: { basic: 2, milestone: 1, epic: 3, legendary: 4 },
      nextReward: { level: 20, name: "Arena Challenger Badge" },
      gauntletBestStreak: 12,
      gauntletRuns: 18,
      gauntletWins: 11,
      gauntletRivalsDefeated: 26,
      featuredRivalWins: 7,
      equippedCosmetics: {
        avatar: "avatar_neon_pyre_entity",
        title: "title_spellwired",
        badge: "badge_arena_challenger",
        cardBack: "cardback_neon_arcana",
        elementCardVariant: {
          fire: "fire_variant_neon_arcana",
          earth: "earth_variant_neon_arcana",
          wind: "wind_variant_neon_arcana",
          water: "water_variant_neon_arcana"
        }
      }
    },
    cosmetics: {
      ...createProfileScreenContext().cosmetics,
      catalog: getCosmeticCatalogForProfile({
        username: "ChestUser",
        ownedCosmetics: {
          avatar: ["default_avatar", "avatar_neon_pyre_entity"],
          cardBack: ["default_card_back", "cardback_neon_arcana"],
          background: ["default_background"],
          elementCardVariant: [
            "default_fire_card",
            "default_water_card",
            "default_earth_card",
            "default_wind_card",
            "fire_variant_neon_arcana",
            "water_variant_neon_arcana",
            "earth_variant_neon_arcana",
            "wind_variant_neon_arcana"
          ],
          badge: ["none", "badge_arena_challenger"],
          title: ["Initiate", "title_spellwired"]
        },
        equippedCosmetics: {
          avatar: "avatar_neon_pyre_entity",
          cardBack: "cardback_neon_arcana",
          background: "default_background",
          badge: "badge_arena_challenger",
          title: "title_spellwired",
          elementCardVariant: {
            fire: "fire_variant_neon_arcana",
            water: "water_variant_neon_arcana",
            earth: "earth_variant_neon_arcana",
            wind: "wind_variant_neon_arcana"
          }
        }
      })
    }
  });

  const html = profileScreen.render(context);

  assert.match(html, /data-profile-overview="true"/);
  assert.doesNotMatch(html, /data-profile-flex-panel="identity"/);
  assert.doesNotMatch(html, /Equipped Identity/);
  assert.match(html, /data-profile-flex-panel="progress"/);
  assert.match(html, /Progress \/ Account/);
  assert.match(html, /data-profile-overview-level="true">[0-9]+</);
  assert.match(html, /data-profile-overview-xp-value="true">[0-9]+ \/ [0-9]+</);
  assert.match(html, /data-profile-overview-next-reward="true">Lv [0-9]+ - [^<]+</);
  assert.match(html, /data-profile-overview-tokens="true">345</);
  assert.match(html, /data-profile-overview-chest="basic">Basic: 2</);
  assert.match(html, /data-profile-overview-chest="milestone">Milestone: 1</);
  assert.match(html, /data-profile-overview-chest="epic">Epic: 3</);
  assert.match(html, /data-profile-overview-chest="legendary">Legendary: 4</);
  assert.match(html, /data-profile-overview-supporter="true">Active</);
  assert.match(html, /aria-label="XP Progress"/);
  assert.match(html, /Card Style Preview/);
  assert.match(html, /Flex Stats/);
  assert.doesNotMatch(html, /<h3 class="section-title">Progress<\/h3>/);
  assert.doesNotMatch(html, /Currency & Chests/);
  assert.match(html, /Overall Record/);
  assert.match(html, /Battle Stats/);
  assert.match(html, /Featured Rival/);
  assert.match(html, /Gauntlet/);
  assert.match(html, /Mode Stats/);
  assert.match(html, /Card Back/);
  assert.match(html, /Fire/);
  assert.match(html, /Earth/);
  assert.match(html, /Wind/);
  assert.match(html, /Water/);
  assert.match(html, /Best Gauntlet Streak[\s\S]*12/);
  assert.match(html, /Featured Rival Wins[\s\S]*7/);
  assert.equal((html.match(/data-profile-flex-variant="/g) ?? []).length, 4);
  assert.match(html, /data-profile-flex-cardback="true"[^>]*data-hover-preview="true"[^>]*data-preview-type="cardBack"/);
  assert.match(html, /data-profile-flex-variant="fire"[\s\S]*data-hover-preview="true"[\s\S]*data-preview-type="elementCardVariant"/);
  assert.match(html, /data-preview-name="Neon Arcana Fire"/);
  assert.match(html, /Search Player/);
  assert.match(html, /Achievements \(/);
});

test("ui: viewed profile modal renders read-only top Profile Overview panels", () => {
  const html = profileScreen.renderViewedProfileModalBody({
    username: "Enab",
    title: "Elementalist",
    playerLevel: 44,
    playerXP: 1337,
    tokens: 222,
    wins: 30,
    losses: 12,
    gamesPlayed: 42,
    bestWinStreak: 9,
    featuredRivalWins: 5,
    gauntletBestStreak: 8,
    gauntletRuns: 9,
    gauntletWins: 6,
    gauntletLosses: 3,
    gauntletRivalsDefeated: 14,
    warsEntered: 4,
    warsWon: 2,
    longestWar: 3,
    cardsCaptured: 55,
    modeStats: {
      pve: { wins: 10, losses: 2, gamesPlayed: 12, cardsCaptured: 24, warsEntered: 2, warsWon: 1, longestWar: 2 },
      local_pvp: { wins: 4, losses: 3, gamesPlayed: 7, cardsCaptured: 8, warsEntered: 1, warsWon: 1, longestWar: 1 },
      online_pvp: { wins: 16, losses: 7, gamesPlayed: 23, cardsCaptured: 23, warsEntered: 1, warsWon: 0, longestWar: 2 }
    },
    achievements: {},
    equippedCosmetics: {
      avatar: "avatar_neon_tide_entity",
      title: "title_spellwired",
      badge: "badge_arena_challenger",
      background: "default_background",
      cardBack: "cardback_neon_arcana",
      elementCardVariant: {
        fire: "fire_variant_neon_arcana",
        earth: "earth_variant_neon_arcana",
        wind: "wind_variant_neon_arcana",
        water: "water_variant_neon_arcana"
      }
    }
  });

  assert.match(html, /Read-only player profile/);
  assert.match(html, /data-profile-overview="true"/);
  assert.doesNotMatch(html, /data-profile-flex-panel="identity"/);
  assert.match(html, /data-profile-flex-panel="progress"/);
  assert.match(html, /Progress \/ Account/);
  assert.match(html, /data-profile-overview-level="true">[0-9]+</);
  assert.match(html, /data-profile-overview-xp-value="true">[0-9]+ \/ [0-9]+</);
  assert.match(html, /data-profile-overview-tokens="true">222</);
  assert.match(html, /data-profile-flex-panel="card-style"/);
  assert.match(html, /data-profile-flex-panel="stats"/);
  assert.equal((html.match(/data-profile-flex-variant="/g) ?? []).length, 4);
  assert.match(html, /data-profile-flex-cardback="true"[^>]*data-hover-preview="true"[^>]*data-preview-type="cardBack"/);
  assert.match(html, /data-profile-flex-variant="water"[\s\S]*data-hover-preview="true"[\s\S]*data-preview-type="elementCardVariant"/);
  assert.doesNotMatch(html, /data-equip-type=/);
  assert.doesNotMatch(html, /Equip<\/button>/);
  assert.doesNotMatch(html, /Account Snapshot/);
  assert.doesNotMatch(html, /data-profile-overview-chests="true"/);
  assert.match(html, /Overall Record/);
});

test("ui: viewed profile modal renders Longest Match details and hides missing lines cleanly", () => {
  const html = profileScreen.renderViewedProfileModalBody({
    username: "Enab",
    title: "Elementalist",
    playerLevel: 44,
    playerXP: 1337,
    tokens: 222,
    wins: 30,
    losses: 12,
    gamesPlayed: 42,
    bestWinStreak: 9,
    featuredRivalWins: 5,
    gauntletBestStreak: 8,
    gauntletRuns: 9,
    gauntletWins: 6,
    gauntletLosses: 3,
    gauntletRivalsDefeated: 14,
    warsEntered: 4,
    warsWon: 2,
    longestWar: 3,
    cardsCaptured: 55,
    modeStats: {
      pve: { wins: 10, losses: 2, gamesPlayed: 12, cardsCaptured: 24, warsEntered: 2, warsWon: 1, longestWar: 2 },
      local_pvp: { wins: 4, losses: 3, gamesPlayed: 7, cardsCaptured: 8, warsEntered: 1, warsWon: 1, longestWar: 1 },
      online_pvp: { wins: 16, losses: 7, gamesPlayed: 23, cardsCaptured: 23, warsEntered: 1, warsWon: 0, longestWar: 2 }
    },
    achievements: {},
    longestMatch: {
      rounds: 41,
      mode: "online_pvp",
      opponentId: null,
      opponentName: null,
      result: "win",
      capturedFor: null,
      capturedAgainst: null,
      achievedAt: "2026-06-01T12:34:56.000Z"
    },
    equippedCosmetics: {
      avatar: "avatar_neon_tide_entity",
      title: "title_spellwired",
      badge: "badge_arena_challenger",
      background: "default_background",
      cardBack: "cardback_neon_arcana",
      elementCardVariant: {
        fire: "fire_variant_neon_arcana",
        earth: "earth_variant_neon_arcana",
        wind: "wind_variant_neon_arcana",
        water: "water_variant_neon_arcana"
      }
    }
  });

  assert.match(html, /Longest Match/);
  assert.match(html, /41 Rounds/);
  assert.match(html, /Mode[\s\S]*Online/);
  assert.match(html, /Result[\s\S]*Win/);
  assert.doesNotMatch(html, /Opponent[\s\S]*null/);
  assert.doesNotMatch(html, /Captured[\s\S]*null/);
});

test("ui: Profile Overview falls back safely for missing cosmetics stats and progress values", () => {
  const html = profileScreen.render(
    createProfileScreenContext({
      profile: {
        ...createProfileScreenContext().profile,
        title: "",
        playerLevel: undefined,
        playerXP: undefined,
        tokens: undefined,
        supporterPass: undefined,
        gauntletBestStreak: undefined,
        gauntletRuns: undefined,
        gauntletWins: undefined,
        gauntletRivalsDefeated: undefined,
        featuredRivalWins: undefined,
        equippedCosmetics: {}
      }
    })
  );

  assert.doesNotMatch(html, /Equipped Identity/);
  assert.match(html, /data-profile-flex-panel="progress"/);
  assert.match(html, /data-profile-overview-level="true">1</);
  assert.match(html, /data-profile-overview-tokens="true">0</);
  assert.match(html, /data-profile-overview-xp-value="true">0 \/ 25</);
  assert.match(html, /data-profile-overview-next-reward="true">Lv 2 - \+50 Tokens</);
  assert.match(html, /data-profile-overview-supporter="true">Not Active</);
  assert.match(html, /Default Card Back/);
  assert.match(html, />Default Water<\/strong>/);
  assert.match(html, /Featured Rival Wins[\s\S]*>0</);
  assert.match(html, /Best Gauntlet Streak[\s\S]*>0</);
  assert.equal((html.match(/data-profile-flex-variant="/g) ?? []).length, 4);
});

test("ui: own profile renders Longest Match details when present", () => {
  const html = profileScreen.render(
    createProfileScreenContext({
      profile: {
        ...createProfileScreenContext().profile,
        longestMatch: {
          rounds: 97,
          mode: "gauntlet",
          opponentId: "vampire_rival",
          opponentName: "Countess Veyra",
          result: "timer_win",
          capturedFor: 43,
          capturedAgainst: 40,
          achievedAt: "2026-06-01T12:34:56.000Z"
        }
      }
    })
  );

  assert.match(html, /Longest Match/);
  assert.match(html, /97 Rounds/);
  assert.match(html, /Mode[\s\S]*Gauntlet/);
  assert.match(html, /Opponent[\s\S]*Countess Veyra/);
  assert.match(html, /Result[\s\S]*Timer Win/);
  assert.match(html, /Captured[\s\S]*43 - 40/);
  assert.match(html, /data-profile-longest-match="true"/);
});

test("ui: own profile renders Longest Match fallback when missing", () => {
  const html = profileScreen.render(createProfileScreenContext());

  assert.match(html, /Longest Match/);
  assert.match(html, /No record yet/);
  assert.match(html, /data-profile-longest-match-empty="true"/);
});

test("ui: Profile Overview shows a clean max-level capped state", () => {
  const html = profileScreen.render(
    createProfileScreenContext({
      profile: {
        ...createProfileScreenContext().profile,
        playerXP: 28824,
        playerLevel: 100,
        nextReward: null,
        chests: { basic: 1, milestone: 0, epic: 0, legendary: 0 }
      }
    })
  );

  assert.match(html, /data-profile-overview-xp-value="true">Level cap reached</);
  assert.match(html, /data-profile-overview-next-reward="true">Level cap reached</);
  assert.match(html, /aria-valuenow="100"/);
});

test("ui: Trophy Shelf auto-selects up to 3 rarest owned cosmetics with the expected tie-breakers", () => {
  const items = selectTrophyShelfItems(
    {
      username: "ShelfUser",
      ownedCosmetics: {
        avatar: ["default_avatar", "avatar_neon_pyre_entity", "avatar_neon_tide_entity"],
        cardBack: ["default_card_back", "cardback_neon_arcana", "supporter_card_back"],
        background: ["default_background"],
        elementCardVariant: ["default_fire_card", "fire_variant_crownfire", "fire_variant_neon_arcana", "fire_variant_crownfire"],
        badge: ["none", "war_machine_badge"],
        title: ["Initiate", "title_spellwired"]
      },
      equippedCosmetics: {
        avatar: "avatar_neon_pyre_entity",
        cardBack: "cardback_neon_arcana",
        background: "default_background",
        badge: "none",
        title: "Initiate",
        elementCardVariant: {
          fire: "fire_variant_crownfire",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        }
      }
    },
    { limit: 3 }
  );

  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((item) => item.id),
    ["fire_variant_crownfire", "cardback_neon_arcana", "title_spellwired"]
  );
  assert.ok(items.every((item) => item.id !== "default_avatar"));
  assert.ok(items.every((item) => item.id !== "supporter_card_back"));
  assert.equal(items.filter((item) => item.id === "fire_variant_crownfire").length, 1);
});

test("ui: Trophy Shelf can include owned rotationOnly and storeHidden cosmetics when they rank into the results", () => {
  const items = selectTrophyShelfItems(
    {
      username: "ShelfVisibilityUser",
      ownedCosmetics: {
        avatar: ["default_avatar"],
        cardBack: ["default_card_back", "supporter_card_back"],
        background: ["default_background"],
        elementCardVariant: ["default_fire_card", "fire_variant_crownfire"],
        badge: ["none", "war_machine_badge"],
        title: ["Initiate"]
      },
      equippedCosmetics: {
        avatar: "default_avatar",
        cardBack: "default_card_back",
        background: "default_background",
        badge: "none",
        title: "Initiate",
        elementCardVariant: {
          fire: "fire_variant_crownfire",
          water: "default_water_card",
          earth: "default_earth_card",
          wind: "default_wind_card"
        }
      }
    },
    { limit: 3 }
  );

  assert.ok(items.some((item) => item.id === "fire_variant_crownfire"));
  assert.ok(items.some((item) => item.id === "war_machine_badge"));
});

test("ui: Trophy Shelf falls back safely when qualifying cosmetics or definitions are missing", () => {
  const items = selectTrophyShelfItems({
    username: "EmptyShelfUser",
    ownedCosmetics: {
      avatar: ["default_avatar", "avatar_missing_debug"],
      cardBack: ["default_card_back"],
      background: ["default_background"],
      elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
      badge: ["none"],
      title: ["Initiate"]
    },
    equippedCosmetics: {
      avatar: "default_avatar",
      cardBack: "default_card_back",
      background: "default_background",
      badge: "none",
      title: "Initiate",
      elementCardVariant: {
        fire: "default_fire_card",
        water: "default_water_card",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    }
  });

  assert.deepEqual(items, []);
});

test("ui: own profile renders Trophy Shelf below Profile Overview and keeps Reward Chests", () => {
  const profile = {
    ...createProfileScreenContext().profile,
    tokens: 345,
    supporterPass: true,
    chests: { basic: 2, milestone: 1, epic: 3, legendary: 4 },
    featuredRivalWins: 7,
    gauntletBestStreak: 12,
    gauntletRuns: 9,
    gauntletWins: 6,
    gauntletRivalsDefeated: 21,
    ownedCosmetics: {
      avatar: ["default_avatar", "avatar_neon_pyre_entity"],
      cardBack: ["default_card_back", "cardback_neon_arcana"],
      background: ["default_background"],
      elementCardVariant: [
        "default_fire_card",
        "default_water_card",
        "default_earth_card",
        "default_wind_card",
        "fire_variant_neon_arcana",
        "water_variant_neon_arcana"
      ],
      badge: ["none", "war_machine_badge"],
      title: ["Initiate", "title_spellwired"]
    },
    equippedCosmetics: {
      avatar: "avatar_neon_pyre_entity",
      cardBack: "cardback_neon_arcana",
      background: "default_background",
      badge: "war_machine_badge",
      title: "title_spellwired",
      elementCardVariant: {
        fire: "fire_variant_neon_arcana",
        water: "water_variant_neon_arcana",
        earth: "default_earth_card",
        wind: "default_wind_card"
      }
    }
  };
  const cosmetics = {
    ...createProfileScreenContext().cosmetics,
    catalog: getCosmeticCatalogForProfile(profile)
  };

  const html = profileScreen.render(
    createProfileScreenContext({
      profile,
      cosmetics
    })
  );

  assert.match(html, /data-profile-overview="true"/);
  assert.match(html, /data-profile-trophy-shelf="true"/);
  assert.match(html, /Trophy Shelf/);
  assert.match(html, /Spellwired/);
  assert.match(html, /Legendary/);
  assert.match(html, /Title/);
  assert.match(html, /Neon Arcana/);
  assert.match(html, /data-hover-preview="true"[\s\S]*data-profile-trophy-item="0"|data-profile-trophy-item="0"[\s\S]*data-hover-preview="true"/);
  assert.match(html, /Reward Chests/);
  assert.ok(html.indexOf('data-profile-overview="true"') < html.indexOf('data-profile-trophy-shelf="true"'));
  assert.ok(html.indexOf('data-profile-trophy-shelf="true"') < html.indexOf("Reward Chests"));
});

test("ui: viewed profile modal renders Trophy Shelf below Profile Overview and keeps the profile read-only", () => {
  const html = profileScreen.renderViewedProfileModalBody({
    username: "Enab",
    title: "Elementalist",
    playerLevel: 44,
    playerXP: 1337,
    tokens: 222,
    wins: 30,
    losses: 12,
    gamesPlayed: 42,
    bestWinStreak: 9,
    featuredRivalWins: 5,
    gauntletBestStreak: 8,
    gauntletRuns: 9,
    gauntletWins: 6,
    gauntletLosses: 3,
    gauntletRivalsDefeated: 14,
    warsEntered: 4,
    warsWon: 2,
    longestWar: 3,
    cardsCaptured: 55,
    modeStats: {
      pve: { wins: 10, losses: 2, gamesPlayed: 12, cardsCaptured: 24, warsEntered: 2, warsWon: 1, longestWar: 2 },
      local_pvp: { wins: 4, losses: 3, gamesPlayed: 7, cardsCaptured: 8, warsEntered: 1, warsWon: 1, longestWar: 1 },
      online_pvp: { wins: 16, losses: 7, gamesPlayed: 23, cardsCaptured: 23, warsEntered: 1, warsWon: 0, longestWar: 2 }
    },
    achievements: {},
    ownedCosmetics: {
      avatar: ["default_avatar", "avatar_neon_tide_entity"],
      cardBack: ["default_card_back", "cardback_neon_arcana"],
      background: ["default_background"],
      elementCardVariant: [
        "default_fire_card",
        "default_water_card",
        "default_earth_card",
        "default_wind_card",
        "fire_variant_neon_arcana",
        "earth_variant_neon_arcana",
        "wind_variant_neon_arcana",
        "water_variant_neon_arcana"
      ],
      badge: ["none", "war_machine_badge"],
      title: ["Initiate", "title_spellwired"]
    },
    equippedCosmetics: {
      avatar: "avatar_neon_tide_entity",
      title: "title_spellwired",
      badge: "war_machine_badge",
      background: "default_background",
      cardBack: "cardback_neon_arcana",
      elementCardVariant: {
        fire: "fire_variant_neon_arcana",
        earth: "earth_variant_neon_arcana",
        wind: "wind_variant_neon_arcana",
        water: "water_variant_neon_arcana"
      }
    }
  });

  assert.match(html, /data-profile-overview="true"/);
  assert.match(html, /data-profile-trophy-shelf="true"/);
  assert.match(html, /Trophy Shelf/);
  assert.match(html, /Spellwired/);
  assert.match(html, /Legendary/);
  assert.match(html, /Title/);
  assert.match(html, /Neon Arcana/);
  assert.doesNotMatch(html, /data-profile-overview-chests="true"/);
  assert.doesNotMatch(html, /data-equip-type=/);
  assert.doesNotMatch(html, /Equip<\/button>/);
  assert.ok(html.indexOf('data-profile-overview="true"') < html.indexOf('data-profile-trophy-shelf="true"'));
  assert.ok(html.indexOf('data-profile-trophy-shelf="true"') < html.indexOf("Overall Record"));
});

test("ui: viewed profile modal can render Trophy Shelf from a sanitized public trophyShelf list", () => {
  const html = profileScreen.renderViewedProfileModalBody({
    username: "SanitizedRival",
    title: "Spellwired",
    playerLevel: 22,
    playerXP: 640,
    wins: 12,
    losses: 5,
    gamesPlayed: 17,
    warsEntered: 4,
    warsWon: 2,
    longestWar: 3,
    cardsCaptured: 31,
    featuredRivalWins: 2,
    gauntletBestStreak: 4,
    gauntletRuns: 3,
    gauntletWins: 5,
    gauntletLosses: 1,
    gauntletRivalsDefeated: 7,
    achievements: {},
    modeStats: {
      pve: { wins: 6, losses: 2, gamesPlayed: 8, cardsCaptured: 14, warsEntered: 2, warsWon: 1, longestWar: 2 }
    },
    equippedCosmetics: {
      avatar: "avatar_neon_tide_entity",
      title: "title_spellwired",
      badge: "war_machine_badge",
      background: "default_background",
      cardBack: "cardback_neon_arcana",
      elementCardVariant: {
        fire: "fire_variant_neon_arcana",
        earth: "earth_variant_neon_arcana",
        wind: "wind_variant_neon_arcana",
        water: "water_variant_neon_arcana"
      }
    },
    trophyShelf: [
      {
        id: "title_spellwired",
        type: "title",
        name: "Spellwired",
        rarity: "Legendary",
        typeLabel: "Title",
        image: "assets/titles/title_spellwired.png",
        collection: "Neon Arcana",
        equipped: true
      }
    ]
  });

  assert.match(html, /data-profile-trophy-shelf="true"/);
  assert.match(html, /Trophy Shelf/);
  assert.match(html, /Spellwired/);
  assert.match(html, /Legendary/);
  assert.match(html, /Title/);
  assert.match(html, /Neon Arcana/);
  assert.doesNotMatch(html, /data-profile-overview-chests="true"/);
});

test("ui: Trophy Shelf shows an empty state when no qualifying rare cosmetics exist", () => {
  const html = profileScreen.render(
    createProfileScreenContext({
      profile: {
        ...createProfileScreenContext().profile,
        ownedCosmetics: {
          avatar: ["default_avatar"],
          cardBack: ["default_card_back"],
          background: ["default_background"],
          elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
          badge: ["none"],
          title: ["Initiate"]
        }
      },
      cosmetics: {
        ...createProfileScreenContext().cosmetics,
        catalog: getCosmeticCatalogForProfile({
          ...createProfileScreenContext().profile,
          ownedCosmetics: {
            avatar: ["default_avatar"],
            cardBack: ["default_card_back"],
            background: ["default_background"],
            elementCardVariant: ["default_fire_card", "default_water_card", "default_earth_card", "default_wind_card"],
            badge: ["none"],
            title: ["Initiate"]
          }
        })
      }
    })
  );

  assert.match(html, /data-profile-trophy-shelf="true"/);
  assert.match(html, /No rare cosmetics yet\./);
});
