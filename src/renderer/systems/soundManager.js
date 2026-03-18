import { ASSET_CATALOG } from "../utils/assets.js";

export class SoundManager {
  constructor(options = {}) {
    this.catalog = options.catalog ?? ASSET_CATALOG.sounds;
    this.audioFactory =
      options.audioFactory ??
      ((src) => {
        if (typeof Audio === "undefined") {
          return null;
        }
        return new Audio(src);
      });
    this.now = options.now ?? (() => Date.now());
    this.setTimeout = options.setTimeout ?? globalThis.setTimeout?.bind(globalThis);
    this.cooldownMs = Number(options.cooldownMs ?? 120);
    this.queueSpacingMs = Number(options.queueSpacingMs ?? 1000);
    this.queueBurstWindowMs = Number(options.queueBurstWindowMs ?? 200);
    this.enabled = options.enabled ?? true;

    this.audioPool = new Map();
    this.lastPlayedAt = new Map();
    this.lastRequestedAt = 0;
    this.lastScheduledAt = 0;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  isEnabled() {
    return this.enabled;
  }

  performPlay(key, playedAt = this.now()) {
    if (!this.enabled) {
      return false;
    }

    const src = this.catalog?.[key];
    if (!src || typeof src !== "string") {
      return false;
    }

    const last = this.lastPlayedAt.get(key) ?? 0;
    if (playedAt - last < this.cooldownMs) {
      return false;
    }
    this.lastPlayedAt.set(key, playedAt);

    if (!this.audioPool.has(key)) {
      try {
        const audio = this.audioFactory(src);
        if (!audio) {
          return false;
        }
        this.audioPool.set(key, audio);
      } catch {
        return false;
      }
    }

    const instance = this.audioPool.get(key);
    if (!instance) {
      return false;
    }

    try {
      instance.currentTime = 0;
      instance.play().catch(() => {
        // Browser autoplay restrictions may block until user input.
      });
      return true;
    } catch {
      return false;
    }
  }

  play(key) {
    if (!this.enabled) {
      return false;
    }

    const src = this.catalog?.[key];
    if (!src || typeof src !== "string") {
      return false;
    }

    const now = this.now();
    const last = this.lastPlayedAt.get(key) ?? 0;
    if (now - last < this.cooldownMs) {
      return false;
    }

    const hasQueuedSound = this.lastScheduledAt > now;
    const withinBurstWindow =
      this.lastRequestedAt > 0 && now - this.lastRequestedAt <= this.queueBurstWindowMs;
    this.lastRequestedAt = now;

    if (!hasQueuedSound && !withinBurstWindow) {
      this.lastScheduledAt = now;
      return this.performPlay(key, now);
    }

    if (typeof this.setTimeout !== "function") {
      this.lastScheduledAt = now;
      return this.performPlay(key);
    }

    const scheduledAt = Math.max(now, this.lastScheduledAt + this.queueSpacingMs);
    this.lastScheduledAt = scheduledAt;
    this.setTimeout(() => {
      this.performPlay(key, this.now());
    }, Math.max(0, scheduledAt - now));
    return true;
  }

  playRoundResolved({ mode, round }) {
    if (!round) {
      return;
    }

    if (mode === "pve") {
      if (round.result === "p1") {
        this.play("roundWin");
      } else if (round.result === "p2") {
        if (round.warClashes > 0) {
          this.play("warLoss");
        } else {
          this.play("roundLoss");
        }
      }
    }
  }

  playMatchComplete({ mode, match }) {
    if (!match || match.status !== "completed") {
      return;
    }

    if (mode === "pve") {
      if (match.winner === "p1") {
        this.play("matchWin");
      } else if (match.winner === "p2") {
        this.play("matchLoss");
      }
      return;
    }

    if (mode === "local_pvp") {
      // Local hotseat has no single player-perspective victory sound.
      return;
    }
  }

  getElementSoundKey(card) {
    switch (String(card ?? "").toLowerCase()) {
      case "fire":
        return "playFire";
      case "water":
        return "playWater";
      case "earth":
        return "playEarth";
      case "wind":
        return "playWind";
      default:
        return null;
    }
  }

  playReveal({ mode, cards = [] }) {
    if (mode === "local_pvp") {
      return this.play("cardFlip");
    }

    if (mode !== "pve") {
      return false;
    }

    let played = false;
    for (const card of cards) {
      const key = this.getElementSoundKey(card);
      if (key) {
        played = this.play(key) || played;
      }
    }

    return played;
  }
}
