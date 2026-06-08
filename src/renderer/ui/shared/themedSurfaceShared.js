import { getArenaBackground } from "../../utils/assets.js";

const DEFAULT_BACKGROUND_IMAGE = getArenaBackground("default_background");
const DEFAULT_BACKGROUND_SUFFIX = "assets/backgrounds/default_background.png";

function isDefaultBackgroundImage(backgroundImage) {
  const candidate = String(backgroundImage ?? "");
  return candidate === DEFAULT_BACKGROUND_IMAGE || candidate.replaceAll("\\", "/").endsWith(DEFAULT_BACKGROUND_SUFFIX);
}

export function buildThemedSurfaceClassName({ backgroundImage = "", auth = false } = {}) {
  const classNames = ["arena-board", "screen-themed-surface"];
  if (isDefaultBackgroundImage(backgroundImage)) {
    classNames.push("default-themed-surface");
  }
  if (auth) {
    classNames.push("auth-themed-surface");
  }
  return classNames.join(" ");
}
