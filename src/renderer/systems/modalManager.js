export class ModalManager {
  constructor(rootNode) {
    this.rootNode = rootNode;
  }

  hasOpenOverlay() {
    return Boolean(this.rootNode?.querySelector?.(".modal-overlay"));
  }

  show({ title, body, bodyHtml, actions = [], modalClassName = "", bodyClassName = "" }) {
    const actionButtons = actions
      .map(
        (action, index) =>
          `<button class="modal-btn" data-modal-action="${index}">${action.label}</button>`
      )
      .join("");
    const safeModalClassName = String(modalClassName ?? "").trim();
    const safeBodyClassName = String(bodyClassName ?? "").trim();
    const modalClassAttribute = safeModalClassName ? `modal ${safeModalClassName}` : "modal";
    const bodyClassAttribute = safeBodyClassName ? `modal-body ${safeBodyClassName}` : "modal-body";

    const content = bodyHtml
      ? `<div class="${bodyClassAttribute}">${bodyHtml}</div>`
      : `<p class="${bodyClassAttribute}">${body ?? ""}</p>`;

    this.rootNode.innerHTML = `
      <div class="modal-overlay">
        <section class="${modalClassAttribute}">
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
