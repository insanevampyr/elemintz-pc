import test from "node:test";
import assert from "node:assert/strict";

import { achievementsScreen } from "../../src/renderer/ui/screens/achievementsScreen.js";
import { cosmeticsScreen } from "../../src/renderer/ui/screens/cosmeticsScreen.js";
import { dailyChallengesScreen } from "../../src/renderer/ui/screens/dailyChallengesScreen.js";
import { gameScreen } from "../../src/renderer/ui/screens/gameScreen.js";
import { localSetupScreen } from "../../src/renderer/ui/screens/localSetupScreen.js";
import { menuScreen } from "../../src/renderer/ui/screens/menuScreen.js";
import { onlinePlayScreen } from "../../src/renderer/ui/screens/onlinePlayScreen.js";
import { profileScreen } from "../../src/renderer/ui/screens/profileScreen.js";
import { settingsScreen } from "../../src/renderer/ui/screens/settingsScreen.js";
import { storeScreen } from "../../src/renderer/ui/screens/storeScreen.js";
import { bindCosmeticHoverPreview } from "../../src/renderer/ui/shared/cosmeticHoverPreview.js";
import { AppController } from "../../src/renderer/systems/appController.js";
import { getArenaBackground, getAvatarImage, getBadgeImage, getCardBackImage, getVariantCardImages } from "../../src/renderer/utils/assets.js";
import { ACHIEVEMENT_DEFINITIONS } from "../../src/state/achievementSystem.js";
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

