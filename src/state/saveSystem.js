import { JsonStore } from "./storage/jsonStore.js";

export class SaveSystem {
  constructor(options = {}) {
    this.store = new JsonStore("saves.json", options);
  }

  async listMatchResults() {
    return this.store.read([]);
  }

  async appendMatchResult(entry) {
    const saves = await this.listMatchResults();
    saves.push(entry);
    await this.store.write(saves);
    return entry;
  }
}
