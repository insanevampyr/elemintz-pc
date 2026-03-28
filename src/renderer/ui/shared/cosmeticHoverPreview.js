const PREVIEW_SELECTOR = "[data-hover-preview=\"true\"]";
const PREVIEW_OFFSET = 18;
const PREVIEW_MARGIN = 12;
const PREVIEW_DIMENSIONS = Object.freeze({
  avatar: { width: 220, height: 220, mediaWidth: 220, mediaHeight: 220 },
  cardBack: { width: 220, height: 330, mediaWidth: 220, mediaHeight: 330 },
  elementCardVariant: { width: 220, height: 330, mediaWidth: 220, mediaHeight: 330 },
  background: { width: 340, height: 240, mediaWidth: 340, mediaHeight: 240 },
  badge: { width: 260, height: 328, mediaWidth: 168, mediaHeight: 168, metaOnlyHeight: 90 },
  title: { width: 228, height: 286, mediaWidth: 188, mediaHeight: 188, metaOnlyHeight: 86 }
});

function getPreviewDimensions(previewType) {
  return PREVIEW_DIMENSIONS[previewType] ?? PREVIEW_DIMENSIONS.cardBack;
}

function parsePreviewDimensionValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function fitPreviewDimensions(maxWidth, maxHeight, sourceWidth, sourceHeight) {
  if (!(maxWidth > 0 && maxHeight > 0 && sourceWidth > 0 && sourceHeight > 0)) {
    return null;
  }

  const ratio = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * ratio)),
    height: Math.max(1, Math.round(sourceHeight * ratio))
  };
}

function readPreviewSourceDimensions(target) {
  if (!target) {
    return null;
  }

  const attrWidth = parsePreviewDimensionValue(target.getAttribute?.("data-preview-width"));
  const attrHeight = parsePreviewDimensionValue(target.getAttribute?.("data-preview-height"));
  if (attrWidth && attrHeight) {
    return { width: attrWidth, height: attrHeight };
  }

  const targetTagName = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
  const image =
    (targetTagName === "img" ? target : null) ??
    target.querySelector?.(".cosmetic-preview") ??
    target.querySelector?.("img") ??
    null;
  const naturalWidth = parsePreviewDimensionValue(image?.naturalWidth);
  const naturalHeight = parsePreviewDimensionValue(image?.naturalHeight);
  if (naturalWidth && naturalHeight) {
    return { width: naturalWidth, height: naturalHeight };
  }

  return null;
}

