export class ScreenManager {
  constructor(rootNode) {
    this.rootNode = rootNode;
    this.registry = new Map();
    this.current = null;
  }

  register(name, screenDefinition) {
    this.registry.set(name, screenDefinition);
  }

  show(name, context = {}) {
    const screen = this.registry.get(name);
    if (!screen) {
      throw new Error(`Screen '${name}' is not registered.`);
    }

    this.current = name;
    this.rootNode.innerHTML = screen.render(context);
    if (typeof screen.bind === "function") {
      screen.bind(context);
    }
  }
}
