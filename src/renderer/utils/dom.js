export function formatElement(element) {
  if (!element) return "?";
  return `${element.charAt(0).toUpperCase()}${element.slice(1)}`;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const ASSET_BASE_URL = new URL("../../../assets/", import.meta.url);

export function getAssetPath(relativePath) {
  return new URL(String(relativePath ?? ""), ASSET_BASE_URL).toString();
}

export function byId(id) {
  return document.getElementById(id);
}