test("ui: settings screen renders PvE AI difficulty and style options with easy warning", () => {
  const html = settingsScreen.render({
    settings: {
      gameplay: { timerSeconds: 30 },
      aiDifficulty: "normal",
      aiOpponentStyle: "default",
      ui: { reducedMotion: false },
      audio: { enabled: true }
    }
  });

  assert.match(html, /AI Difficulty/);
  assert.match(html, /Random AI card selection/);
  assert.match(html, /Achievements disabled on Easy difficulty/);
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
  assert.match(html, /assets\/badges\/firstFlame\.png/);
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
  assert.match(html, /Voidbound Entity/);
  assert.match(html, /Arcane Gambler/);
  assert.match(html, /Fairy Prince/);
  assert.match(html, /Fairy Princess/);
  assert.match(html, /Infernal Rift/);
  assert.match(html, /Celestial Observatory/);
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
    assert.match(html, /class="screen-topbar"/);
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

test("ui: store screen renders token count and buy/equip actions", () => {
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

  assert.match(html, /Tokens: <strong>120<\/strong>/);
  assert.match(html, /data-buy-type="avatar"/);
  assert.match(html, /cosmetic-rarity-label[^>]*>Common<\/span>/);
  assert.match(html, /Activate Founder Pass/);
});

test("ui: shop and cosmetics render hover preview hooks only for supported cosmetic art", () => {
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
            owned: true,
            equipped: true,
            purchasable: false,
            price: 0,
            rarity: "Epic",
            unlockSource: { type: "default" }
          }
        ],
        background: [
          {
            id: "default_background",
            name: "EleMintz Table",
            image: "backgrounds/default_bg.jpg",
            owned: true,
            equipped: true,
            purchasable: false,
            price: 0,
            rarity: "Legendary",
            unlockSource: { type: "default" }
          }
        ],
        elementCardVariant: [
          {
            id: "default_fire_card",
            name: "Core Fire",
            image: "cards/fireCard.jpg",
            owned: true,
            equipped: true,
            purchasable: false,
            price: 0,
            rarity: "Common",
            element: "fire",
            unlockSource: { type: "default" }
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
  assert.match(storeHtml, /data-hover-preview="true" data-preview-type="elementCardVariant"/);
  assert.doesNotMatch(storeHtml, /data-preview-type="background"/);
  assert.match(cosmeticsHtml, /data-hover-preview="true" data-preview-type="avatar"/);
  assert.match(cosmeticsHtml, /data-hover-preview="true" data-preview-type="cardBack"/);
  assert.match(cosmeticsHtml, /data-hover-preview="true" data-preview-type="elementCardVariant"/);
  assert.doesNotMatch(cosmeticsHtml, /data-preview-type="badge"/);
  assert.doesNotMatch(cosmeticsHtml, /data-preview-type="title"/);
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
    return {
      hidden: false,
      style: {},
      classList: createClassList(),
      querySelectorAll: (selector) => (selector === "[data-store-item]" ? items : [])
    };
  }

  const backButton = createControl();
  const supporterButton = createControl();
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
        "activate-supporter-btn": supporterButton,
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
        activateSupporter: () => {},
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

test("ui: appController preserves store search and filter state through buy and equip rerenders", async () => {
  const previousWindow = global.window;
  const shown = [];
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
  const store = {
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
  };

  global.window = {
    elemintz: {
      state: {
        getStore: async () => store,
        buyStoreItem: async () => ({ profile, store }),
        equipCosmetic: async () => ({ profile })
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
    app.username = "StoreKeeper";
    app.storeViewState.searchText = "fire";
    app.storeViewState.categories = new Set(["avatar", "background"]);
    app.storeViewState.rarities = new Set(["Common", "Rare"]);

    await app.showStore();
    await shown.at(-1).actions.buy("avatar", "fire_avatar_f");
    const afterBuy = shown.at(-1).viewState;

    assert.equal(afterBuy.searchText, "fire");
    assert.deepEqual([...afterBuy.categories], ["avatar", "background"]);
    assert.deepEqual([...afterBuy.rarities], ["Common", "Rare"]);

    await shown.at(-1).actions.equip("background", "default_background");
    const afterEquip = shown.at(-1).viewState;

    assert.equal(afterEquip.searchText, "fire");
    assert.deepEqual([...afterEquip.categories], ["avatar", "background"]);
    assert.deepEqual([...afterEquip.rarities], ["Common", "Rare"]);
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
    app.showMenu({ autoClaimDailyLogin: false, showDailyLoginToasts: false });
    await Promise.resolve();
    await Promise.resolve();
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

test("ui: appController cosmetics actions route loadout save apply and rename through state", async () => {
  const previousWindow = global.window;
  const shown = [];
  const calls = {
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
        updateCosmeticPreferences: async () => ({ profile: baseProfile }),
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
    await shown.at(-1).actions.saveLoadout(0);
    await shown.at(-1).actions.applyLoadout(0);
    await shown.at(-1).actions.renameLoadout(0, "Storm Fit");

    assert.deepEqual(calls.save, [{ username: "CosmeticCaptain", slotIndex: 0 }]);
    assert.deepEqual(calls.apply, [{ username: "CosmeticCaptain", slotIndex: 0 }]);
    assert.deepEqual(calls.rename, [{ username: "CosmeticCaptain", slotIndex: 0, name: "Storm Fit" }]);
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
        randomizeBackgroundEachMatch: true
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
  assert.match(html, /Randomize Background Each Match/);
  assert.match(html, /Owned backgrounds only/);
  assert.match(html, /background-randomize-toggle/);
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
  assert.doesNotMatch(html, /Fire Avatar/);
  assert.doesNotMatch(html, /data-buy-type=/);
});

test("ui: cosmetics screen background randomize toggle and loadout controls bind through actions", async () => {
  const previousDocument = global.document;
  const toggles = [];
  const saveCalls = [];
  const applyCalls = [];
  const renameCalls = [];
  const backButton = { addEventListener: () => {} };
  const toggle = {
    checked: true,
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
        "background-randomize-toggle": toggle
      })[id] ?? null,
    querySelector: (selector) => (selector === '[data-loadout-name-input="0"]' ? renameInput : null),
    querySelectorAll: (selector) => {
      switch (selector) {
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
        toggleBackgroundRandomization: async (enabled) => toggles.push(enabled),
        saveLoadout: async (slotIndex) => saveCalls.push(slotIndex),
        applyLoadout: async (slotIndex) => applyCalls.push(slotIndex),
        renameLoadout: async (slotIndex, name) => renameCalls.push({ slotIndex, name })
      }
    });

    await toggle.listeners.get("change")({ currentTarget: toggle });
    await saveButton.listeners.get("click")();
    await applyButton.listeners.get("click")();
    await renameButton.listeners.get("click")();
    assert.deepEqual(toggles, [true]);
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
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 2, losses: 1 }, local_pvp: { wins: 0, losses: 0 } },
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
  assert.match(html, /Profile Search/);
  assert.match(html, /View Rival/);
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
    viewedProfile: {
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
    },
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(html, /data-preview-type="badge"/);
  assert.match(html, /data-preview-name="Element Initiate"/);
  assert.match(html, /data-preview-description="Level Reward: Reach Level 10\."/);
  assert.match(html, /data-preview-name="Apprentice"/);
  assert.match(html, /data-preview-description="Level Reward: Reach Level 3\."/);
  assert.match(html, /data-preview-src="[^"]*title_apprentice\.png"/);
  assert.match(html, /data-preview-name="Arena Challenger"/);
  assert.match(html, /data-preview-description="Level Reward: Reach Level 30\."/);
  assert.match(html, /data-preview-name="Elementalist"/);
  assert.match(html, /data-preview-description="Level Reward: Reach Level 20\."/);
  assert.match(html, /data-preview-src="[^"]*title_elementalist\.png"/);
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
  assert.match(html, /Result: No effect\./);
  assert.match(html, /WAR Pile: 0 \| Clashes: 0/);
  assert.match(html, /Captured: Hero • 0 \| Elemental AI • 0/);
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

test("ui: cosmetic hover preview follows cursor, clamps to viewport, and hides cleanly", () => {
  function createPreviewNode(tagName) {
    const children = [];
    const classes = new Set();
    return {
      tagName,
      id: "",
      hidden: false,
      className: "",
      style: {},
      children,
      appendChild(child) {
        children.push(child);
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
  assert.equal(previewFrame.style.height, "294px");
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

test("ui: cosmetic hover preview renders title and badge metadata while keeping avatar image-only", () => {
  function createPreviewNode(tagName) {
    const children = [];
    const classes = new Set();
    return {
      tagName,
      id: "",
      hidden: false,
      className: "",
      style: {},
      textContent: "",
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
    documentElement: { clientWidth: 800, clientHeight: 600 },
    body: {
      appendChild(node) {
        appended.push(node);
      }
    },
    createElement: (tagName) => createPreviewNode(tagName),
    defaultView: { innerWidth: 800, innerHeight: 600, addEventListener() {} }
  };

  bindCosmeticHoverPreview({ root, documentRef });

  const previewLayer = appended[0];
  const previewFrame = previewLayer.children[0];
  const previewImage = previewFrame.children[0];
  const previewTextVisual = previewFrame.children[1];
  const previewMeta = appended[0].children.find((child) => child.className === "cosmetic-hover-preview-meta");
  const previewName = previewMeta.children[0];
  const previewDescription = previewMeta.children[1];
  const titleTarget = {
    getAttribute(name) {
      return {
        "data-preview-type": "title",
        "data-preview-rarity": "Rare",
        "data-preview-src": "",
        "data-preview-name": "Apprentice",
        "data-preview-description": "Level Reward: Reach Level 3.",
        "data-preview-visual-text": "Apprentice"
      }[name] ?? null;
    },
    closest: () => titleTarget
  };
  const badgeTarget = {
    getAttribute(name) {
      return {
        "data-preview-type": "badge",
        "data-preview-rarity": "Epic",
        "data-preview-src": "file:///badge.png",
        "data-preview-name": "Arena Challenger",
        "data-preview-description": "Level Reward: Reach Level 30."
      }[name] ?? null;
    },
    closest: () => badgeTarget
  };

  listeners.get("mouseover")({ target: titleTarget, clientX: 40, clientY: 40 });
  assert.equal(previewLayer.hidden, false);
  assert.equal(previewFrame.hidden, true);
  assert.equal(previewTextVisual.hidden, true);
  assert.equal(previewImage.hidden, true);
  assert.equal(previewMeta.hidden, false);
  assert.equal(previewName.textContent, "Apprentice");
  assert.equal(previewDescription.textContent, "Level Reward: Reach Level 3.");
  assert.match(previewFrame.className, /is-title/);

  listeners.get("mousemove")({ target: badgeTarget, clientX: 60, clientY: 60 });
  assert.equal(previewFrame.hidden, false);
  assert.equal(previewTextVisual.hidden, true);
  assert.equal(previewImage.hidden, false);
  assert.equal(previewImage.src, "file:///badge.png");
  assert.equal(previewLayer.children.includes(previewMeta), true);
  assert.equal(previewName.textContent, "Arena Challenger");
  assert.equal(previewDescription.textContent, "Level Reward: Reach Level 30.");
  assert.match(previewFrame.className, /is-badge/);
  assert.match(previewFrame.className, /rarity-epic/);
});

test("ui: title and badge hover previews fall back to text-only meta when image src is unusable", () => {
  function createPreviewNode(tagName) {
    const children = [];
    const classes = new Set();
    return {
      tagName,
      id: "",
      hidden: false,
      className: "",
      style: {},
      textContent: "",
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
    documentElement: { clientWidth: 800, clientHeight: 600 },
    body: {
      appendChild(node) {
        appended.push(node);
      }
    },
    createElement: (tagName) => createPreviewNode(tagName),
    defaultView: { innerWidth: 800, innerHeight: 600, addEventListener() {} }
  };

  bindCosmeticHoverPreview({ root, documentRef });

  const previewLayer = appended[0];
  const previewFrame = previewLayer.children[0];
  const previewImage = previewFrame.children[0];
  const previewMeta = appended[0].children.find((child) => child.className === "cosmetic-hover-preview-meta");
  const previewName = previewMeta.children[0];
  const previewDescription = previewMeta.children[1];
  const titleTarget = {
    getAttribute(name) {
      return {
        "data-preview-type": "title",
        "data-preview-rarity": "Common",
        "data-preview-src": "Initiate",
        "data-preview-name": "Initiate",
        "data-preview-description": "Default cosmetic.",
        "data-preview-visual-text": "Initiate"
      }[name] ?? null;
    },
    closest: () => titleTarget
  };
  const badgeTarget = {
    getAttribute(name) {
      return {
        "data-preview-type": "badge",
        "data-preview-rarity": "Rare",
        "data-preview-src": "Element Initiate",
        "data-preview-name": "Element Initiate",
        "data-preview-description": "Level Reward: Reach Level 10."
      }[name] ?? null;
    },
    closest: () => badgeTarget
  };

  listeners.get("mouseover")({ target: titleTarget, clientX: 40, clientY: 40 });
  assert.equal(previewLayer.hidden, false);
  assert.equal(previewFrame.hidden, true);
  assert.equal(previewImage.hidden, true);
  assert.equal(previewName.textContent, "Initiate");
  assert.equal(previewDescription.textContent, "Default cosmetic.");

  listeners.get("mousemove")({ target: badgeTarget, clientX: 70, clientY: 70 });
  assert.equal(previewFrame.hidden, true);
  assert.equal(previewImage.hidden, true);
  assert.equal(previewName.textContent, "Element Initiate");
  assert.equal(previewDescription.textContent, "Level Reward: Reach Level 10.");
});

test("ui: title and badge hover previews reject truthy label-like src values instead of rendering broken images", () => {
  function createPreviewNode(tagName) {
    const children = [];
    const classes = new Set();
    return {
      tagName,
      id: "",
      hidden: false,
      className: "",
      style: {},
      textContent: "",
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
    documentElement: { clientWidth: 800, clientHeight: 600 },
    body: {
      appendChild(node) {
        appended.push(node);
      }
    },
    createElement: (tagName) => createPreviewNode(tagName),
    defaultView: { innerWidth: 800, innerHeight: 600, addEventListener() {} }
  };

  bindCosmeticHoverPreview({ root, documentRef });

  const previewLayer = appended[0];
  const previewFrame = previewLayer.children[0];
  const previewImage = previewFrame.children[0];
  const previewMeta = appended[0].children.find((child) => child.className === "cosmetic-hover-preview-meta");
  const previewName = previewMeta.children[0];
  const previewDescription = previewMeta.children[1];
  const apprenticeTarget = {
    getAttribute(name) {
      return {
        "data-preview-type": "title",
        "data-preview-rarity": "Rare",
        "data-preview-src": "Apprentice",
        "data-preview-name": "Apprentice",
        "data-preview-description": "Level Reward: Reach Level 3.",
        "data-preview-visual-text": "Apprentice"
      }[name] ?? null;
    },
    closest: () => apprenticeTarget
  };
  const initiateBadgeTarget = {
    getAttribute(name) {
      return {
        "data-preview-type": "badge",
        "data-preview-rarity": "Common",
        "data-preview-src": "Element Initiate",
        "data-preview-name": "Element Initiate",
        "data-preview-description": "Level Reward: Reach Level 10."
      }[name] ?? null;
    },
    closest: () => initiateBadgeTarget
  };

  listeners.get("mouseover")({ target: apprenticeTarget, clientX: 48, clientY: 48 });
  assert.equal(previewLayer.hidden, false);
  assert.equal(previewFrame.hidden, true);
  assert.equal(previewImage.hidden, true);
  assert.equal(previewImage.src, "");
  assert.equal(previewName.textContent, "Apprentice");
  assert.equal(previewDescription.textContent, "Level Reward: Reach Level 3.");

  listeners.get("mousemove")({ target: initiateBadgeTarget, clientX: 72, clientY: 72 });
  assert.equal(previewFrame.hidden, true);
  assert.equal(previewImage.hidden, true);
  assert.equal(previewImage.src, "");
  assert.equal(previewName.textContent, "Element Initiate");
  assert.equal(previewDescription.textContent, "Level Reward: Reach Level 10.");
});

test("ui: identity hover preview keeps avatars image-only and text-only titles compact", () => {
  function createPreviewNode(tagName) {
    const children = [];
    const classes = new Set();
    return {
      tagName,
      id: "",
      hidden: false,
      className: "",
      style: {},
      textContent: "",
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
    documentElement: { clientWidth: 800, clientHeight: 600 },
    body: {
      appendChild(node) {
        appended.push(node);
      }
    },
    createElement: (tagName) => createPreviewNode(tagName),
    defaultView: { innerWidth: 800, innerHeight: 600, addEventListener() {} }
  };

  bindCosmeticHoverPreview({ root, documentRef });

  const previewLayer = appended[0];
  const previewFrame = previewLayer.children[0];
  const previewMeta = appended[0].children.find((child) => child.className === "cosmetic-hover-preview-meta");
  const avatarTarget = {
    getAttribute(name) {
      return {
        "data-preview-type": "avatar",
        "data-preview-rarity": "Epic",
        "data-preview-src": "assets/avatars/avatar_arcane_gambler.png",
        "data-preview-name": "Arcane Gambler",
        "data-preview-description": ""
      }[name] ?? null;
    },
    closest: () => avatarTarget
  };
  const titleTarget = {
    getAttribute(name) {
      return {
        "data-preview-type": "title",
        "data-preview-rarity": "Common",
        "data-preview-src": "",
        "data-preview-name": "Initiate",
        "data-preview-description": "Default cosmetic.",
        "data-preview-visual-text": "Initiate"
      }[name] ?? null;
    },
    closest: () => titleTarget
  };

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
  function createPreviewNode(tagName) {
    const children = [];
    const classes = new Set();
    return {
      tagName,
      id: "",
      hidden: false,
      className: "",
      style: {},
      textContent: "",
      children,
      appendChild(child) {
        children.push(child);
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
    documentElement: { clientWidth: 900, clientHeight: 700 },
    body: {
      appendChild(node) {
        appended.push(node);
      }
    },
    createElement: (tagName) => createPreviewNode(tagName),
    defaultView: { innerWidth: 900, innerHeight: 700, addEventListener() {} }
  };

  bindCosmeticHoverPreview({ root, documentRef });

  const previewLayer = appended[0];
  const previewFrame = previewLayer.children[0];
  const previewImage = previewFrame.children[0];
  const titleTarget = {
    getAttribute(name) {
      return {
        "data-preview-type": "title",
        "data-preview-rarity": "Epic",
        "data-preview-src": "file:///title.png",
        "data-preview-name": "War Master",
        "data-preview-description": "Level Reward: Reach Level 50.",
        "data-preview-visual-text": "War Master"
      }[name] ?? null;
    },
    closest: () => titleTarget
  };

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

test("ui: cosmetics screen category filters hide unselected owned sections", () => {
  const previousDocument = global.document;

  const avatarItems = [
    { hidden: false, style: {}, classList: { toggle() {} }, getAttribute: (name) => (name === "data-cosmetic-rarity" ? "Epic" : null) }
  ];
  const titleItems = [
    { hidden: false, style: {}, classList: { toggle() {} }, getAttribute: (name) => (name === "data-cosmetic-rarity" ? "Common" : null) }
  ];
  const avatarSection = {
    hidden: false,
    style: {},
    classList: { toggle() {} },
    getAttribute: () => "avatar",
    querySelectorAll: (selector) => (selector === ".cosmetic-item" ? avatarItems : [])
  };
  const titleSection = {
    hidden: false,
    style: {},
    classList: { toggle() {} },
    getAttribute: () => "title",
    querySelectorAll: (selector) => (selector === ".cosmetic-item" ? titleItems : [])
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

  global.document = {
    querySelector: (selector) => (selector === ".screen-cosmetics" ? {} : null),
    getElementById: (id) =>
      ({
        "cosmetics-back-btn": backButton,
        "cosmetics-empty-state": emptyState
      })[id] ?? null,
    querySelectorAll: (selector) => {
      switch (selector) {
        case "[data-cosmetic-section]":
          return [avatarSection, titleSection];
        case "[data-cosmetic-category-filter]":
          return [avatarFilter, titleFilter];
        case "[data-cosmetic-rarity-filter]":
          return [commonRarityFilter, epicRarityFilter];
        default:
          return [];
      }
    }
  };

  try {
    cosmeticsScreen.bind({
      viewState: { categories: new Set(["avatar", "title"]), rarities: new Set(["Common", "Epic"]) },
      actions: {
        back: async () => {},
        equip: async () => {},
        toggleBackgroundRandomization: async () => {},
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

test("ui: viewed profile shows only unlocked achievements with badge images", () => {
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
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(html, /Viewed Profile/);
  assert.match(html, /Level: 4/);
  assert.match(html, /Total XP: 83/);
  assert.match(html, /Tokens: 245/);
  assert.match(html, /Games Played: 7/);
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

test("ui: profile achievement progress heading ignores duplicate counts and shows zero state", () => {
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
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(
    zeroHtml,
    new RegExp(`Achievements \\(0\\/${ACHIEVEMENT_DEFINITIONS.length}\\)`)
  );
  assert.match(zeroHtml, /No achievements unlocked yet\./);
});

test("ui: viewed profile renders derived level correctly on first render", () => {
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
    viewedProfile: {
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
    },
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(html, /Level: 4/);
  assert.match(html, /Total XP: 112/);
});

test("ui: viewed profile mode hides cosmetic selectors and applies viewed background on panel", () => {
  const html = profileScreen.render({
    profile: {
      username: "Viewer",
      title: "Initiate",
      wins: 1,
      losses: 1,
      warsEntered: 0,
      warsWon: 0,
      longestWar: 0,
      cardsCaptured: 2,
      gamesPlayed: 2,
      bestWinStreak: 1,
      tokens: 50,
      supporterPass: false,
      achievements: {},
      modeStats: { pve: { wins: 1, losses: 1 }, local_pvp: { wins: 0, losses: 0 } },
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
    viewedProfile: {
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
    },
    backgroundImage: "assets/EleMintzIcon.png"
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
    viewedProfile: {
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
    },
    backgroundImage: "assets/backgrounds/lava_throne_background.png"
  });

  assert.match(html, /background-image: url\('assets\/backgrounds\/lava_throne_background\.png'\)/);
  assert.match(html, /viewed-profile-panel/);
  assert.match(html, /background-image: url\('(?:file:.*\/)?assets\/EleMintzIcon\.png'\)/);
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
    },
    backgroundImage: "assets/EleMintzIcon.png"
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
    "start-pve-btn",
    "start-local-btn",
    "online-play-btn",
    "profile-btn",
    "cosmetics-btn",
    "store-btn",
    "achievements-btn",
    "settings-btn",
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
  assert.match(html, /id="settings-btn"[\s\S]*menu_tiles\/tile_settings\.png/);
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

test("ui: menu challenge preview prioritizes unfinished entries before completed ones", () => {
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
  assert.match(html, /<strong>WAR triggered<\/strong>/);
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

test("ui: appController randomizes equipped background after a completed match using owned backgrounds only", async () => {
  const previousWindow = global.window;
  const originalRandom = Math.random;
  const equipCalls = [];
  const app = createRendererController();
  const profile = {
    username: "Hero",
    randomizeBackgroundEachMatch: true,
    equippedCosmetics: {
      background: "fire_background"
    },
    ownedCosmetics: {
      background: ["default_background", "fire_background", "water_background"]
    }
  };

  global.window = {
    elemintz: {
      state: {
        equipCosmetic: async (payload) => {
          equipCalls.push(payload);
          return {
            profile: {
              ...profile,
              equippedCosmetics: {
                ...profile.equippedCosmetics,
                background: payload.cosmeticId
              }
            }
          };
        }
      }
    }
  };

  Math.random = () => 0;

  try {
    const updated = await app.maybeRandomizeBackgroundAfterMatchFor("Hero", profile);

    assert.equal(equipCalls.length, 1);
    assert.equal(equipCalls[0].type, "background");
    assert.notEqual(equipCalls[0].cosmeticId, "fire_background");
    assert.ok(profile.ownedCosmetics.background.includes(equipCalls[0].cosmeticId));
    assert.equal(updated.equippedCosmetics.background, equipCalls[0].cosmeticId);
  } finally {
    global.window = previousWindow;
    Math.random = originalRandom;
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
  assert.match(html, /Captured: P1 • 0 \| P2 • 0/);
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
  assert.doesNotMatch(html, /played-row-pve-reveal/);
  assert.match(html, /match-status-panel player-win clash-winner-fire/);
  assert.match(html, /round-result-banner player-win is-active is-emphasized/);
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
  assert.match(html, /played-slot is-facedown/);
  assert.doesNotMatch(html, /played-row-pve-reveal/);
  assert.doesNotMatch(html, /clash-winner-fire/);
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
    viewedProfile: null,
    backgroundImage: "assets/EleMintzIcon.png"
  });

  assert.match(html, /achievement-grid achievement-grid-profile/);
});

test("ui: profile screen shows next reward preview", () => {
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
    viewedProfile: null,
    actions: {
      equip: () => {},
      searchProfiles: () => {},
      viewProfile: () => {},
      clearViewed: () => {},
      back: () => {}
    }
  });

  assert.match(html, /Next Reward:/);
  assert.match(html, /Lv 5 - Avatar: Novice Mage/);
  assert.match(html, /XP: 17 \/ 35/);
  assert.match(html, /aria-valuenow="49"/);
  assert.match(html, /data-target-width="49"/);
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
    viewedProfile: null,
    actions: {
      equip: () => {},
      searchProfiles: () => {},
      viewProfile: () => {},
      clearViewed: () => {},
      back: () => {}
    }
  });

  assert.match(html, /XP: 0 \/ 75/);
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
    viewedProfile: null,
    actions: {
      equip: () => {},
      searchProfiles: () => {},
      viewProfile: () => {},
      clearViewed: () => {},
      back: () => {}
    }
  });

  assert.match(html, /Level 4/);
  assert.match(html, /XP: 2 \/ 55/);
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
  assert.match(html, /State:<\/strong> Waiting for Opponent/);
  assert.match(html, /Error:<\/strong> Previous error/);
  assert.match(html, /Room Code:<\/strong> ABC123/);
  assert.match(html, /Role:<\/strong> Host/);
  assert.doesNotMatch(html, /Connection:<\/strong>/);
  assert.doesNotMatch(html, /id="online-create-room-btn"/);
  assert.doesNotMatch(html, /id="online-room-code-input"/);
  assert.doesNotMatch(html, /value="abc123"/);
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
  assert.match(html, /Reason:<\/strong> HAND_EXHAUSTION/);
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

  assert.match(html, /Round Result/);
  assert.match(html, /Host Move:<\/strong> Fire/);
  assert.match(html, /Guest Move:<\/strong> Water/);
  assert.match(html, /Result:<\/strong> You Win/);
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
    dailyChallenges: { daily: { progress: { matchesPlayed: 1 } } },
    weeklyChallenges: { weekly: { progress: { matchesPlayed: 1 } } },
    modeStats: { online_pvp: { wins: 1, losses: 0 } }
  };
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
    assert.equal(shown.at(-1).backgroundImage, getArenaBackground("default_background"));
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
    global.__onlineListener(settledState);
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

  assert.match(noEffectHtml, /Host Move:<\/strong> Fire/);
  assert.match(noEffectHtml, /Guest Move:<\/strong> Wind/);
  assert.match(noEffectHtml, /Result:<\/strong> No Effect/);
  assert.match(warHtml, /Host Move:<\/strong> Fire/);
  assert.match(warHtml, /Guest Move:<\/strong> Fire/);
  assert.match(warHtml, /Result:<\/strong> WAR Continues/);
  assert.match(warHtml, /WAR Status/);
  assert.match(warHtml, /WAR Active:<\/strong> Yes/);
  assert.match(warHtml, /WAR Depth:<\/strong> 1/);
  assert.match(warHtml, /Round 1: Fire vs Fire - WAR/);
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

  assert.match(html, /Result:<\/strong> WAR Won/);
  assert.match(html, /Round 2: Water vs Fire - WAR RESOLVED/);
});

test("ui: online play screen bind delegates move button clicks to submitMove", async () => {
  const previousDocument = global.document;
  const calls = [];
  let moveClickHandler = null;

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

      if (id === "online-move-actions") {
        return moveActions;
      }

      if (id === "online-join-room-form") {
        return { addEventListener: () => {} };
      }

      return null;
    }
  };

  try {
    onlinePlayScreen.bind({
      actions: {
        createRoom: async () => {},
        back: async () => {},
        joinRoom: async () => {},
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

    assert.deepEqual(calls, ["fire"]);
  } finally {
    global.document = previousDocument;
  }
});

test("ui: profile screen uses a chest count bubble and subtle empty helper text when no basic chests are available", () => {
  const html = profileScreen.render({
    profile: {
      username: "ChestlessUser",
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
      equipped: { avatar: "default_avatar", cardBack: "default_card_back", background: "default_background", elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" }, badge: "none", title: "Initiate" },
      catalog: { avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }], cardBack: [{ id: "default_card_back", name: "Default", owned: true }], background: [{ id: "default_background", name: "Default", owned: true }], elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }], badge: [{ id: "none", name: "No Badge", owned: true }], title: [{ id: "Initiate", name: "Initiate", owned: true }] }
    },
    basicChestVisualState: { basicOpen: false },
    titleIcon: null,
    backgroundImage: "assets/EleMintzIcon.png",
    searchQuery: "",
    searchResults: [],
    viewedProfile: null,
    actions: {
      openBasicChest: () => {},
      searchProfiles: () => {},
      viewProfile: () => {},
      clearViewed: () => {},
      back: () => {}
    }
  });

  assert.match(html, /src="(?:file:.*\/)?assets\/icons\/basic_chest\.png"/);
  assert.match(html, /id="open-basic-chest-btn"/);
  assert.match(html, /class="chest-count-bubble"[^>]*>0</);
  assert.match(html, /class="chest-open-trigger"/);
  assert.match(html, /No Basic Chests available/);
  assert.doesNotMatch(html, /Basic Chests: <strong>/);
  assert.match(html, /disabled aria-disabled="true"/);
});

test("ui: profile screen enables open chest button when player has a basic chest", () => {
  const html = profileScreen.render({
    profile: {
      username: "ChestOwner",
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
      chests: { basic: 2 },
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: { avatar: "default_avatar", cardBack: "default_card_back", background: "default_background", elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" }, badge: "none", title: "Initiate" },
      catalog: { avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }], cardBack: [{ id: "default_card_back", name: "Default", owned: true }], background: [{ id: "default_background", name: "Default", owned: true }], elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }], badge: [{ id: "none", name: "No Badge", owned: true }], title: [{ id: "Initiate", name: "Initiate", owned: true }] }
    },
    basicChestVisualState: { basicOpen: false },
    titleIcon: null,
    backgroundImage: "assets/EleMintzIcon.png",
    searchQuery: "",
    searchResults: [],
    viewedProfile: null,
    actions: {
      openBasicChest: () => {},
      searchProfiles: () => {},
      viewProfile: () => {},
      clearViewed: () => {},
      back: () => {}
    }
  });

  assert.match(html, /class="chest-count-bubble"[^>]*>2</);
  assert.match(html, /Click chest to open/);
  assert.doesNotMatch(html, /Basic Chests: <strong>/);
  assert.doesNotMatch(html, /disabled aria-disabled="true"/);
});

test("ui: profile screen swaps to the open chest image when the local visual state is active", () => {
  const html = profileScreen.render({
    profile: {
      username: "ChestOwner",
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
      chests: { basic: 1 },
      achievements: {},
      modeStats: { pve: { wins: 0, losses: 0 }, local_pvp: { wins: 0, losses: 0 } },
      equippedCosmetics: { avatar: "default_avatar", title: "Initiate", badge: "none" }
    },
    cosmetics: {
      equipped: { avatar: "default_avatar", cardBack: "default_card_back", background: "default_background", elementCardVariant: { fire: "default_fire_card", water: "default_water_card", earth: "default_earth_card", wind: "default_wind_card" }, badge: "none", title: "Initiate" },
      catalog: { avatar: [{ id: "default_avatar", name: "Default Avatar", owned: true }], cardBack: [{ id: "default_card_back", name: "Default", owned: true }], background: [{ id: "default_background", name: "Default", owned: true }], elementCardVariant: [{ id: "default_fire_card", name: "Core Fire", element: "fire", owned: true }], badge: [{ id: "none", name: "No Badge", owned: true }], title: [{ id: "Initiate", name: "Initiate", owned: true }] }
    },
    basicChestVisualState: { basicOpen: true },
    titleIcon: null,
    backgroundImage: "assets/EleMintzIcon.png",
    searchQuery: "",
    searchResults: [],
    viewedProfile: null,
    actions: {
      openBasicChest: () => {},
      searchProfiles: () => {},
      viewProfile: () => {},
      clearViewed: () => {},
      back: () => {}
    }
  });

  assert.match(html, /data-basic-chest-image="true"/);
  assert.match(html, /src="(?:file:.*\/)?assets\/icons\/basic_chest_open\.png"/);
  assert.doesNotMatch(html, /src="(?:file:.*\/)?assets\/icons\/basic_chest\.png" alt="Basic Chest" data-basic-chest-image="true"/);
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

  const payload = controller.buildMatchCompleteModalPayload(
    "pve",
    {
      winner: "p1",
      endReason: "normal",
      history: [
        { result: "p1" },
        { result: "p2", cardsCaptured: { p1: 2 } },
        { result: "p1" }
      ]
    },
    {
      stats: {
        cardsCaptured: 3,
        warsEntered: 2,
        longestWar: 4
      }
    }
  );

  assert.match(payload.bodyHtml, /class="match-complete-modal is-victory"/);
  assert.match(payload.bodyHtml, /<h4 class="match-complete-outcome">Victory<\/h4>/);
  assert.match(payload.bodyHtml, /VampyrLee defeated Elemental AI\./);
  assert.match(payload.bodyHtml, /VampyrLee • 3 \| Elemental AI • 0/);
  assert.match(payload.bodyHtml, /Captures/);
  assert.match(payload.bodyHtml, /WARs Entered/);
  assert.match(payload.bodyHtml, /Longest WAR/);
  assert.match(payload.bodyHtml, /Rounds Played/);
  assert.match(payload.bodyHtml, /id="match-complete-play-again"/);
  assert.match(payload.bodyHtml, /id="match-complete-return-menu"/);
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