function resolveMediaDimensions(previewType, baseDimensions, sourceDimensions) {
  if (!sourceDimensions) {
    return {
      width: baseDimensions.mediaWidth,
      height: baseDimensions.mediaHeight
    };
  }

  const fitted = fitPreviewDimensions(
    baseDimensions.mediaWidth,
    baseDimensions.mediaHeight,
    sourceDimensions.width,
    sourceDimensions.height
  );

  return fitted ?? { width: baseDimensions.mediaWidth, height: baseDimensions.mediaHeight };
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizePreviewToken(value) {
  return String(value ?? "").trim();
}

export function hasRenderablePreviewSource(value, { previewName = "", previewVisualText = "" } = {}) {
  const normalized = normalizePreviewToken(value);
  if (!normalized) {
    return false;
  }

  const lowered = normalized.toLowerCase();
  if (lowered === "null" || lowered === "undefined" || lowered === "none") {
    return false;
  }

  const previewNameToken = normalizePreviewToken(previewName).toLowerCase();
  const previewVisualToken = normalizePreviewToken(previewVisualText).toLowerCase();
  if (lowered === previewNameToken || lowered === previewVisualToken) {
    return false;
  }

  return (
    lowered.startsWith("file:") ||
    lowered.startsWith("http://") ||
    lowered.startsWith("https://") ||
    lowered.startsWith("data:") ||
    lowered.startsWith("blob:") ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    /\.(png|jpe?g|webp|gif|svg)$/i.test(normalized)
  );
}

export function buildHoverPreviewAttributes({
  previewType,
  previewSrc = null,
  previewName = null,
  previewDescription = null,
  previewVisualText = null,
  previewRarity = "Common"
} = {}) {
  if (!previewType) {
    return "";
  }

  return [
    'data-hover-preview="true"',
    `data-preview-type="${escapeAttribute(previewType)}"`,
    `data-preview-rarity="${escapeAttribute(previewRarity)}"`,
    `data-preview-src="${escapeAttribute(previewSrc ?? "")}"`,
    `data-preview-name="${escapeAttribute(previewName ?? "")}"`,
    `data-preview-description="${escapeAttribute(previewDescription ?? "")}"`,
    `data-preview-visual-text="${escapeAttribute(previewVisualText ?? "")}"`
  ].join(" ");
}

function findPreviewTarget(startNode, root) {
  if (!startNode || typeof startNode.closest !== "function") {
    return null;
  }

  const target = startNode.closest(PREVIEW_SELECTOR);
  if (!target) {
    return null;
  }

  if (root && typeof root.contains === "function" && !root.contains(target)) {
    return null;
  }

  return target;
}

function getViewport(documentRef) {
  const viewportSource = documentRef?.documentElement ?? {};
  const windowRef = documentRef?.defaultView ?? globalThis.window ?? {};
  return {
    width: Number(windowRef.innerWidth ?? viewportSource.clientWidth ?? 1280),
    height: Number(windowRef.innerHeight ?? viewportSource.clientHeight ?? 720)
  };
}

function clampPreviewPosition(clientX, clientY, dimensions, documentRef) {
  const viewport = getViewport(documentRef);
  let left = clientX + PREVIEW_OFFSET;
  let top = clientY + PREVIEW_OFFSET;

  if (left + dimensions.width > viewport.width - PREVIEW_MARGIN) {
    left = clientX - dimensions.width - PREVIEW_OFFSET;
  }

  if (top + dimensions.height > viewport.height - PREVIEW_MARGIN) {
    top = viewport.height - dimensions.height - PREVIEW_MARGIN;
  }

  return {
    left: Math.max(PREVIEW_MARGIN, left),
    top: Math.max(PREVIEW_MARGIN, top)
  };
}

function createPreviewElements(documentRef) {
  if (!documentRef?.body || typeof documentRef.createElement !== "function") {
    return null;
  }

  const layer = documentRef.createElement("div");
  layer.id = "cosmetic-hover-preview-layer";
  layer.className = "cosmetic-hover-preview-layer";
  layer.hidden = true;

  const frame = documentRef.createElement("div");
  frame.className = "cosmetic-hover-preview-frame";

  const image = documentRef.createElement("img");
  image.className = "cosmetic-hover-preview-image";
  image.alt = "";

  const textVisual = documentRef.createElement("div");
  textVisual.className = "cosmetic-hover-preview-text-visual";
  textVisual.hidden = true;

  const meta = documentRef.createElement("div");
  meta.className = "cosmetic-hover-preview-meta";
  meta.hidden = true;

  const name = documentRef.createElement("p");
  name.className = "cosmetic-hover-preview-name";

  const description = documentRef.createElement("p");
  description.className = "cosmetic-hover-preview-description";

  meta.appendChild(name);
  meta.appendChild(description);
  frame.appendChild(image);
  frame.appendChild(textVisual);
  layer.appendChild(frame);
  layer.appendChild(meta);
  documentRef.body.appendChild(layer);

  return { layer, frame, image, textVisual, meta, name, description };
}

function attachPreviewSection(parent, child) {
  if (!parent || !child) {
    return;
  }

  if (typeof parent.contains === "function" && parent.contains(child)) {
    return;
  }

  if (Array.isArray(parent.children) && !parent.children.includes(child)) {
    parent.children.push(child);
    return;
  }

  parent.appendChild?.(child);
}

function detachPreviewSection(parent, child) {
  if (!parent || !child) {
    return;
  }

  if (typeof parent.contains === "function" && !parent.contains(child)) {
    return;
  }

  if (Array.isArray(parent.children)) {
    const index = parent.children.indexOf(child);
    if (index >= 0) {
      parent.children.splice(index, 1);
    }
    return;
  }

  parent.removeChild?.(child);
}

function ensurePreviewElements(documentRef) {
  if (documentRef?.__elemintzCosmeticHoverPreview) {
    return documentRef.__elemintzCosmeticHoverPreview;
  }

  const created = createPreviewElements(documentRef);
  if (!created) {
    return null;
  }

  documentRef.__elemintzCosmeticHoverPreview = created;
  return created;
}

function clearPreviewImageState(image) {
  if (!image) {
    return;
  }

  image.hidden = true;
  image.src = "";
  image.alt = "";
  image.removeAttribute?.("src");
}

function updatePreviewAppearance(preview, target) {
  const previewType = target.getAttribute("data-preview-type") ?? "cardBack";
  const previewRarity = String(target.getAttribute("data-preview-rarity") ?? "Common").toLowerCase();
  const previewSrc = target.getAttribute("data-preview-src");
  const previewName = target.getAttribute("data-preview-name") ?? "";
  const previewDescription = target.getAttribute("data-preview-description") ?? "";
  const previewVisualText = target.getAttribute("data-preview-visual-text") ?? previewName;
  const dimensions = getPreviewDimensions(previewType);
  const mediaDimensions = resolveMediaDimensions(previewType, dimensions, readPreviewSourceDimensions(target));
  const showMeta = previewType === "badge" || previewType === "title";
  const hasPreviewImage = hasRenderablePreviewSource(previewSrc, {
    previewName,
    previewVisualText
  });
  const useTextVisual = !hasPreviewImage && previewType === "title" && !showMeta;
  const showFrame = hasPreviewImage || useTextVisual || !showMeta;

  const layoutWidth = showMeta ? dimensions.width : mediaDimensions.width;
  const layoutHeight = showMeta
    ? showFrame
      ? dimensions.height
      : dimensions.metaOnlyHeight ?? dimensions.height
    : mediaDimensions.height;

  if (showMeta) {
    attachPreviewSection(preview.layer, preview.meta);
  } else {
    detachPreviewSection(preview.layer, preview.meta);
  }

  if (showFrame) {
    attachPreviewSection(preview.layer, preview.frame);
  } else {
    detachPreviewSection(preview.layer, preview.frame);
  }

  preview.layer.className = `cosmetic-hover-preview-layer ${showMeta ? "has-meta" : ""}`;
  preview.frame.className = `cosmetic-hover-preview-frame ${
    previewType === "avatar"
      ? "is-avatar"
      : previewType === "badge"
        ? "is-badge"
        : previewType === "title"
          ? "is-title"
          : previewType === "background"
            ? "is-background"
            : "is-card"
  } rarity-${previewRarity}`;
  preview.frame.style.width = `${mediaDimensions.width}px`;
  preview.frame.style.height = `${mediaDimensions.height}px`;
  preview.layer.style.width = `${layoutWidth}px`;
  preview.layer.style.height = `${layoutHeight}px`;
  preview.frame.hidden = !showFrame;
  if (hasPreviewImage) {
    preview.image.src = previewSrc;
    preview.image.alt = previewName;
    preview.image.hidden = false;
  } else {
    clearPreviewImageState(preview.image);
  }
  preview.textVisual.hidden = !useTextVisual;
  preview.textVisual.textContent = useTextVisual ? previewVisualText : "";
  preview.meta.hidden = !showMeta;
  preview.name.textContent = showMeta ? previewName : "";
  preview.description.hidden = !(showMeta && previewDescription);
  preview.description.textContent = showMeta ? previewDescription : "";

  return { width: layoutWidth, height: layoutHeight, mediaWidth: mediaDimensions.width, mediaHeight: mediaDimensions.height };
}

export function bindCosmeticHoverPreview({ root, documentRef = globalThis.document } = {}) {
  if (!root || typeof root.addEventListener !== "function") {
    return;
  }

  const preview = ensurePreviewElements(documentRef);
  if (!preview) {
    return;
  }

  let activeTarget = null;
  let activeDimensions = null;

  const hidePreview = () => {
    activeTarget = null;
    activeDimensions = null;
    clearPreviewImageState(preview.image);
    preview.layer.hidden = true;
    preview.layer.classList?.remove?.("is-visible");
  };

  const showPreview = (target, event) => {
    if (!target) {
      hidePreview();
      return;
    }

    activeTarget = target;
    activeDimensions = updatePreviewAppearance(preview, target);
    const position = clampPreviewPosition(
      Number(event?.clientX ?? 0),
      Number(event?.clientY ?? 0),
      activeDimensions,
      documentRef
    );

    preview.layer.style.left = `${position.left}px`;
    preview.layer.style.top = `${position.top}px`;
    preview.layer.hidden = false;
    preview.layer.classList?.add?.("is-visible");
  };

  root.addEventListener("mouseover", (event) => {
    const target = findPreviewTarget(event.target, root);
    if (!target) {
      return;
    }

    showPreview(target, event);
  });

  root.addEventListener("mousemove", (event) => {
    const target = findPreviewTarget(event.target, root);
    if (!target) {
      hidePreview();
      return;
    }

    if (target !== activeTarget) {
      showPreview(target, event);
      return;
    }

    const dimensions =
      target === activeTarget && activeDimensions
        ? activeDimensions
        : getPreviewDimensions(target.getAttribute("data-preview-type"));
    const position = clampPreviewPosition(
      Number(event?.clientX ?? 0),
      Number(event?.clientY ?? 0),
      dimensions,
      documentRef
    );
    preview.layer.style.left = `${position.left}px`;
    preview.layer.style.top = `${position.top}px`;
  });

  root.addEventListener("mouseleave", hidePreview);
  documentRef?.defaultView?.addEventListener?.("blur", hidePreview);
}
