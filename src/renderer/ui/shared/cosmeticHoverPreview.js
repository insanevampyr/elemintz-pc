const PREVIEW_SELECTOR = "[data-hover-preview=\"true\"]";
const PREVIEW_OFFSET = 18;
const PREVIEW_MARGIN = 12;
const PREVIEW_DIMENSIONS = Object.freeze({
  avatar: { width: 220, height: 220 },
  cardBack: { width: 220, height: 294 },
  elementCardVariant: { width: 220, height: 294 }
});

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

  frame.appendChild(image);
  layer.appendChild(frame);
  documentRef.body.appendChild(layer);

  return { layer, frame, image };
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

function updatePreviewAppearance(preview, target) {
  const previewType = target.getAttribute("data-preview-type") ?? "cardBack";
  const previewRarity = String(target.getAttribute("data-preview-rarity") ?? "Common").toLowerCase();
  const previewSrc = target.getAttribute("data-preview-src");
  const dimensions = PREVIEW_DIMENSIONS[previewType] ?? PREVIEW_DIMENSIONS.cardBack;

  preview.frame.className = `cosmetic-hover-preview-frame ${previewType === "avatar" ? "is-avatar" : "is-card"} rarity-${previewRarity}`;
  preview.frame.style.width = `${dimensions.width}px`;
  preview.frame.style.height = `${dimensions.height}px`;
  preview.image.src = previewSrc ?? "";
  preview.image.alt = target.getAttribute("data-preview-name") ?? "";

  return dimensions;
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

  const hidePreview = () => {
    activeTarget = null;
    preview.layer.hidden = true;
    preview.layer.classList?.remove?.("is-visible");
  };

  const showPreview = (target, event) => {
    if (!target) {
      hidePreview();
      return;
    }

    activeTarget = target;
    const dimensions = updatePreviewAppearance(preview, target);
    const position = clampPreviewPosition(
      Number(event?.clientX ?? 0),
      Number(event?.clientY ?? 0),
      dimensions,
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

    const dimensions = PREVIEW_DIMENSIONS[target.getAttribute("data-preview-type")] ?? PREVIEW_DIMENSIONS.cardBack;
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
