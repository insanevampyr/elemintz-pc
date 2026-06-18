const ACTIVE_MATCH_LAYOUT_VARIANTS = Object.freeze({
  game: Object.freeze({
    rootClassName: "game-active-match-shell",
    rootDataAttributes: 'data-game-active-match-shell="true"',
    slotClassNames: Object.freeze({
      main: "game-active-match-main",
      expressions: "game-active-match-expressions",
      status: "game-active-match-status"
    }),
    slotDataAttributes: Object.freeze({
      main: 'data-game-active-match-main="true"',
      expressions: 'data-game-active-match-expressions="true"',
      status: 'data-game-active-match-status-shell="true"'
    })
  }),
  online: Object.freeze({
    rootClassName: "online-active-match-shell",
    rootDataAttributes: 'data-online-active-match-shell="true"',
    slotClassNames: Object.freeze({
      main: "online-active-match-main",
      expressions: "online-active-match-expressions",
      status: "online-active-match-status"
    }),
    slotDataAttributes: Object.freeze({
      main: "",
      expressions: 'data-online-active-match-expressions="true"',
      status: 'data-online-active-match-status-shell="true"'
    })
  })
});

function joinValues(...values) {
  return values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

export function renderActiveMatchLayout({
  variant,
  mainSlotHtml = "",
  expressionsSlotHtml = "",
  statusSlotHtml = "",
  rootClassName = "",
  rootDataAttributes = "",
  slotClassNames = {},
  slotDataAttributes = {}
} = {}) {
  const config = ACTIVE_MATCH_LAYOUT_VARIANTS[variant];
  if (!config) {
    throw new Error(`Unsupported active match layout variant '${variant}'.`);
  }

  const rootClasses = joinValues(config.rootClassName, rootClassName);
  const rootAttributes = joinValues(config.rootDataAttributes, rootDataAttributes);
  const mainClasses = joinValues(config.slotClassNames.main, slotClassNames.main);
  const expressionsClasses = joinValues(
    config.slotClassNames.expressions,
    slotClassNames.expressions
  );
  const statusClasses = joinValues(config.slotClassNames.status, slotClassNames.status);
  const mainAttributes = joinValues(
    config.slotDataAttributes.main,
    slotDataAttributes.main
  );
  const expressionsAttributes = joinValues(
    config.slotDataAttributes.expressions,
    slotDataAttributes.expressions
  );
  const statusAttributes = joinValues(
    config.slotDataAttributes.status,
    slotDataAttributes.status
  );

  return `
    <section class="${rootClasses}"${rootAttributes ? ` ${rootAttributes}` : ""}>
      <div class="${mainClasses}"${mainAttributes ? ` ${mainAttributes}` : ""}>
        ${mainSlotHtml}
      </div>
      <div class="${expressionsClasses}"${expressionsAttributes ? ` ${expressionsAttributes}` : ""}>
        ${expressionsSlotHtml}
      </div>
      <div class="${statusClasses}"${statusAttributes ? ` ${statusAttributes}` : ""}>
        ${statusSlotHtml}
      </div>
    </section>
  `;
}
