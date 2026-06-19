const MATCH_COMPLETE_VISUAL_VARIANTS = Object.freeze({
  modal: Object.freeze({
    rootClassName: "match-complete-modal",
    rootDataAttributes: ""
  }),
  online: Object.freeze({
    rootClassName: "panel stack-sm",
    rootDataAttributes: ""
  })
});

function joinValues(...values) {
  return values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

export function renderMatchCompleteVisualShell({
  variant,
  headerHtml = "",
  summaryHtml = "",
  statsHtml = "",
  rewardsHtml = "",
  extraHtml = "",
  actionsHtml = "",
  rootClassName = "",
  rootDataAttributes = ""
} = {}) {
  const config = MATCH_COMPLETE_VISUAL_VARIANTS[variant];
  if (!config) {
    throw new Error(`Unsupported match complete visual variant '${variant}'.`);
  }

  const rootClasses = joinValues(config.rootClassName, rootClassName);
  const rootAttributes = joinValues(config.rootDataAttributes, rootDataAttributes);
  const slots = [
    headerHtml,
    summaryHtml,
    statsHtml,
    rewardsHtml,
    extraHtml,
    actionsHtml
  ]
    .filter((html) => html !== null && html !== undefined && html !== "")
    .join("\n");

  return `
    <section class="${rootClasses}"${rootAttributes ? ` ${rootAttributes}` : ""}>
      ${slots}
    </section>
  `;
}
