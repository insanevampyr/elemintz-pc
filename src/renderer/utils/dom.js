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

export function getAssetPath(relativePath) {
  return `../../assets/${relativePath}`;
}

export function byId(id) {
  return document.getElementById(id);
}
