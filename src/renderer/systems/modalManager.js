export class ModalManager {
  constructor(rootNode) {
    this.rootNode = rootNode;
  }

  hasOpenOverlay() {
    return Boolean(this.rootNode?.querySelector?.(".modal-overlay"));
  }

  show({ title, body, bodyHtml, actions = [] }) {
    const actionButtons = actions
      .map(
        (action, index) =>
          `<button class="modal-btn" data-modal-action="${index}">${action.label}</button>`
      )
      .join("");

    const content = bodyHtml
      ? `<div class="modal-body">${bodyHtml}</div>`
      : `<p class="modal-body">${body ?? ""}</p>`;

    this.rootNode.innerHTML = `
      <div class="modal-overlay">
        <section class="modal">
          <h3>${title}</h3>
          ${content}
          <div class="modal-actions">${actionButtons}</div>
        </section>
      </div>
    `;

    this.rootNode.querySelectorAll("[data-modal-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const actionIndex = Number(button.getAttribute("data-modal-action"));
        const action = actions[actionIndex];
        if (action?.onClick) {
          action.onClick();
        }
      });
    });
  }

  hide() {
    this.rootNode.innerHTML = "";
  }

  clearStaleOverlay() {
    if (!this.hasOpenOverlay()) {
      return false;
    }

    this.hide();
    return true;
  }
}
