const DEBUGGER_LAYOUT_MAX_UNITS = 12;
const DEBUGGER_PANE_MIN_WIDTH = 360;
const DEBUGGER_STAGE_MIN_WIDTH = 220;

const debuggerLayoutDefaults = Object.freeze({
  sections: {
    game: { columns: 5 },
    debugger: { columns: 7, collapsedWidth: "3.25rem" },
  },
  cards: [
    { id: "memory-map", columns: 5, rows: 5 },
    { id: "disassembly", columns: 7, rows: 5 },
    { id: "cpu", columns: 8, rows: 2 },
    { id: "flags", columns: 4, rows: 2 },
    { id: "status", columns: 5, rows: 2 },
    { id: "ports", columns: 7, rows: 3 },
    { id: "memory-editor", columns: 7, rows: 5 },
    { id: "search", columns: 5, rows: 5 },
  ],
});

export const createDebuggerLayout = ({
  globalSettingsStorageKey,
  getEmu,
  getRunning,
  hex,
  parseNumber,
  platformSettingsStorageKey,
  readSettingsBucket,
  refs,
  removeSettingsBucketValues,
  resumeAudio,
  setStatus,
  suspendAudio,
  syncMemoryEditorOverlayBounds,
  syncMemoryMapOverlayBounds,
  syncRulesOverlayBounds,
  updateDebugger,
  writeSettingsBucket,
}) => {
  let debuggerLayoutConfig = debuggerLayoutDefaults;
  let customDebuggerCardDefs = [];
  const customDebuggerCards = new Map();
  let debuggerLayoutState = { paneCollapsed: false, paneWidth: null, cards: {} };
  let debuggerPaneResizeDrag = null;

  const clampLayoutUnit = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(DEBUGGER_LAYOUT_MAX_UNITS, parsed));
  };

  const cssLengthOr = (value, fallback) => {
    const text = String(value ?? "").trim();
    if (text === "") return fallback;
    return /^\d*\.?\d+(?:px|rem|em|vw|vh|%)$/.test(text) ? text : fallback;
  };

  const normalizeDebuggerPaneWidth = (value) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(parsed);
  };

  const debuggerPaneViewportWidth = () => refs["app-shell"]?.clientWidth || window.innerWidth || 0;

  const clampDebuggerPaneWidth = (value) => {
    const parsed = normalizeDebuggerPaneWidth(value) ?? DEBUGGER_PANE_MIN_WIDTH;
    const max = Math.max(DEBUGGER_PANE_MIN_WIDTH, debuggerPaneViewportWidth() - DEBUGGER_STAGE_MIN_WIDTH);
    return Math.max(DEBUGGER_PANE_MIN_WIDTH, Math.min(max, parsed));
  };

  const defaultDebuggerPaneWidth = () => {
    const gameColumns = debuggerLayoutConfig?.sections?.game?.columns ?? debuggerLayoutDefaults.sections.game.columns;
    const debuggerColumns = debuggerLayoutConfig?.sections?.debugger?.columns ?? debuggerLayoutDefaults.sections.debugger.columns;
    const totalColumns = Math.max(1, gameColumns + debuggerColumns);
    return clampDebuggerPaneWidth(debuggerPaneViewportWidth() * (debuggerColumns / totalColumns));
  };

  const resolvedDebuggerPaneWidth = () => clampDebuggerPaneWidth(normalizeDebuggerPaneWidth(debuggerLayoutState.paneWidth) ?? defaultDebuggerPaneWidth());

  const debuggerCardTitleFromId = (id) => String(id || "card")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  const normalizeCustomDebuggerCardDefs = (cards = []) => {
    if (!Array.isArray(cards)) return [];
    const reserved = new Set(debuggerLayoutDefaults.cards.map((card) => card.id));
    const seen = new Set();
    const defs = [];
    for (const rawCard of cards) {
      const id = String(rawCard?.id ?? "").trim();
      const module = String(rawCard?.module ?? rawCard?.source ?? "").trim();
      if (!id || !module || reserved.has(id) || seen.has(id)) continue;
      defs.push({
        id,
        module,
        custom: true,
        title: String(rawCard?.title ?? debuggerCardTitleFromId(id)),
        columns: clampLayoutUnit(rawCard?.columns ?? rawCard?.column ?? rawCard?.width, 4),
        rows: clampLayoutUnit(rawCard?.rows ?? rawCard?.row ?? rawCard?.height, 3),
      });
      seen.add(id);
    }
    return defs;
  };

  const customDebuggerFallbackCards = () => customDebuggerCardDefs.map((card) => ({
    id: card.id,
    title: card.title,
    module: card.module,
    custom: true,
    columns: card.columns,
    rows: card.rows,
  }));

  const debuggerFallbackCards = () => [...debuggerLayoutDefaults.cards, ...customDebuggerFallbackCards()];

  const normalizeDebuggerLayoutConfig = (layout = {}) => {
    let source = {};
    if (layout != null) {
      if (typeof layout === "object") source = layout;
    }
    const sourceSections = source.sections ?? {};
    const sourceGame = sourceSections.game ?? source.game ?? {};
    const sourceDebugger = sourceSections.debugger ?? source.debugger ?? {};
    const fallbackCards = debuggerFallbackCards();
    const fallbackCardsById = new Map(fallbackCards.map((card) => [card.id, card]));
    const configuredCards = Array.isArray(source.cards) ? source.cards : fallbackCards;
    const seen = new Set();
    const cards = [];

    for (const rawCard of configuredCards) {
      const id = String(rawCard?.id ?? "").trim();
      if (!fallbackCardsById.has(id)) continue;
      if (seen.has(id)) continue;
      const fallback = fallbackCardsById.get(id);
      cards.push({
        id,
        custom: Boolean(fallback.custom),
        module: fallback.module,
        title: String(rawCard?.title ?? fallback.title ?? debuggerCardTitleFromId(id)),
        columns: clampLayoutUnit(rawCard.columns ?? rawCard.column ?? rawCard.width, fallback.columns),
        rows: clampLayoutUnit(rawCard.rows ?? rawCard.row ?? rawCard.height, fallback.rows),
      });
      seen.add(id);
    }

    for (const fallback of fallbackCards) {
      if (seen.has(fallback.id)) continue;
      cards.push({ ...fallback, title: fallback.title ?? debuggerCardTitleFromId(fallback.id) });
    }

    return {
      sections: {
        game: { columns: clampLayoutUnit(sourceGame.columns ?? sourceGame.column ?? sourceGame.width, debuggerLayoutDefaults.sections.game.columns) },
        debugger: {
          columns: clampLayoutUnit(sourceDebugger.columns ?? sourceDebugger.column ?? sourceDebugger.width, debuggerLayoutDefaults.sections.debugger.columns),
          collapsedWidth: cssLengthOr(sourceDebugger.collapsedWidth, debuggerLayoutDefaults.sections.debugger.collapsedWidth),
        },
      },
      cards,
    };
  };

  const normalizeDebuggerLayoutState = (state = {}) => {
    const cards = {};
    for (const card of debuggerLayoutConfig.cards) {
      const stored = state.cards?.[card.id];
      cards[card.id] = { collapsed: Boolean(stored?.collapsed) };
    }
    return { paneCollapsed: Boolean(state.paneCollapsed), paneWidth: normalizeDebuggerPaneWidth(state.paneWidth), cards };
  };

  const saveDebuggerLayoutState = () => {
    if (!getEmu()) return;
    try {
      writeSettingsBucket(globalSettingsStorageKey, {
        debuggerPane: {
          collapsed: Boolean(debuggerLayoutState.paneCollapsed),
          width: normalizeDebuggerPaneWidth(debuggerLayoutState.paneWidth),
        },
      });
      writeSettingsBucket(platformSettingsStorageKey(), { debuggerCards: debuggerLayoutState.cards ?? {} });
    } catch (error) {
      console.warn("Failed to save debugger layout state", error);
    }
  };

  const loadDebuggerLayoutState = () => {
    const globalSettings = readSettingsBucket(globalSettingsStorageKey);
    const platformSettings = readSettingsBucket(platformSettingsStorageKey());
    const pane = globalSettings.debuggerPane ?? {};
    debuggerLayoutState = normalizeDebuggerLayoutState({
      paneCollapsed: pane.collapsed ?? pane.paneCollapsed,
      paneWidth: pane.width ?? pane.paneWidth,
      cards: platformSettings.debuggerCards ?? {},
    });
  };

  const debuggerCardTitle = (id) => debuggerLayoutConfig.cards.find((card) => card.id === id)?.title ?? debuggerCardTitleFromId(id);

  const debuggerCardNodes = () => {
    const grid = refs["debugger-card-grid"];
    if (!grid) return new Map();
    return new Map(Array.from(grid.querySelectorAll("[data-debugger-card]")).map((node) => [node.dataset.debuggerCard, node]));
  };

  const createCustomDebuggerCardNodes = () => {
    const grid = refs["debugger-card-grid"];
    if (!grid) return;
    const nodes = debuggerCardNodes();
    for (const def of customDebuggerCardDefs) {
      if (nodes.has(def.id)) continue;
      const panel = document.createElement("div");
      panel.className = "panel platform-panel";
      panel.dataset.debuggerCard = def.id;
      panel.dataset.debuggerCardCustom = "true";

      const heading = document.createElement("h2");
      heading.textContent = def.title;
      const placeholder = document.createElement("div");
      placeholder.className = "platform-card-message";
      panel.append(heading, placeholder);
      grid.appendChild(panel);
    }
  };

  const ensureDebuggerCardTitleRow = (card) => {
    let titleRow = card.querySelector(":scope > .panel-title-row");
    let heading = titleRow?.querySelector("h2") ?? card.querySelector(":scope > h2");
    if (!heading) {
      heading = document.createElement("h2");
      heading.textContent = debuggerCardTitle(card.dataset.debuggerCard ?? "card");
    }
    if (!titleRow) {
      titleRow = document.createElement("div");
      titleRow.className = "panel-title-row";
      titleRow.appendChild(heading);
      card.insertBefore(titleRow, card.firstChild);
    }
    let actions = titleRow.querySelector(":scope > .panel-title-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "panel-title-actions";
      titleRow.appendChild(actions);
    }
    return { titleRow, heading, actions };
  };

  const ensureDebuggerCardContent = (card, titleRow) => {
    if (card.querySelector(":scope > .panel-content")) return;
    const content = document.createElement("div");
    content.className = "panel-content";
    for (const child of Array.from(card.childNodes)) {
      if (child !== titleRow) content.appendChild(child);
    }
    card.appendChild(content);
  };

  const prepareDebuggerCards = () => {
    for (const card of debuggerCardNodes().values()) {
      if (card.dataset.debuggerLayoutPrepared === "true") continue;
      const { titleRow, heading } = ensureDebuggerCardTitleRow(card);
      ensureDebuggerCardContent(card, titleRow);
      const button = document.createElement("button");
      button.className = "button button-ghost button-small debugger-layout-button panel-collapse-button";
      button.type = "button";
      button.dataset.debuggerCardToggle = card.dataset.debuggerCard;
      button.addEventListener("click", () => toggleDebuggerCard(card.dataset.debuggerCard));
      titleRow.insertBefore(button, heading);
      card.dataset.debuggerLayoutPrepared = "true";
    }
  };

  const closeDebuggerLayoutOverlays = () => {
    for (const modalId of ["map-modal", "editor-modal", "rules-modal"]) {
      if (refs[modalId]) refs[modalId].hidden = true;
    }
  };

  const debuggerLayoutHeightMetrics = (grid) => {
    const style = getComputedStyle(grid);
    const rowGap = Number.parseFloat(style.rowGap) || 0;
    const rowUnit = Math.max(0, (grid.clientHeight - (rowGap * (DEBUGGER_LAYOUT_MAX_UNITS - 1))) / DEBUGGER_LAYOUT_MAX_UNITS);
    return { rowGap, rowUnit };
  };

  const debuggerCardMinHeight = (metrics, rows) => {
    const rowCount = clampLayoutUnit(rows, 1);
    return Math.max(0, (metrics.rowUnit * rowCount) + (metrics.rowGap * Math.max(0, rowCount - 1))) + "px";
  };

  const gameDisplayAspectRatio = () => {
    const emu = getEmu();
    const width = Number(refs.screen?.width) || Number(emu?.manifest?.video?.width) || 224;
    const height = Number(refs.screen?.height) || Number(emu?.manifest?.video?.height) || 256;
    return width > 0 && height > 0 ? width / height : 224 / 256;
  };

  const resizeGameDisplay = () => {
    const wrap = refs["screen-wrap"] ?? refs.screen?.parentElement;
    const stage = refs["play-zone"];
    if (!wrap || !stage) return;

    const aspect = gameDisplayAspectRatio();
    const style = getComputedStyle(stage);
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(style.paddingRight) || 0;
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
    const rowGap = Number.parseFloat(style.rowGap) || Number.parseFloat(style.gap) || 0;
    const availableWidth = Math.max(1, stage.clientWidth - paddingLeft - paddingRight);
    let heightLimitedWidth = Number.POSITIVE_INFINITY;

    if (!window.matchMedia("(max-width: 1180px)").matches) {
      const fixedRows = [
        stage.querySelector(":scope > .toolbar"),
        refs["input-buttons"],
        stage.querySelector(":scope > .stage-bottom-controls"),
      ].filter((node) => node && node.hidden !== true && getComputedStyle(node).display !== "none");
      const fixedHeight = fixedRows.reduce((sum, node) => sum + node.getBoundingClientRect().height, 0);
      const visibleRowCount = fixedRows.length + 1;
      const availableHeight = stage.clientHeight
        - paddingTop
        - paddingBottom
        - fixedHeight
        - (rowGap * Math.max(0, visibleRowCount - 1));
      if (Number.isFinite(availableHeight) && availableHeight > 1) heightLimitedWidth = availableHeight * aspect;
    }

    const width = Math.max(1, Math.floor(Math.min(availableWidth, heightLimitedWidth)));
    const height = Math.max(1, Math.floor(width / aspect));
    wrap.style.width = width + "px";
    wrap.style.height = height + "px";
    wrap.style.aspectRatio = (Number(refs.screen?.width) || 224) + " / " + (Number(refs.screen?.height) || 256);
  };

  const applyDebuggerLayout = () => {
    const app = refs["app-shell"];
    const grid = refs["debugger-card-grid"];
    if (!grid) return;
    const gameColumns = debuggerLayoutConfig.sections.game.columns;
    const debuggerColumns = debuggerLayoutConfig.sections.debugger.columns;
    if (app) {
      app.style.setProperty("--stage-min-width", String(DEBUGGER_STAGE_MIN_WIDTH) + "px");
      app.style.setProperty("--debugger-pane-min-width", String(DEBUGGER_PANE_MIN_WIDTH) + "px");
      app.style.setProperty("--game-pane-size", String(gameColumns) + "fr");
      app.style.setProperty("--debugger-pane-size", String(debuggerColumns) + "fr");
      app.style.setProperty("--debugger-pane-width", resolvedDebuggerPaneWidth() + "px");
      app.style.setProperty("--debugger-pane-collapsed-size", debuggerLayoutConfig.sections.debugger.collapsedWidth);
      app.classList.toggle("debugger-pane-collapsed", debuggerLayoutState.paneCollapsed);
      app.classList.toggle("debugger-pane-resizing", Boolean(debuggerPaneResizeDrag));
    }

    const paneButton = refs["btn-debugger-pane-toggle"];
    if (paneButton) {
      const expanded = !debuggerLayoutState.paneCollapsed;
      paneButton.textContent = expanded ? ">" : "<";
      paneButton.setAttribute("aria-expanded", String(expanded));
      paneButton.setAttribute("aria-label", expanded ? "Collapse debugger pane" : "Expand debugger pane");
      paneButton.title = expanded ? "Collapse debugger pane" : "Expand debugger pane";
    }

    const resizeHandle = refs["debugger-pane-resize-handle"];
    if (resizeHandle) resizeHandle.hidden = debuggerLayoutState.paneCollapsed;

    const nodes = debuggerCardNodes();
    const metrics = debuggerLayoutHeightMetrics(grid);
    debuggerLayoutConfig.cards.forEach((card, index) => {
      const node = nodes.get(card.id);
      if (!node) return;
      const collapsed = Boolean(debuggerLayoutState.cards?.[card.id]?.collapsed);
      grid.appendChild(node);
      node.classList.toggle("panel-collapsed", collapsed);
      node.style.order = String(index);
      node.style.gridColumn = "span " + String(card.columns);
      node.style.gridRow = "";
      node.style.minHeight = collapsed ? "" : debuggerCardMinHeight(metrics, card.rows);
      const button = node.querySelector("[data-debugger-card-toggle]");
      if (button) {
        button.textContent = collapsed ? "+" : "-";
        button.setAttribute("aria-expanded", String(!collapsed));
        button.setAttribute("aria-label", (collapsed ? "Expand " : "Collapse ") + debuggerCardTitle(card.id));
        button.title = (collapsed ? "Expand " : "Collapse ") + debuggerCardTitle(card.id);
      }
    });

    resizeGameDisplay();
    syncMemoryMapOverlayBounds();
    syncMemoryEditorOverlayBounds();
    syncRulesOverlayBounds();
  };

  const toggleDebuggerCard = (cardId) => {
    if (!cardId) return;
    const next = normalizeDebuggerLayoutState(debuggerLayoutState);
    const card = next.cards[cardId] ?? { collapsed: false };
    card.collapsed = !card.collapsed;
    next.cards[cardId] = card;
    debuggerLayoutState = next;
    applyDebuggerLayout();
    saveDebuggerLayoutState();
  };

  const toggleDebuggerPane = () => {
    debuggerLayoutState = normalizeDebuggerLayoutState(debuggerLayoutState);
    debuggerLayoutState.paneCollapsed = !debuggerLayoutState.paneCollapsed;
    if (debuggerLayoutState.paneCollapsed) closeDebuggerLayoutOverlays();
    applyDebuggerLayout();
    saveDebuggerLayoutState();
  };

  const pointerDebuggerPaneWidth = (event) => {
    const rect = refs["app-shell"]?.getBoundingClientRect();
    return rect ? rect.right - event.clientX : null;
  };

  const setDebuggerPaneWidth = (width) => {
    debuggerLayoutState = normalizeDebuggerLayoutState(debuggerLayoutState);
    debuggerLayoutState.paneWidth = clampDebuggerPaneWidth(width);
    applyDebuggerLayout();
  };

  const updateDebuggerPaneResize = (event) => {
    if (!debuggerPaneResizeDrag || event.pointerId !== debuggerPaneResizeDrag.pointerId) return;
    const width = pointerDebuggerPaneWidth(event);
    if (width == null) return;
    event.preventDefault();
    setDebuggerPaneWidth(width);
  };

  const startDebuggerPaneResize = (event) => {
    if (debuggerLayoutState.paneCollapsed) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    debuggerPaneResizeDrag = { pointerId: event.pointerId };
    document.body.classList.add("debugger-pane-resizing");
    refs["app-shell"]?.classList.add("debugger-pane-resizing");
    refs["debugger-pane-resize-handle"]?.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    updateDebuggerPaneResize(event);
  };

  const finishDebuggerPaneResize = (event) => {
    if (!debuggerPaneResizeDrag || event.pointerId !== debuggerPaneResizeDrag.pointerId) return;
    if (event.type === "pointerup") updateDebuggerPaneResize(event);
    const handle = refs["debugger-pane-resize-handle"];
    if (handle?.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    debuggerPaneResizeDrag = null;
    document.body.classList.remove("debugger-pane-resizing");
    refs["app-shell"]?.classList.remove("debugger-pane-resizing");
    event.preventDefault();
    applyDebuggerLayout();
    saveDebuggerLayoutState();
  };

  const bindDebuggerPaneResize = () => {
    const handle = refs["debugger-pane-resize-handle"];
    if (!handle || handle.dataset.resizeBound === "true") return;
    handle.dataset.resizeBound = "true";
    handle.addEventListener("pointerdown", startDebuggerPaneResize);
    window.addEventListener("pointermove", updateDebuggerPaneResize);
    window.addEventListener("pointerup", finishDebuggerPaneResize);
    window.addEventListener("pointercancel", finishDebuggerPaneResize);
  };

  const resetDebuggerLayoutState = () => {
    debuggerLayoutState = normalizeDebuggerLayoutState();
    try {
      removeSettingsBucketValues(globalSettingsStorageKey, ["debuggerPane"]);
      removeSettingsBucketValues(platformSettingsStorageKey(), ["debuggerCards"]);
    } catch (error) {
      console.warn("Failed to reset debugger layout state", error);
    }
    applyDebuggerLayout();
  };

  const customDebuggerCardHost = () => ({
    refs,
    hex,
    parseNumber,
    setStatus,
    resumeAudio,
    suspendAudio,
    get running() { return getRunning(); },
    isRunning: () => getRunning(),
    requestUpdate: (force = true) => updateDebugger(Boolean(force)),
  });

  const mountCustomDebuggerCards = async () => {
    const emu = getEmu();
    customDebuggerCards.clear();
    const nodes = debuggerCardNodes();
    for (const def of customDebuggerCardDefs) {
      const node = nodes.get(def.id);
      const container = node?.querySelector(":scope > .panel-content");
      if (!node || !container) continue;
      const host = customDebuggerCardHost();
      const context = { card: def, node, container, emu, host };
      try {
        const moduleUrl = new URL(def.module, emu.baseURL).href;
        const mod = await import(moduleUrl);
        const exported = mod.default ?? mod.createDebuggerCard ?? mod.card ?? mod;
        const instance = typeof exported === "function" ? await exported(context) : exported;
        await instance?.mount?.(context);
        customDebuggerCards.set(def.id, { def, node, container, instance });
      } catch (error) {
        console.error("Failed to load custom debugger card", def.id, error);
        container.replaceChildren();
        const message = document.createElement("pre");
        message.className = "error";
        message.textContent = error.stack || error.message || String(error);
        container.appendChild(message);
      }
    }
  };

  const updateCustomDebuggerCards = (payload) => {
    const emu = getEmu();
    for (const entry of customDebuggerCards.values()) {
      try {
        entry.instance?.update?.({ ...payload, card: entry.def, node: entry.node, container: entry.container, emu, host: customDebuggerCardHost() });
      } catch (error) {
        console.error("Failed to update custom debugger card", entry.def.id, error);
      }
    }
  };

  const initializeDebuggerLayout = async () => {
    const emu = getEmu();
    customDebuggerCardDefs = normalizeCustomDebuggerCardDefs(emu?.manifest?.debuggerCards);
    createCustomDebuggerCardNodes();
    debuggerLayoutConfig = normalizeDebuggerLayoutConfig(emu?.manifest?.debuggerLayout);
    prepareDebuggerCards();
    await mountCustomDebuggerCards();
    loadDebuggerLayoutState();
    applyDebuggerLayout();
    refs["btn-debugger-pane-toggle"]?.addEventListener("click", toggleDebuggerPane);
    bindDebuggerPaneResize();
  };

  return {
    applyDebuggerLayout,
    initializeDebuggerLayout,
    loadDebuggerLayoutState,
    resetDebuggerLayoutState,
    updateCustomDebuggerCards,
  };
};
