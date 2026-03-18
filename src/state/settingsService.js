import { JsonStore } from "./storage/jsonStore.js";

const DEFAULT_SETTINGS = {
  audio: {
    enabled: true,
    master: 0.8,
    music: 0.7,
    sfx: 0.9
  },
  gameplay: {
    timerSeconds: 30
  },
  aiDifficulty: "normal",
  aiOpponentStyle: "default",
  ui: {
    reducedMotion: false,
    showRoundHistory: true
  }
};

function mergeDeep(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) {
    return patch;
  }

  if (typeof base !== "object" || typeof patch !== "object" || !base || !patch) {
    return patch;
  }

  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = key in base ? mergeDeep(base[key], value) : value;
  }
  return out;
}

export class SettingsService {
  constructor(options = {}) {
    this.store = new JsonStore("settings.json", options);
  }

  async getSettings() {
    return this.store.read(DEFAULT_SETTINGS);
  }

  async updateSettings(patch) {
    const current = await this.getSettings();
    const next = mergeDeep(current, patch);
    await this.store.write(next);
    return next;
  }

  async resetSettings() {
    await this.store.write(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
}
