const LOWER_HUD_LAYOUT_VARIANTS = Object.freeze({
  game: Object.freeze({
    rootClassName: "panel match-status-panel",
    rootDataAttributes: "",
    zoneClassNames: Object.freeze({
      left: "game-status-zone game-status-zone-left",
      center: "game-status-zone game-status-zone-center",
      right: "game-status-zone game-status-zone-right"
    }),
    zoneDataAttributes: Object.freeze({
      left: 'data-game-status-zone="left"',
      center: 'data-game-status-zone="center"',
      right: 'data-game-status-zone="right"'
    })
  }),
  online: Object.freeze({
    rootClassName: "panel match-status-panel online-play-status-panel has-center-result",
    rootDataAttributes: 'data-online-active-match-status="true"',
    zoneClassNames: Object.freeze({
      left: "online-play-status-zone online-play-status-zone-left",
      center: "online-play-status-zone online-play-status-zone-center",
      right: "online-play-status-zone online-play-status-zone-right"
    }),
    zoneDataAttributes: Object.freeze({
      left: 'data-online-status-zone="left"',
      center: 'data-online-status-zone="center" data-online-status-center-result="true"',
      right: 'data-online-status-zone="right"'
    })
  })
});

function joinValues(...values) {
  return values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

export function renderLowerHudLayout({
  variant,
  leftSlotHtml = "",
  centerSlotHtml = "",
  rightSlotHtml = "",
  rootClassName = "",
  rootDataAttributes = "",
  zoneClassNames = {},
  zoneDataAttributes = {},
  beforeZonesHtml = ""
} = {}) {
  const config = LOWER_HUD_LAYOUT_VARIANTS[variant];
  if (!config) {
    throw new Error(`Unsupported lower HUD layout variant '${variant}'.`);
  }

  const rootClasses = joinValues(config.rootClassName, rootClassName);
  const rootAttributes = joinValues(config.rootDataAttributes, rootDataAttributes);
  const leftClasses = joinValues(config.zoneClassNames.left, zoneClassNames.left);
  const centerClasses = joinValues(config.zoneClassNames.center, zoneClassNames.center);
  const rightClasses = joinValues(config.zoneClassNames.right, zoneClassNames.right);
  const leftAttributes = joinValues(
    config.zoneDataAttributes.left,
    zoneDataAttributes.left
  );
  const centerAttributes = joinValues(
    config.zoneDataAttributes.center,
    zoneDataAttributes.center
  );
  const rightAttributes = joinValues(
    config.zoneDataAttributes.right,
    zoneDataAttributes.right
  );

  return `
    <article class="${rootClasses}"${rootAttributes ? ` ${rootAttributes}` : ""}>
      ${beforeZonesHtml}
      <div class="${leftClasses}"${leftAttributes ? ` ${leftAttributes}` : ""}>
        ${leftSlotHtml}
      </div>
      <div class="${centerClasses}"${centerAttributes ? ` ${centerAttributes}` : ""}>
        ${centerSlotHtml}
      </div>
      <div class="${rightClasses}"${rightAttributes ? ` ${rightAttributes}` : ""}>
        ${rightSlotHtml}
      </div>
    </article>
  `;
}
