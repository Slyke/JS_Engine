import { createEmulatorFromManifestURL } from '/emulator/create-emulator.js';
import { createWebSocketConnector } from './websocket-connector.js';
import { collectRefs, refs } from './bootstrap/dom-refs.js';
import { createDebuggerLayout } from './bootstrap/debugger-layout.js';
import { formatRomOffset, hex, parseNumber, parseOptionalOffset, toAddress, toByte } from './bootstrap/number-format.js';
import { createPlatformSwitcher, resolvePlatformSelection } from './bootstrap/platform-switcher.js';
import { createRomCatalog, romNameCollator } from './bootstrap/rom-catalog.js';
import { base64ToBytes, bytesToBase64, createStateSnapshots } from './bootstrap/state-snapshot.js';
import {
  advancedInputDefinitionsFromControls,
  advancedInputHotkeysFromControls,
  cloneHotkeyMap,
  cloneStringMap,
  hotkeyCodeOptions,
  hotkeyMatchesEvent,
  inputDefinitionsFromControls,
  inputHotkeysFromKeyboardGroups,
  keyboardGroupDefinitionsFromControls,
  labelForCode,
} from './bootstrap/input-manifest.js';

const { selectedPlatform, manifestPath, platformById } = resolvePlatformSelection();
const { populatePlatformSwitcher } = createPlatformSwitcher({ refs, selectedPlatform, platformById });
let emu;
let running = false;
let loadedFiles = [];
let screenCtx;
let screenImage;
let mapCtx;
let mapImage;
let memoryMapConfig = null;
let largeMapCtx;
let dirtyVideo = new Set();
let fullVideoRender = true;
let lastDebugUpdate = 0;
let lastAutoReadUpdate = 0;
let previousPcMarker = null;
let previousSpMarker = null;
let focusPaused = false;
let selectedMapAddress = null;
let suppressNextAutopause = false;
let watchIgnoreDepth = 0;
let findWriterAddress = null;
let lastAccessBreak = null;
let lastPcRuleHit = null;
let pcRuleId = 1;
let advancedInputsOpen = false;
let suppressDebuggerUiSave = false;
let rulesImportMode = "access";
const pcRules = [];
const breakOnRead = new Set();
const breakOnWrite = new Set();
const accessLog = [];
const activeInputs = new Set();
const activeKeyboardInputs = new Map();
const keyboardReleaseTimers = new Map();
const queuedInputTaps = [];
let pulseInputs = new Set(["coin", "start1", "start2"]);
let pulseDurations = { coin: 320, start1: 900, start2: 900 };
let keyboardReleaseDelayMs = 0;
let queuedKeyboardInput = false;
let queuedKeyboardPressMs = 160;
let queuedKeyboardGapMs = 80;
let queuedInputTimer = null;
let queuedInputActive = null;
const AUTO_READ_INTERVAL_MS = 100;
const AUTO_READ_RUNNING_BYTE_LIMIT = 0x400;
const pulseTimers = new Map();
let hotkeys = {};
let inputHotkeys = {};
let textInputMap = {};
let currentRomSource = null;
let romLoaderMode = 'catalog';
let debuggerLayout = null;
let romCatalog = null;
let stateSnapshots = null;
let websocketConnector = null;

const setRomLoaderMode = (mode) => {
  romLoaderMode = mode === 'disk' ? 'disk' : 'catalog';
  const diskMode = romLoaderMode === 'disk';
  if (refs['rom-catalog-controls']) refs['rom-catalog-controls'].hidden = diskMode;
  if (refs['rom-disk-controls']) refs['rom-disk-controls'].hidden = diskMode === false;
  if (refs['btn-rom-mode-toggle']) {
    refs['btn-rom-mode-toggle'].textContent = diskMode ? 'Show ROM List' : 'Load From Disk';
    refs['btn-rom-mode-toggle'].setAttribute('aria-pressed', String(diskMode));
  }
};

const setRomAdvancedOpen = (open) => {
  const expanded = Boolean(open);
  if (refs['rom-advanced-controls']) refs['rom-advanced-controls'].hidden = expanded === false;
  if (refs['btn-rom-advanced-toggle']) refs['btn-rom-advanced-toggle'].setAttribute('aria-expanded', String(expanded));
};

const setAdvancedInputsOpen = (open) => {
  advancedInputsOpen = Boolean(open);
  const group = refs["input-buttons"]?.querySelector?.("[data-advanced-inputs]");
  const toggle = refs["input-buttons"]?.querySelector?.("[data-advanced-input-toggle]");
  if (group) group.hidden = !advancedInputsOpen;
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(advancedInputsOpen));
    const label = toggle.querySelector("span");
    if (label) label.textContent = advancedInputsOpen ? "Advanced v" : "Advanced >";
  }
};

const createInputButton = (input, className = "button button-ghost") => {
  const button = document.createElement("button");
  button.className = className;
  button.dataset.input = input.id;
  button.type = "button";
  button.setAttribute("aria-pressed", "false");

  const label = document.createElement("span");
  label.textContent = input.label;
  const keycap = document.createElement("kbd");
  keycap.className = "keycap";
  keycap.hidden = true;
  button.append(label, keycap);
  return button;
};

const renderInputControlsFromManifest = (controls = {}) => {
  const container = refs["input-buttons"];
  if (!container) return;
  const inputs = inputDefinitionsFromControls(controls);
  const advancedInputs = advancedInputDefinitionsFromControls(controls);
  const keyboardGroups = keyboardGroupDefinitionsFromControls(controls);
  container.innerHTML = "";
  container.hidden = inputs.length === 0 && advancedInputs.length === 0 && keyboardGroups.length === 0;
  for (const group of keyboardGroups) {
    const label = document.createElement("span");
    label.className = "input-label-chip";
    label.textContent = group.label;
    container.appendChild(label);
  }
  for (const input of inputs) {
    container.appendChild(createInputButton(input));
  }
  if (advancedInputs.length) {
    const toggle = document.createElement("button");
    toggle.className = "button button-ghost advanced-input-toggle";
    toggle.type = "button";
    toggle.dataset.advancedInputToggle = "true";
    toggle.setAttribute("aria-controls", "advanced-input-buttons");
    toggle.addEventListener("click", () => setAdvancedInputsOpen(!advancedInputsOpen));
    const label = document.createElement("span");
    label.textContent = "Advanced >";
    toggle.appendChild(label);
    container.appendChild(toggle);

    const group = document.createElement("div");
    group.className = "advanced-inputs";
    group.id = "advanced-input-buttons";
    group.dataset.advancedInputs = "true";
    for (const input of advancedInputs) {
      group.appendChild(createInputButton(input, "button button-ghost button-small"));
    }
    container.appendChild(group);
    setAdvancedInputsOpen(advancedInputsOpen);
  }
};

const configureControlsFromManifest = () => {
  const controls = emu?.manifest?.controls ?? {};
  hotkeys = cloneStringMap(controls.commandHotkeys);
  inputHotkeys = {
    ...inputHotkeysFromKeyboardGroups(controls),
    ...advancedInputHotkeysFromControls(controls),
    ...cloneHotkeyMap(controls.inputHotkeys),
  };
  textInputMap = cloneStringMap(controls.textInputMap);
  advancedInputsOpen = false;
  keyboardReleaseDelayMs = Math.max(0, Number(controls.keyboardReleaseDelayMs ?? 0) || 0);
  queuedKeyboardInput = controls.keyboardInputMode === "queued" || controls.queuedKeyboardInput === true;
  queuedKeyboardPressMs = Math.max(1, Number(controls.queuedKeyboardPressMs ?? controls.keyTapDurationMs ?? 160) || 160);
  queuedKeyboardGapMs = Math.max(0, Number(controls.queuedKeyboardGapMs ?? controls.keyTapGapMs ?? 80) || 0);
  renderInputControlsFromManifest(controls);
  pulseInputs = new Set([
    ...(controls.pulseInputs ?? []),
    ...inputDefinitionsFromControls(controls).filter((input) => input.pulse).map((input) => input.id),
    ...advancedInputDefinitionsFromControls(controls).filter((input) => input.pulse).map((input) => input.id),
  ]);
  if (!pulseInputs.size) pulseInputs = new Set(["coin", "start1", "start2"]);
  pulseDurations = { coin: 320, start1: 900, start2: 900, ...(controls.pulseDurations ?? {}) };
  syncHotkeyLabels();
  syncInputKeyLabels();
};

const syncHotkeyLabels = () => {
  for (const node of document.querySelectorAll('[data-hotkey-label], [data-command-label]')) {
    const action = node.dataset.hotkeyLabel ?? node.dataset.commandLabel;
    const label = labelForCode(hotkeys[action]);
    node.textContent = label;
    node.hidden = label === '';
  }
};

const syncInputKeyLabels = () => {
  for (const button of document.querySelectorAll("[data-input]")) {
    const label = labelForCode(inputHotkeys[button.dataset.input]);
    if (label) button.dataset.key = label;
    else delete button.dataset.key;
    const keycap = button.querySelector(".keycap");
    if (keycap) {
      keycap.textContent = label;
      keycap.hidden = !label;
    }
  }
};

const hotkeyActionForEvent = (event) => Object.entries(hotkeys)
  .find(([, code]) => hotkeyCodeOptions(code).some((candidate) => hotkeyMatchesEvent(candidate, event)))?.[0] ?? null;

const textInputForKeyboardEvent = (event) => {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  const key = String(event.key ?? "");
  if (!key || key === "Dead") return null;
  return textInputMap[key] ?? textInputMap[key.toLowerCase()] ?? null;
};

const isModifierOnlyKeyboardEvent = (event) => ["Shift", "Control", "Alt", "Meta"].includes(String(event.key ?? ""));

const directInputForKeyboardEvent = (event) => Object.entries(inputHotkeys).find(([, code]) => hotkeyCodeOptions(code).some((candidate) => (
  !candidate.includes("+") && candidate === event.code
)))?.[0] ?? null;

const inputForKeyboardEvent = (event) => {
  const entries = Object.entries(inputHotkeys);
  const explicitModified = entries.find(([, code]) => hotkeyCodeOptions(code).some((candidate) => (
    candidate.includes("+") && hotkeyMatchesEvent(candidate, event)
  )));
  if (explicitModified) return explicitModified[0];

  const textInput = textInputForKeyboardEvent(event);
  if (textInput) return textInput;

  return entries.find(([, code]) => hotkeyCodeOptions(code).some((candidate) => (
    candidate.includes("+") ? hotkeyMatchesEvent(candidate, event) : candidate === event.code
  )))?.[0] ?? null;
};

const setStatus = (lines, isError = false) => {
  refs.status.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines);
  refs.status.classList.toggle('error', isError);
};

const getRawMemory = () => emu.devices.memory?.find((device) => device.raw)?.raw;

const GLOBAL_SETTINGS_STORAGE_KEY = "jsEmulator-global settings";

const storageSlug = (value, fallback = "settings") => {
  const slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || fallback;
};

const storageKey = (...parts) => ["jsEmulator", ...parts.map((part) => storageSlug(part)).filter(Boolean)].join("-");

const platformStorageIdentity = () => emu?.manifest?.storage?.platform
  ?? emu?.manifest?.storageId
  ?? selectedPlatform?.storageId
  ?? selectedPlatform?.id
  ?? emu?.manifest?.name
  ?? manifestPath;

const romPathForStorage = (value) => String(value ?? "").split(" @ ")[0];
const romPathParts = (value) => romPathForStorage(value).split(/[\/]+/).filter(Boolean);
const romPathStem = (value) => {
  const filename = romPathParts(value).pop() ?? value;
  return String(filename).replace(/(\.[^.]+)+$/, "");
};

const romPathsStorageIdentity = (paths = []) => {
  const cleanPaths = paths.map(romPathForStorage).filter(Boolean);
  if (!cleanPaths.length) return "no_rom";
  const parentDirs = cleanPaths.map((path) => romPathParts(path).slice(0, -1).join("/"));
  if (cleanPaths.length > 1 && parentDirs.every((dir) => dir && dir === parentDirs[0])) {
    return parentDirs[0].split("/").pop() ?? parentDirs[0];
  }
  return cleanPaths.map(romPathStem).join("_");
};

const manifestRomStorageIdentity = () => emu?.manifest?.storage?.rom
  ?? emu?.manifest?.romStorageId
  ?? emu?.manifest?.gameId
  ?? romPathsStorageIdentity((emu?.manifest?.roms ?? []).map((rom) => rom.path ?? "inline"));

const currentRomStorageIdentity = () => loadedFiles.length
  ? romPathsStorageIdentity(loadedFiles)
  : manifestRomStorageIdentity();

const platformSettingsStorageKey = () => storageKey(platformStorageIdentity());
const romSettingsStorageKey = () => storageKey(platformStorageIdentity(), currentRomStorageIdentity());

const readSettingsBucket = (key) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeSettingsBucket = (key, values) => {
  const next = { ...readSettingsBucket(key), ...values };
  localStorage.setItem(key, JSON.stringify(next));
};

const removeSettingsBucketValues = (key, names) => {
  const next = readSettingsBucket(key);
  for (const name of names) delete next[name];
  if (Object.keys(next).length) localStorage.setItem(key, JSON.stringify(next));
  else localStorage.removeItem(key);
};

const loadGlobalRomLoaderState = () => {
  const globalSettings = readSettingsBucket(GLOBAL_SETTINGS_STORAGE_KEY);
  if (refs["rom-autorun"]) refs["rom-autorun"].checked = globalSettings.romAutorunOnLoad ?? true;
};

const saveGlobalRomLoaderState = () => {
  try {
    writeSettingsBucket(GLOBAL_SETTINGS_STORAGE_KEY, {
      romAutorunOnLoad: refs["rom-autorun"]?.checked !== false,
    });
  } catch (error) {
    console.warn("Failed to save global ROM loader state", error);
  }
};

const shouldAutorunOnRomLoad = () => refs["rom-autorun"]?.checked !== false;

const DEBUGGER_UI_STATE_VERSION = 3;

const platformDefaultRomOffset = () => parseOptionalOffset(
  emu?.manifest?.romLoading?.defaultOffset
    ?? emu?.manifest?.romLoading?.diskOffset
    ?? emu?.manifest?.romDefaults?.offset
    ?? emu?.manifest?.romDefaults?.diskOffset,
  0
);

const debuggerUiDefaults = Object.freeze({
  version: DEBUGGER_UI_STATE_VERSION,
  fields: {
    "mem-address": "0x2400",
    "mem-length": "0x40",
    "patch-address": "0x2400",
    "patch-value": "0x00",
    "rom-offset": "0x0000",
    "search-value": "0x00",
    "search-start": "0x0000",
    "search-end": "0x10000",
    "break-address": "0x2400",
    "mem-expanded-address": "0x2400",
    "mem-expanded-length": "0x100",
    "patch-expanded-address": "0x2400",
    "patch-expanded-value": "0x00",
    "search-expanded-value": "0x00",
    "search-expanded-start": "0x0000",
    "search-expanded-end": "0x10000",
    "break-expanded-address": "0x2400",
    "hook-register-pc-address": "0x0000",
    "hook-register-value": "0x00",
    "hook-memory-pc-address": "0x0000",
    "hook-memory-address": "0x2400",
    "hook-memory-value": "0x00",
    "websocket-rule-address": "0x2400",
    "websocket-rule-value": "",
  },
  checks: {
    "rom-reset": true,
    "mem-auto-read": false,
    "mem-auto-pause-only": false,
    "mem-expanded-auto-read": false,
    "mem-expanded-auto-pause-only": false,
    "websocket-rule-pause": false,
  },
  selects: {
    "mem-expanded-row-bytes": "16",
    "hook-register-name": "a",
    "websocket-rule-access": "write",
    "websocket-rule-endpoint": "*",
  },
  pcHelpOpen: false,
});

const debuggerUiDefaultsForPlatform = () => ({
  ...debuggerUiDefaults,
  fields: {
    ...debuggerUiDefaults.fields,
    "rom-offset": formatRomOffset(platformDefaultRomOffset()),
  },
});

const currentDebuggerUiState = () => {
  const defaults = debuggerUiDefaultsForPlatform();
  return {
    version: DEBUGGER_UI_STATE_VERSION,
    fields: Object.fromEntries(Object.keys(defaults.fields).map((id) => [id, refs[id]?.value ?? defaults.fields[id]])),
    checks: Object.fromEntries(Object.keys(defaults.checks).map((id) => [id, Boolean(refs[id]?.checked)])),
    selects: Object.fromEntries(Object.keys(defaults.selects).map((id) => [id, refs[id]?.value ?? defaults.selects[id]])),
    pcHelpOpen: refs["pc-hook-help"] ? !refs["pc-hook-help"].hidden : false,
  };
};

const saveDebuggerUiState = () => {
  if (suppressDebuggerUiSave || !emu) return;
  try {
    writeSettingsBucket(romSettingsStorageKey(), { debuggerUi: currentDebuggerUiState() });
  } catch (error) {
    console.warn("Failed to save debugger UI state", error);
  }
};

const applyDebuggerUiState = (state = debuggerUiDefaultsForPlatform()) => {
  suppressDebuggerUiSave = true;
  const defaults = debuggerUiDefaultsForPlatform();
  const fields = { ...(state.fields ?? {}) };
  const checks = { ...(state.checks ?? {}) };
  if ((state.version ?? 1) < DEBUGGER_UI_STATE_VERSION && checks["rom-reset"] === false) delete checks["rom-reset"];
  if ((state.version ?? 1) < 3 && fields["rom-offset"] === "0x0000" && platformDefaultRomOffset() !== 0) delete fields["rom-offset"];
  const next = {
    fields: { ...defaults.fields, ...fields },
    checks: { ...defaults.checks, ...checks },
    selects: { ...defaults.selects, ...(state.selects ?? {}) },
    pcHelpOpen: Boolean(state.pcHelpOpen),
  };
  for (const [id, value] of Object.entries(next.fields)) if (refs[id]) refs[id].value = value;
  for (const [id, value] of Object.entries(next.checks)) if (refs[id]) refs[id].checked = Boolean(value);
  for (const [id, value] of Object.entries(next.selects)) if (refs[id]) refs[id].value = value;
  if (refs["pc-hook-help"]) refs["pc-hook-help"].hidden = !next.pcHelpOpen;
  if (refs["btn-pc-help"]) refs["btn-pc-help"].setAttribute("aria-expanded", String(next.pcHelpOpen));
  syncAutoReadControls();
  suppressDebuggerUiSave = false;
};

const loadDebuggerUiState = () => {
  try {
    applyDebuggerUiState(readSettingsBucket(romSettingsStorageKey()).debuggerUi ?? debuggerUiDefaultsForPlatform());
  } catch {
    applyDebuggerUiState(debuggerUiDefaultsForPlatform());
  }
};

const resetDebuggerUiDefaults = () => {
  applyDebuggerUiState(debuggerUiDefaultsForPlatform());
  debuggerLayout.resetDebuggerLayoutState();
  breakOnRead.clear();
  breakOnWrite.clear();
  findWriterAddress = null;
  lastAccessBreak = null;
  lastPcRuleHit = null;
  accessLog.length = 0;
  pcRules.length = 0;
  pcRuleId = 1;
  selectedMapAddress = null;
  if (refs["search-results"]) refs["search-results"].textContent = "";
  if (refs["search-results-large"]) refs["search-results-large"].textContent = "";
  if (typeof setMapHoverAddress === "function") setMapHoverAddress(null);
  if (typeof setMapSelectedAddress === "function") setMapSelectedAddress(null);
  websocketConnector?.clearRules();
  renderAccessBreakpoints();
  renderPcRules();
  saveDebuggerUiState();
  refreshMemoryEditors();
  updateDebugger(true);
  setStatus(["Debugger reset", "Cleared debugger UI, breakpoints, watch log, PC rules, and saved defaults for " + (emu?.manifest?.name ?? manifestPath)]);
};

const bindDebuggerUiPersistence = () => {
  const ids = [
    ...Object.keys(debuggerUiDefaults.fields),
    ...Object.keys(debuggerUiDefaults.checks),
    ...Object.keys(debuggerUiDefaults.selects),
  ];
  for (const id of ids) {
    const node = refs[id];
    if (!node) continue;
    node.addEventListener("input", saveDebuggerUiState);
    node.addEventListener("change", saveDebuggerUiState);
  }
};


const withWatchIgnore = (fn) => {
  watchIgnoreDepth += 1;
  try {
    return fn();
  } finally {
    watchIgnoreDepth -= 1;
  }
};

const hasAccessWatchpoints = () => breakOnRead.size > 0 || breakOnWrite.size > 0 || findWriterAddress != null;

const parseBreakpointAddress = (mode = "compact") => toAddress(parseNumber(refs[mode === "expanded" ? "break-expanded-address" : "break-address"].value));

const formatAccessRecord = (record) => {
  const value = record.value == null ? "--" : hex(record.value, 2);
  const source = record.reason + " @ " + hex(record.address, 4) + " = " + value;
  const pc = "PC " + hex(record.pc, 4);
  const op = record.opcode == null ? "" : " OP " + hex(record.opcode, 2);
  const mnemonic = record.mnemonic ? "  " + record.mnemonic : "";
  return source + "  " + pc + op + mnemonic;
};


const accessActionOrder = ["read", "write", "writer"];

const sortedAccessActions = (actions) => [...actions].sort((a, b) => accessActionOrder.indexOf(a) - accessActionOrder.indexOf(b));

const accessRuleEntries = () => {
  const byAddress = new Map();
  const add = (address, action) => {
    const normalized = toAddress(address);
    const entry = byAddress.get(normalized) ?? { address: normalized, actions: new Set() };
    entry.actions.add(action);
    byAddress.set(normalized, entry);
  };
  for (const address of breakOnRead) add(address, "read");
  for (const address of breakOnWrite) add(address, "write");
  if (findWriterAddress != null) add(findWriterAddress, "writer");
  return [...byAddress.values()]
    .sort((a, b) => a.address - b.address)
    .map((entry) => ({ address: entry.address, actions: sortedAccessActions(entry.actions) }));
};

const clearAccessAddress = (address) => {
  const normalized = toAddress(address);
  breakOnRead.delete(normalized);
  breakOnWrite.delete(normalized);
  if (findWriterAddress === normalized) findWriterAddress = null;
  renderAccessBreakpoints();
};

const makeAccessRuleButton = (entry) => {
  const button = document.createElement("button");
  button.className = "button button-ghost";
  button.type = "button";
  button.textContent = hex(entry.address, 4) + " " + entry.actions.join("/") + " x";
  button.addEventListener("click", () => clearAccessAddress(entry.address));
  return button;
};

const renderAccessRuleList = (target, entries, mode = "full") => {
  if (!target) return;
  target.innerHTML = "";
  if (!entries.length) {
    target.textContent = "No access breakpoints";
    return;
  }
  const compactOverflow = mode === "compact" && entries.length > 3;
  const visible = compactOverflow ? entries.slice(0, 2) : entries;
  for (const entry of visible) target.appendChild(makeAccessRuleButton(entry));
  if (compactOverflow) {
    const more = document.createElement("button");
    more.className = "button button-ghost";
    more.type = "button";
    more.textContent = "+" + String(entries.length - 3) + " more...";
    more.addEventListener("click", () => openMemoryEditor());
    target.appendChild(more);
  }
};

const renderAccessBreakpoints = () => {
  const entries = accessRuleEntries();
  renderAccessRuleList(refs["breakpoint-list"], entries, "compact");
  renderAccessRuleList(refs["breakpoint-list-large"], entries, "full");
  const logText = accessLog.length ? accessLog.map(formatAccessRecord).join("\n") : "No access hits";
  if (refs["watch-log"]) refs["watch-log"].textContent = logText;
  if (refs["watch-log-large"]) refs["watch-log-large"].textContent = logText;
};
const createAccessRecord = (type, event, reason) => {
  const debug = emu.cpu.getDebugState();
  const pc = debug.lastAddress ?? debug.registers.pc;
  let mnemonic = "";
  try {
    mnemonic = withWatchIgnore(() => emu.cpu.disassemble(pc).mnemonic);
  } catch {
    mnemonic = "";
  }
  return {
    type,
    reason,
    address: event.address & 0xffff,
    value: event.value & 0xff,
    pc,
    opcode: debug.lastOpcode,
    cycles: debug.totalCycles,
    mnemonic,
  };
};

const triggerMemoryAccessBreak = (record) => {
  lastAccessBreak = record;
  accessLog.unshift(record);
  if (accessLog.length > 12) accessLog.pop();
  if (emu) emu.debugBreakRequested = true;
  setRunning(false);
  releaseAllInputs();
  setStatus(["Memory access break", formatAccessRecord(record)]);
  renderAccessBreakpoints();
};

const handleMemoryAccess = (type, event) => {
  if (watchIgnoreDepth > 0 || !hasAccessWatchpoints()) return;
  const address = event.address & 0xffff;
  const reasons = [];
  if (type === "read" && breakOnRead.has(address)) reasons.push("read");
  if (type === "write") {
    if (breakOnWrite.has(address)) reasons.push("write");
    if (findWriterAddress === address) {
      reasons.push("writer");
      findWriterAddress = null;
    }
  }
  if (!reasons.length) return;
  triggerMemoryAccessBreak(createAccessRecord(type, event, reasons.join("+")));
};

const addAccessBreakpoint = (type, mode = "compact") => {
  const address = parseBreakpointAddress(mode);
  if (type === "read") breakOnRead.add(address);
  if (type === "write") breakOnWrite.add(address);
  if (type === "writer") findWriterAddress = address;
  refs["break-address"].value = hex(address, 4);
  if (refs["break-expanded-address"]) refs["break-expanded-address"].value = hex(address, 4);
  setStatus(["Armed " + type + " watch @ " + hex(address, 4), "Run to continue until the access hits."]);
  renderAccessBreakpoints();
};


const clearAccessRules = () => {
  breakOnRead.clear();
  breakOnWrite.clear();
  findWriterAddress = null;
  lastAccessBreak = null;
  renderAccessBreakpoints();
  setStatus(["Cleared access breakpoint rules"]);
};

const clearPcRules = () => {
  pcRules.length = 0;
  pcRuleId = 1;
  lastPcRuleHit = null;
  renderPcRules();
  setStatus(["Cleared PC rules"]);
};

const clearAllBreakpointRules = () => {
  breakOnRead.clear();
  breakOnWrite.clear();
  findWriterAddress = null;
  lastAccessBreak = null;
  lastPcRuleHit = null;
  accessLog.length = 0;
  pcRules.length = 0;
  pcRuleId = 1;
  websocketConnector?.clearRules();
  renderAccessBreakpoints();
  renderPcRules();
  setStatus(["Cleared all debugger rules", "Access breakpoints, watch log, PC rules, and websocket rules are empty."]);
};

const accessRulesToJson = () => Object.fromEntries(accessRuleEntries().map((entry) => [hex(entry.address, 4), entry.actions]));

const pcRulesToJson = () => {
  const byPc = {};
  for (const rule of pcRules) {
    const key = hex(rule.pc, 4);
    byPc[key] ??= [];
    if (rule.type === "register") {
      byPc[key].push({ type: "register", register: rule.register, value: hex(rule.value, registerHexWidth(rule.register)) });
    } else {
      byPc[key].push({ type: "memory", address: hex(rule.address, 4), value: hex(rule.value, 2) });
    }
  }
  return byPc;
};

const copyJsonToClipboard = async (payload, label, fallbackMode = null) => {
  const text = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    setStatus([label + " copied", text]);
  } catch {
    openRulesImport(fallbackMode ?? (label.toLowerCase().startsWith("pc") ? "pc" : "access"));
    refs["rules-json"].value = text;
    refs["rules-json"].select();
    setStatus(["Clipboard unavailable", "JSON is selected in the import box."]);
  }
};

const accessRulesPlaceholder = () => JSON.stringify({ "0x2400": ["read"], "0x1234": ["read", "write"] }, null, 2);

const pcRulesPlaceholder = () => JSON.stringify({
  "0x0100": [
    { type: "register", register: "a", value: "0x01" },
    { type: "memory", address: "0x2400", value: "0xff" },
  ],
}, null, 2);

const websocketRulesPlaceholder = () => websocketConnector?.rulesPlaceholder?.() ?? JSON.stringify([
  { endpointId: "debug", trigger: { type: "memory", access: "write", address: "0xabcd", value: "0x03" }, pause: false },
  { endpointId: "*", trigger: { type: "memory", access: "any", address: "0xbced" }, pause: true },
], null, 2);

const openRulesImport = (mode) => {
  rulesImportMode = mode;
  const isPc = mode === "pc";
  const isWebSocket = mode === "websocket";
  refs["rules-modal-title"].textContent = isWebSocket ? "Import WebSocket Rules" : (isPc ? "Import PC Rules" : "Import Access Breakpoint Rules");
  refs["rules-json"].value = "";
  refs["rules-json"].placeholder = isWebSocket ? websocketRulesPlaceholder() : (isPc ? pcRulesPlaceholder() : accessRulesPlaceholder());
  refs["rules-modal"].hidden = false;
  syncRulesOverlayBounds();
  requestAnimationFrame(syncRulesOverlayBounds);
  refs["rules-json"].focus();
};

const closeRulesImport = () => {
  refs["rules-modal"].hidden = true;
};

const parseRuleAddress = (value) => {
  const text = String(value ?? "").trim();
  const parsed = /^0x/i.test(text) || /^[0-9a-f]+$/i.test(text)
    ? Number.parseInt(text.replace(/^0x/i, ""), 16)
    : Number.parseInt(text, 10);
  if (!Number.isFinite(parsed)) throw new Error("Invalid address: " + text);
  return toAddress(parsed);
};

const normalizeRuleActions = (value) => {
  const actions = Array.isArray(value) ? value : [value];
  return actions.map((action) => String(action).toLowerCase().trim()).filter(Boolean);
};

const importAccessRulesFromJson = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Access rules must be an object keyed by address.");
  breakOnRead.clear();
  breakOnWrite.clear();
  findWriterAddress = null;
  for (const [addressText, value] of Object.entries(payload)) {
    const address = parseRuleAddress(addressText);
    for (const action of normalizeRuleActions(value)) {
      if (action === "read") breakOnRead.add(address);
      else if (action === "write") breakOnWrite.add(address);
      else if (action === "writer") findWriterAddress = address;
      else throw new Error("Unsupported access rule action: " + action);
    }
  }
  renderAccessBreakpoints();
  setStatus(["Imported access breakpoint rules", String(accessRuleEntries().length) + " address rules loaded."]);
};

const importPcRulesFromJson = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("PC rules must be an object keyed by PC address.");
  pcRules.length = 0;
  pcRuleId = 1;
  for (const [pcText, value] of Object.entries(payload)) {
    const pc = parseRuleAddress(pcText);
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!item || typeof item !== "object") throw new Error("PC rule at " + pcText + " must be an object.");
      if (item.type === "register") {
        const register = String(item.register ?? "").toLowerCase();
        if (!register) throw new Error("PC register rule is missing register.");
        const valueNumber = registerBitWidth(register) === 16 ? toAddress(parseNumber(item.value)) : toByte(parseNumber(item.value));
        pcRules.push({ id: pcRuleId, type: "register", pc, register, value: valueNumber, hits: 0 });
        pcRuleId += 1;
      } else if (item.type === "memory") {
        pcRules.push({ id: pcRuleId, type: "memory", pc, address: parseRuleAddress(item.address), value: toByte(parseNumber(item.value)), hits: 0 });
        pcRuleId += 1;
      } else {
        throw new Error("Unsupported PC rule type: " + String(item.type));
      }
    }
  }
  renderPcRules();
  setStatus(["Imported PC rules", String(pcRules.length) + " rules loaded."]);
};

const loadRulesImport = () => {
  const text = refs["rules-json"].value.trim();
  if (!text) throw new Error("Paste JSON rules before loading.");
  const payload = JSON.parse(text);
  if (rulesImportMode === "pc") importPcRulesFromJson(payload);
  else if (rulesImportMode === "websocket") websocketConnector?.importRulesFromJson(payload);
  else importAccessRulesFromJson(payload);
  closeRulesImport();
};

const loadMemoryByte = (address, value, options = {}) => {
  if (emu.mmu.loadByte) emu.mmu.loadByte(emu, address, value, options);
  else emu.mmu.writeByte(emu, address, value);
};

const writeMemoryBytes = (bytes, offset, options = {}) => withWatchIgnore(() => {
  const start = toAddress(offset);
  if (emu.mmu.loadBytes) return emu.mmu.loadBytes(emu, start, bytes, options);
  for (let i = 0; i < bytes.length; i += 1) loadMemoryByte(start + i, bytes[i], options);
  return { start, length: bytes.length, end: toAddress(start + Math.max(0, bytes.length - 1)) };
});

const loadJsonChunks = (json, baseOffset = 0) => withWatchIgnore(() => {
  let total = 0;
  for (const chunk of json.chunks ?? []) {
    const offset = toAddress(baseOffset + parseNumber(chunk.offset ?? 0));
    for (let i = 0; i < chunk.data.length; i += 1) loadMemoryByte(offset + i, parseNumber(chunk.data[i]), chunk);
    total += chunk.data.length;
  }
  return total;
});

const refreshMemoryViews = () => {
  fullVideoRender = true;
  renderVideo();
  refreshMemoryEditors();
  updateDebugger(true);
};

const clearMemory = () => {
  for (const device of emu.devices.memory ?? []) {
    if (device.raw?.fill) device.raw.fill(0);
    device.reset?.(emu);
  }
  emu.resetMemoryInitialBytes?.();
};

const loadRomBytes = async (rom, fallbackOffset = 0) => {
  const response = await fetch(rom.path);
  if (!response.ok) throw new Error('Failed to load ' + rom.path + ' (' + response.status + ')');
  const offset = toAddress(parseNumber(rom.offset ?? fallbackOffset));
  if (String(rom.path).toLowerCase().endsWith('.json')) {
    const total = loadJsonChunks(await response.json(), offset);
    return { description: rom.path + ' @ ' + hex(offset, 4) + ' (' + total + ' bytes)', bytes: total, offset };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  writeMemoryBytes(bytes, offset, rom);
  return { description: rom.path + ' @ ' + hex(offset, 4), bytes: bytes.length, offset };
};

const loadDiskRomFile = async (file, offset) => {
  const normalizedOffset = toAddress(offset);
  if (file.name.toLowerCase().endsWith('.json')) {
    const total = loadJsonChunks(JSON.parse(await file.text()), normalizedOffset);
    return { description: file.name + ' @ ' + hex(normalizedOffset, 4) + ' (' + total + ' bytes)', bytes: total, offset: normalizedOffset };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  writeMemoryBytes(bytes, normalizedOffset);
  return { description: file.name + ' @ ' + hex(normalizedOffset, 4), bytes: bytes.length, offset: normalizedOffset };
};

const diskRomFiles = (fileList) => {
  const files = Array.from(fileList ?? []);
  return files.length > 1 ? files.sort((a, b) => romNameCollator.compare(a.name, b.name)) : files;
};

const loadPathRomSource = async (source) => {
  loadedFiles = [];
  let nextOffset = 0;
  for (const rom of source.roms ?? []) {
    const loaded = await loadRomBytes(rom, nextOffset);
    loadedFiles.push(loaded.description);
    nextOffset = toAddress(loaded.offset + loaded.bytes);
  }
  currentRomSource = source;
  fullVideoRender = true;
  return loadedFiles;
};

const loadDiskRomSource = async (source) => {
  loadedFiles = [];
  let nextOffset = toAddress(source.baseOffset ?? 0);
  for (const file of source.files ?? []) {
    const loaded = await loadDiskRomFile(file, nextOffset);
    loadedFiles.push(loaded.description);
    nextOffset = toAddress(loaded.offset + loaded.bytes);
  }
  currentRomSource = source;
  fullVideoRender = true;
  return loadedFiles;
};

const loadRoms = async (source = currentRomSource ?? romCatalog.manifestRomSource()) => {
  const resolvedSource = source ?? romCatalog.manifestRomSource();
  return resolvedSource.type === 'disk'
    ? loadDiskRomSource(resolvedSource)
    : loadPathRomSource(resolvedSource);
};

const statusRange = (start, size) => {
  const begin = Number(start ?? 0) || 0;
  const length = Number(size ?? 0) || 0;
  return hex(toAddress(begin), 4) + "-" + hex(toAddress(begin + Math.max(0, length - 1)), 4);
};

const moduleStatusLine = (label, path) => path ? label + ": " + path : null;

const memoryDeviceStatusLines = () => {
  const memory = emu?.manifest?.memory ?? {};
  const devices = Array.isArray(memory.devices) ? memory.devices : [];
  if (!devices.length) return ["Memory devices: none configured"];
  return [
    "Memory devices: " + devices.length,
    ...devices.map((device, index) => {
      const label = device.label ?? device.id ?? ("device " + index);
      const module = device.module ? " via " + device.module : "";
      return "  - " + label + " [" + (device.type ?? "memory") + "] " + statusRange(device.start, device.size) + module;
    }),
  ];
};

const ioDeviceStatusLines = () => {
  const devices = Array.isArray(emu?.manifest?.io?.devices) ? emu.manifest.io.devices : [];
  if (!devices.length) return [];
  return [
    "I/O devices: " + devices.length,
    ...devices.map((device, index) => {
      const label = device.label ?? device.id ?? ("device " + index);
      const portStart = device.portStart ?? device.start ?? 0;
      const portSize = device.portSize ?? device.size ?? 1;
      const module = device.module ? " via " + device.module : "";
      return "  - " + label + " [" + (device.type ?? "io") + "] " + statusRange(portStart, portSize) + module;
    }),
  ];
};

const websocketStatusLines = () => {
  const websocket = emu?.manifest?.websocket ?? {};
  if (!websocket.enabled) return ["WebSocket: disabled"];
  const endpoints = Array.isArray(websocket.endpoints) ? websocket.endpoints : [];
  return [
    "WebSocket: enabled, auto connect " + String(websocket.autoConnect === true),
    "WebSocket endpoints: " + endpoints.length,
    ...endpoints.map((endpoint) => "  - " + (endpoint.id ?? endpoint.label ?? "endpoint") + " -> " + (endpoint.url ?? "no url") + ", auto " + String(endpoint.autoConnect === true)),
  ];
};

const platformComponentStatusLines = () => {
  const manifest = emu?.manifest ?? {};
  const cpu = manifest.cpu ?? {};
  const memory = manifest.memory ?? {};
  const video = manifest.video ?? {};
  const audio = manifest.audio ?? {};
  return [
    "Platform: " + (manifest.name ?? selectedPlatform.label ?? selectedPlatform.id),
    "Platform id: " + (selectedPlatform.id ?? "unknown"),
    "Manifest: " + manifestPath,
    moduleStatusLine("CPU module", cpu.module),
    "CPU runtime: " + (emu?.cpu?.name ?? cpu.name ?? "unknown"),
    moduleStatusLine("ALU", cpu.alu),
    moduleStatusLine("Registers", cpu.registers),
    moduleStatusLine("Control", cpu.control),
    moduleStatusLine("Decoder", cpu.decoder),
    moduleStatusLine("MMU", memory.mmu),
    ...memoryDeviceStatusLines(),
    ...ioDeviceStatusLines(),
    video.driver ? "Video driver: " + video.driver + " " + (video.width ?? "?") + "x" + (video.height ?? "?") : null,
    moduleStatusLine("Video module", video.module),
    moduleStatusLine("Audio module", audio.module),
    ...websocketStatusLines(),
  ].filter(Boolean);
};

const romLoadStatusLines = (source, resetFirst, autorun = false) => [
  "Loaded ROM: " + (source?.label ?? "unnamed"),
  "Source: " + (source?.type ?? "manifest"),
  source?.baseOffset != null ? "Base offset: " + formatRomOffset(source.baseOffset) : null,
  loadedFiles.length ? "Files: " + loadedFiles.length : "No ROM files configured",
  ...loadedFiles.slice(0, 8),
  loadedFiles.length > 8 ? "..." : null,
  "Reset first: " + String(resetFirst),
  "Run after load: " + String(autorun),
  ...platformComponentStatusLines(),
].filter(Boolean);

const loadUserRomSource = async (source, options = {}) => {
  const resetFirst = Boolean(options.resetFirst);
  const autorun = shouldAutorunOnRomLoad();
  setRunning(false);
  releaseAllInputs();
  if (resetFirst) {
    clearMemory();
    emu.cpu.reset();
    emu.audio?.reset?.();
  }
  await loadRoms(source);
  if (resetFirst) emu.cpu.reset?.(emu);
  if (options.saveLast) romCatalog.saveLastCatalogRomSetting(source);
  const loadedSourceOffset = source?.baseOffset;
  debuggerLayout.loadDebuggerLayoutState();
  loadDebuggerUiState();
  if (loadedSourceOffset != null) romCatalog.setRomOffsetInputValue(loadedSourceOffset);
  debuggerLayout.applyDebuggerLayout();
  refreshMemoryViews();
  setStatus(romLoadStatusLines(source, resetFirst, autorun));
  if (autorun) setRunning(true);
};

const loadSelectedCatalogRom = async () => {
  await loadUserRomSource(romCatalog.selectedCatalogRomSource(), {
    resetFirst: refs['rom-reset']?.checked,
    saveLast: true,
  });
};

const loadMemoryFile = async () => {
  const files = diskRomFiles(refs['rom-file']?.files);
  if (!files.length) throw new Error('Choose one or more ROM files first');
  const source = {
    type: 'disk',
    id: 'disk',
    label: files.map((file) => file.name).join(', '),
    files,
    baseOffset: romCatalog.currentRomOffsetInputValue(platformDefaultRomOffset()),
  };
  refs['rom-file'].value = '';
  await loadUserRomSource(source, { resetFirst: refs['rom-reset']?.checked });
};

const chooseOrLoadMemoryFile = async () => {
  const input = refs['rom-file'];
  if (!diskRomFiles(input?.files).length) {
    input?.click();
    return;
  }
  await loadMemoryFile();
};

const loadStartupRoms = async () => {
  const savedSource = romCatalog.savedCatalogRomSource();
  if (savedSource && refs["rom-select"]) refs["rom-select"].value = savedSource.id;
  let loadedSource = savedSource ?? romCatalog.manifestRomSource();
  try {
    await loadRoms(loadedSource);
    setStatus(romLoadStatusLines(loadedSource, false, emu?.manifest?.runOnStart !== false));
  } catch (error) {
    if (!savedSource) throw error;
    console.warn("Failed to load saved ROM; falling back to manifest ROMs", error);
    loadedSource = romCatalog.manifestRomSource();
    await loadRoms(loadedSource);
    setStatus(["Saved ROM could not be loaded; loaded platform default", error.message || String(error), ...romLoadStatusLines(loadedSource, false, emu?.manifest?.runOnStart !== false)], true);
  }
};

const videoDimensions = () => {
  const video = emu?.manifest?.video ?? {};
  const width = Number.parseInt(video.width ?? refs.screen?.width ?? 1, 10);
  const height = Number.parseInt(video.height ?? refs.screen?.height ?? 1, 10);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1,
    height: Number.isFinite(height) && height > 0 ? height : 1,
  };
};

const clearScreenImage = () => {
  if (!screenImage) return;
  for (let i = 0; i < screenImage.data.length; i += 4) {
    screenImage.data[i] = 0;
    screenImage.data[i + 1] = 0;
    screenImage.data[i + 2] = 0;
    screenImage.data[i + 3] = 255;
  }
};

const configureScreenFromManifest = () => {
  const { width, height } = videoDimensions();
  refs.screen.width = width;
  refs.screen.height = height;
  refs["screen-wrap"].style.aspectRatio = width + " / " + height;
  refs.screen.setAttribute("aria-label", (emu.manifest.name ?? selectedPlatform.label) + " display. Click to focus keyboard controls.");
  screenCtx = refs.screen.getContext("2d");
  screenCtx.imageSmoothingEnabled = false;
  screenImage = screenCtx.createImageData(width, height);
  clearScreenImage();
  screenCtx.putImageData(screenImage, 0, 0);
};

const videoMemoryRange = () => {
  const video = emu?.manifest?.video ?? {};
  const start = Number(video.memoryStart);
  const end = Number(video.memoryEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
};

const peekMemoryByte = (address) => (
  emu.mmu.peekByte ? emu.mmu.peekByte(emu, address) : emu.mmu.readByte(emu, address)
) & 0xff;

const isSinclairZX80Video = () => emu?.manifest?.video?.driver === "sinclair-zx80-display-file";

const isVideoAddress = (address) => {
  const range = videoMemoryRange();
  return Boolean(range && address >= range.start && address < range.end);
};

const renderModuleVideo = (range) => {
  const renderer = emu?.video;
  if (!renderer) return false;

  if (typeof renderer.renderFrame === "function") {
    renderer.renderFrame({
      emu,
      screenCtx,
      imageData: screenImage,
      range,
      dirtyVideo,
      fullRender: fullVideoRender,
      clearScreenImage,
    });
    fullVideoRender = false;
    dirtyVideo.clear();
    return true;
  }

  if (typeof renderer.renderByte !== "function" || !range) return false;

  if (fullVideoRender) {
    for (let address = range.start; address < range.end; address += 1) renderer.renderByte({ emu, screenCtx, imageData: screenImage, address });
    fullVideoRender = false;
    dirtyVideo.clear();
  } else {
    for (const address of dirtyVideo) renderer.renderByte({ emu, screenCtx, imageData: screenImage, address });
    dirtyVideo.clear();
  }
  screenCtx.putImageData(screenImage, 0, 0);
  return true;
};

const readVideoWordLE = (address) => {
  const low = emu.mmu.readByte(emu, address) & 0xff;
  const high = emu.mmu.readByte(emu, (address + 1) & 0xffff) & 0xff;
  return low | (high << 8);
};

const zx80VideoColors = Object.freeze({
  paper: "#d8d8c8",
  ink: "#101010"
});

const renderSinclairZX80Glyph = (code, cellX, cellY, inverse = false) => {
  const charCode = code & 0x3f;
  const fontBase = 0x0e00 + (charCode * 8);
  const x0 = cellX * 8;
  const y0 = cellY * 8;

  for (let row = 0; row < 8; row += 1) {
    const bits = emu.mmu.readByte(emu, fontBase + row) & 0xff;
    for (let col = 0; col < 8; col += 1) {
      const on = ((bits >> (7 - col)) & 1) === 1;
      screenCtx.fillStyle = (on !== inverse) ? zx80VideoColors.ink : zx80VideoColors.paper;
      screenCtx.fillRect(x0 + col, y0 + row, 1, 1);
    }
  }
};

const renderSinclairZX80Video = () => {
  const width = emu.manifest.video.width ?? 256;
  const height = emu.manifest.video.height ?? 192;
  screenCtx.fillStyle = zx80VideoColors.paper;
  screenCtx.fillRect(0, 0, width, height);

  let address = readVideoWordLE(0x400c) & 0x7fff;
  const dfEnd = readVideoWordLE(0x4010) & 0x7fff;
  if (address < 0x4000 || address >= 0x8000) return;
  const limit = dfEnd > address && dfEnd <= 0x8000 ? dfEnd : Math.min(0x8000, address + 2048);
  let row = 0;
  let col = 0;

  for (let guard = 0; row < 24 && address < limit && guard < 2048; guard += 1) {
    const value = emu.mmu.readByte(emu, address & 0xffff) & 0xff;
    address = (address + 1) & 0xffff;

    if (value === 0x76) {
      row += 1;
      col = 0;
      continue;
    }

    if ((value & 0x40) !== 0) continue;
    if (col >= 32) {
      row += 1;
      col = 0;
      if (row >= 24) break;
    }

    renderSinclairZX80Glyph(value, col, row, (value & 0x80) !== 0);
    col += 1;
  }
};

const renderVideo = () => withWatchIgnore(() => {
  const range = videoMemoryRange();
  if (renderModuleVideo(range)) return;

  if (isSinclairZX80Video()) {
    renderSinclairZX80Video();
    fullVideoRender = false;
    dirtyVideo.clear();
    return;
  }

  if (fullVideoRender) {
    clearScreenImage();
    fullVideoRender = false;
  }
  dirtyVideo.clear();
  screenCtx.putImageData(screenImage, 0, 0);
});

const getMemorySegments = () => emu.manifest.memory?.segments ?? emu.mmu.getMemoryMap?.() ?? [];

const integerOr = (value, fallback) => {
  if (value == null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : parseNumber(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

const inferMemoryMapSize = () => {
  let maxEnd = 0;
  for (const range of [...(emu.manifest.memory?.devices ?? []), ...getMemorySegments()]) {
    const start = Math.max(0, integerOr(range.start, 0));
    const size = Math.max(0, integerOr(range.size, 0));
    const end = range.end != null ? Math.max(0, integerOr(range.end, 0) + 1) : start + size;
    maxEnd = Math.max(maxEnd, end);
  }
  return maxEnd || 0x10000;
};

const segmentForAddress = (address) => {
  const segments = getMemorySegments();
  return segments.find((segment) => {
    const start = segment.start >>> 0;
    const end = segment.end != null ? segment.end >>> 0 : (start + (segment.size >>> 0) - 1) >>> 0;
    return address >= start && address <= end;
  });
};

const rangeTypeLabel = (type) => {
  if (type === "video") return "VRAM";
  return String(type || "range").toUpperCase();
};

const legendSwatchClass = (type) => {
  if (type === "rom") return "swatch-rom";
  if (type === "ram") return "swatch-ram";
  if (type === "video") return "swatch-video";
  return "";
};

const appendLegendSwatch = (className, text) => {
  const node = document.createElement("span");
  node.className = ("swatch " + className).trim();
  node.textContent = text;
  refs["map-legend"].appendChild(node);
};

const clampColorChannel = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));

const normalizeRgb = (value, fallback = [0, 0, 0]) => {
  const base = Array.isArray(fallback) ? fallback : [0, 0, 0];
  if (Array.isArray(value) && value.length >= 3) return [clampColorChannel(value[0]), clampColorChannel(value[1]), clampColorChannel(value[2])];
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  if (match) {
    const raw = Number.parseInt(match[1], 16);
    return [(raw >> 16) & 0xff, (raw >> 8) & 0xff, raw & 0xff];
  }
  return [clampColorChannel(base[0]), clampColorChannel(base[1]), clampColorChannel(base[2])];
};

const DEFAULT_MEMORY_MAP_COLORS = Object.freeze({
  default: { zero: [0, 0, 0], active: [220, 220, 220] },
  unmapped: { zero: [0, 0, 0], active: [255, 40, 40] },
  rom: { zero: [24, 24, 20], active: [255, 78, 20] },
  ram: { zero: [0, 20, 38], active: [45, 90, 255] },
  video: { zero: [0, 50, 20], active: [32, 255, 90] },
  pc: [80, 255, 120],
  sp: [90, 170, 255],
});

const normalizeMemoryMapColorEntry = (entry, fallback) => {
  if (Array.isArray(fallback)) return normalizeRgb(entry, fallback);
  if (Array.isArray(entry) || typeof entry === "string") return { zero: normalizeRgb(null, fallback.zero), active: normalizeRgb(entry, fallback.active) };
  const source = entry && typeof entry === "object" ? entry : {};
  return {
    zero: normalizeRgb(source.zero ?? source.empty ?? source.min, fallback.zero),
    active: normalizeRgb(source.active ?? source.full ?? source.max ?? source.color, fallback.active),
  };
};

const resolveMemoryMapColors = (input = {}) => {
  const source = input && typeof input === "object" ? input : {};
  const colors = {};
  for (const [key, fallback] of Object.entries(DEFAULT_MEMORY_MAP_COLORS)) colors[key] = normalizeMemoryMapColorEntry(source[key], fallback);
  for (const [key, value] of Object.entries(source)) {
    if (colors[key]) continue;
    colors[key] = normalizeMemoryMapColorEntry(value, DEFAULT_MEMORY_MAP_COLORS.default);
  }
  return colors;
};

const memoryMapSource = () => emu?.manifest?.memory?.map ?? emu?.manifest?.debugger?.memoryMap ?? emu?.manifest?.debuggerMemoryMap ?? {};

const resolveMemoryMapConfig = () => {
  const source = memoryMapSource();
  const start = Math.max(0, integerOr(source.start, 0));
  const size = Math.max(1, integerOr(source.size ?? source.length, inferMemoryMapSize()));
  const columns = Math.max(1, Math.min(4096, integerOr(source.columns ?? source.width, 256)));
  const explicitRows = source.rows ?? source.height;
  const explicitBytes = source.bytesPerCell ?? source.cellBytes ?? source.bytes;
  let rows = Math.max(1, Math.min(4096, integerOr(explicitRows, 256)));
  let bytesPerCell = Math.max(1, integerOr(explicitBytes, 1));

  if (explicitRows == null && explicitBytes == null) {
    bytesPerCell = Math.max(1, Math.ceil(size / (columns * rows)));
  } else if (explicitRows == null) {
    rows = Math.ceil(Math.ceil(size / bytesPerCell) / columns);
  } else if (explicitBytes == null || columns * rows * bytesPerCell < size) {
    bytesPerCell = Math.max(1, Math.ceil(size / (columns * rows)));
  }

  const cellCount = Math.ceil(size / bytesPerCell);
  rows = Math.max(rows, Math.ceil(cellCount / columns));
  const valueModes = new Set(["max", "average", "first", "last", "nonzero"]);
  const valueMode = valueModes.has(source.valueMode) ? source.valueMode : "max";
  const defaultSamplesPerCell = Math.min(bytesPerCell, 8);
  const samplesPerCell = Math.max(1, Math.min(4096, integerOr(source.samplesPerCell, defaultSamplesPerCell)));
  const highestAddress = Math.max(1, start + size - 1);
  const addressWidth = Math.max(4, Math.ceil(Math.log2(highestAddress + 1) / 4));

  return {
    start,
    size,
    columns,
    rows,
    bytesPerCell,
    cellCount,
    totalCells: columns * rows,
    valueMode,
    samplesPerCell,
    addressWidth,
    colors: resolveMemoryMapColors(source.colors),
  };
};

const configureMemoryMap = () => {
  memoryMapConfig = resolveMemoryMapConfig();
  previousPcMarker = null;
  previousSpMarker = null;
  for (const id of ["memory-map", "memory-map-large"]) {
    const canvas = refs[id];
    if (!canvas) continue;
    canvas.width = memoryMapConfig.columns;
    canvas.height = memoryMapConfig.rows;
    canvas.style.aspectRatio = memoryMapConfig.columns + " / " + memoryMapConfig.rows;
  }
  mapImage = mapCtx.createImageData(memoryMapConfig.columns, memoryMapConfig.rows);
};

const mapAddressHex = (address) => hex(address, memoryMapConfig?.addressWidth ?? 4);

const cellIndexForAddress = (address) => {
  if (!memoryMapConfig) return null;
  const relative = address - memoryMapConfig.start;
  if (relative < 0 || relative >= memoryMapConfig.size) return null;
  const cell = Math.floor(relative / memoryMapConfig.bytesPerCell);
  return cell >= 0 && cell < memoryMapConfig.cellCount ? cell : null;
};

const addressForCellIndex = (cellIndex) => {
  if (!memoryMapConfig || cellIndex == null || cellIndex < 0 || cellIndex >= memoryMapConfig.cellCount) return null;
  return memoryMapConfig.start + (cellIndex * memoryMapConfig.bytesPerCell);
};

const endAddressForCellIndex = (cellIndex) => {
  const start = addressForCellIndex(cellIndex);
  if (start == null) return null;
  return Math.min(memoryMapConfig.start + memoryMapConfig.size - 1, start + memoryMapConfig.bytesPerCell - 1);
};

const aggregateMemoryCellValue = (cellIndex) => {
  const start = addressForCellIndex(cellIndex);
  const end = endAddressForCellIndex(cellIndex);
  if (start == null || end == null || end < start) return 0;
  if (memoryMapConfig.valueMode === "first") return peekMemoryByte(start);

  const byteCount = end - start + 1;
  const step = byteCount <= memoryMapConfig.samplesPerCell ? 1 : Math.ceil(byteCount / memoryMapConfig.samplesPerCell);
  let max = 0;
  let sum = 0;
  let samples = 0;
  let last = 0;
  let nonzero = false;

  const readSample = (address) => {
    const value = peekMemoryByte(address);
    max = Math.max(max, value);
    sum += value;
    samples += 1;
    last = value;
    if (value !== 0) nonzero = true;
  };

  for (let offset = 0; offset < byteCount; offset += step) readSample(start + offset);
  if ((end - start) % step !== 0) readSample(end);

  if (memoryMapConfig.valueMode === "average") return samples ? Math.round(sum / samples) : 0;
  if (memoryMapConfig.valueMode === "last") return last;
  if (memoryMapConfig.valueMode === "nonzero") return nonzero ? Math.max(max, 1) : 0;
  return max;
};

const mixRgb = (zero, active, amount) => [
  clampColorChannel(zero[0] + ((active[0] - zero[0]) * amount)),
  clampColorChannel(zero[1] + ((active[1] - zero[1]) * amount)),
  clampColorChannel(zero[2] + ((active[2] - zero[2]) * amount)),
];

const colorForMapValue = (entry, value) => {
  const palette = entry?.zero && entry?.active ? entry : DEFAULT_MEMORY_MAP_COLORS.default;
  const amount = value > 0 ? Math.max(value / 255, 0.18) : 0;
  return mixRgb(palette.zero, palette.active, amount);
};

const colorForAddress = (address, value) => {
  const segment = segmentForAddress(address);
  const type = segment?.type ?? "unmapped";
  const palette = memoryMapConfig?.colors?.[type] ?? memoryMapConfig?.colors?.default ?? DEFAULT_MEMORY_MAP_COLORS.default;
  return colorForMapValue(palette, value);
};

const setMapPixel = (cellIndex, rgb) => {
  if (!mapImage || cellIndex == null || cellIndex < 0 || cellIndex >= memoryMapConfig.totalCells) return;
  const index = cellIndex * 4;
  mapImage.data[index] = rgb[0];
  mapImage.data[index + 1] = rgb[1];
  mapImage.data[index + 2] = rgb[2];
  mapImage.data[index + 3] = 255;
};

const renderMemoryLegend = () => {
  if (!refs["map-legend"] || !emu) return;
  refs["map-legend"].innerHTML = "";
  for (const segment of getMemorySegments()) {
    const start = segment.start >>> 0;
    const size = segment.size >>> 0;
    const end = segment.end != null ? segment.end >>> 0 : (start + Math.max(1, size) - 1) >>> 0;
    const typeLabel = rangeTypeLabel(segment.type);
    const label = segment.label || typeLabel;
    appendLegendSwatch(legendSwatchClass(segment.type), label + " " + mapAddressHex(start) + "-" + mapAddressHex(end));
  }
  if ((memoryMapConfig?.bytesPerCell ?? 1) > 1) appendLegendSwatch("", String(memoryMapConfig.bytesPerCell) + "B/cell");
  appendLegendSwatch("swatch-pc", "PC");
  appendLegendSwatch("swatch-sp", "SP");
};

const renderMemoryMap = (debug = emu.cpu.getDebugState()) => withWatchIgnore(() => {
  if (!memoryMapConfig || !mapImage) return;
  for (let cell = 0; cell < memoryMapConfig.totalCells; cell += 1) {
    if (cell >= memoryMapConfig.cellCount) {
      setMapPixel(cell, [0, 0, 0]);
      continue;
    }
    const address = addressForCellIndex(cell);
    const value = aggregateMemoryCellValue(cell);
    setMapPixel(cell, colorForAddress(address, value));
  }

  const pcCell = cellIndexForAddress(debug.registers.pc >>> 0);
  const spCell = cellIndexForAddress(debug.registers.sp >>> 0);
  if (pcCell != null) setMapPixel(pcCell, memoryMapConfig.colors.pc);
  if (spCell != null) setMapPixel(spCell, memoryMapConfig.colors.sp);
  previousPcMarker = pcCell;
  previousSpMarker = spCell;
  mapCtx.putImageData(mapImage, 0, 0);
  if (!refs["map-modal"]?.hidden) syncLargeMemoryMap();
});

const syncLargeMemoryMap = () => {
  if (largeMapCtx && mapImage) largeMapCtx.putImageData(mapImage, 0, 0);
  resizeLargeMemoryMapCanvas();
  if (selectedMapAddress != null) setMapSelectedAddress(selectedMapAddress);
};

const resizeLargeMemoryMapCanvas = () => {
  const frame = refs["memory-map-large-frame"];
  const canvas = refs["memory-map-large"];
  if (!frame || !canvas || refs["map-modal"]?.hidden) return;
  const columns = memoryMapConfig?.columns ?? canvas.width;
  const rows = memoryMapConfig?.rows ?? canvas.height;
  const scale = Math.min(frame.clientWidth / columns, frame.clientHeight / rows);
  if (scale <= 0) return;
  canvas.style.width = Math.max(1, Math.floor(columns * scale)) + "px";
  canvas.style.height = Math.max(1, Math.floor(rows * scale)) + "px";
};

const syncDebuggerOverlayBounds = (modal) => {
  const pane = refs["debugger-pane"];
  if (!pane || !modal || modal.hidden) return;
  const rect = pane.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  modal.style.left = left + "px";
  modal.style.top = top + "px";
  modal.style.width = Math.max(0, right - left) + "px";
  modal.style.height = Math.max(0, bottom - top) + "px";
};

const syncMemoryMapOverlayBounds = () => {
  syncDebuggerOverlayBounds(refs["map-modal"]);
  resizeLargeMemoryMapCanvas();
};

const syncHexDumpVerticalOverflow = (node) => {
  if (!node) return;
  requestAnimationFrame(() => {
    if (!node.isConnected) return;
    const style = getComputedStyle(node);
    const borderY = (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
    const lineHeight = Number.parseFloat(style.lineHeight) || 16;
    const horizontalScrollbarHeight = node.scrollWidth > node.clientWidth
      ? Math.max(0, node.offsetHeight - node.clientHeight - borderY)
      : 0;
    const tolerance = Math.max(lineHeight, horizontalScrollbarHeight + lineHeight);
    node.classList.toggle("hex-dump-y-overflow", node.scrollHeight > node.clientHeight + tolerance);
  });
};

const syncMemoryEditorOverlayBounds = () => {
  syncDebuggerOverlayBounds(refs["editor-modal"]);
  syncHexDumpVerticalOverflow(refs["hex-dump-large"]);
};
const syncRulesOverlayBounds = () => syncDebuggerOverlayBounds(refs["rules-modal"]);

const addressFromMapEvent = (event) => {
  if (!memoryMapConfig) return null;
  const rect = refs["memory-map-large"].getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = Math.max(0, Math.min(memoryMapConfig.columns - 1, Math.floor(((event.clientX - rect.left) / rect.width) * memoryMapConfig.columns)));
  const y = Math.max(0, Math.min(memoryMapConfig.rows - 1, Math.floor(((event.clientY - rect.top) / rect.height) * memoryMapConfig.rows)));
  const cell = (y * memoryMapConfig.columns) + x;
  return cell < memoryMapConfig.cellCount ? addressForCellIndex(cell) : null;
};

const describeMapAddress = (address) => {
  if (address == null) return "-";
  const cell = cellIndexForAddress(address);
  if (cell == null) return mapAddressHex(address) + " unmapped";
  const start = addressForCellIndex(cell);
  const end = endAddressForCellIndex(cell);
  const value = withWatchIgnore(() => aggregateMemoryCellValue(cell));
  const segment = segmentForAddress(start);
  const label = segment?.label ?? segment?.type ?? "unmapped";
  const range = end > start ? mapAddressHex(start) + "-" + mapAddressHex(end) : mapAddressHex(start);
  return range + " = " + hex(value, 2) + " " + label;
};

const setMapHoverAddress = (address) => {
  refs["map-hover-readout"].textContent = describeMapAddress(address);
};

const setMapSelectedAddress = (address) => {
  selectedMapAddress = address;
  refs["map-selected-readout"].textContent = describeMapAddress(address);
  refs["btn-map-preload"].disabled = address == null;
};

const pauseForOverlayButton = () => {
  if (!refs["autopause"]?.checked || !running) return;
  focusPaused = true;
  setRunning(false);
  releaseAllInputs();
  updateDebugger(true);
};

const preloadSelectedMapAddress = () => {
  pauseForOverlayButton();
  if (selectedMapAddress == null) return;
  preloadMemoryAddress(selectedMapAddress);
};

const openMemoryMap = () => {
  suppressNextAutopause = true;
  if (refs["editor-modal"]) refs["editor-modal"].hidden = true;
  if (refs["rules-modal"]) refs["rules-modal"].hidden = true;
  refs["map-modal"].hidden = false;
  setMapHoverAddress(null);
  renderMemoryLegend();
  syncMemoryMapOverlayBounds();
  syncLargeMemoryMap();
  requestAnimationFrame(syncMemoryMapOverlayBounds);
  refs.screen.focus({ preventScroll: true });
  setTimeout(() => { suppressNextAutopause = false; }, 0);
};

const closeMemoryMap = () => {
  refs["map-modal"].hidden = true;
  setMapHoverAddress(null);
};

const openMemoryEditor = () => {
  suppressNextAutopause = true;
  refs["map-modal"].hidden = true;
  if (refs["rules-modal"]) refs["rules-modal"].hidden = true;
  refs["editor-modal"].hidden = false;
  syncCpuRegisterOptions();
  syncAutoReadControls();
  readMemoryEditor("expanded");
  renderAccessBreakpoints();
  renderPcRules();
  websocketConnector?.renderControls?.();
  syncMemoryEditorOverlayBounds();
  requestAnimationFrame(syncMemoryEditorOverlayBounds);
  refs.screen.focus({ preventScroll: true });
  setTimeout(() => { suppressNextAutopause = false; }, 0);
};

const closeMemoryEditor = () => {
  saveDebuggerUiState();
  refs["editor-modal"].hidden = true;
  if (refs["rules-modal"]) refs["rules-modal"].hidden = true;
};

const kv = (name, value, className = '') => '<div class=\'kv ' + className + '\'><b>' + name + '</b>' + value + '</div>';

const registerBitWidth = (name) => emu?.cpu?.registerDefs?.find?.((def) => def.name === String(name).toLowerCase())?.bits ?? ((name === 'pc' || name === 'sp') ? 16 : 8);
const registerHexWidth = (name) => registerBitWidth(name) === 16 ? 4 : 2;
const editableRegisterNames = ['pc', 'sp', 'a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'];
const canEditCpuState = () => !running && typeof emu?.cpu?.setRegister === 'function';

const setCpuRegisterValue = (register, value) => {
  if (typeof emu?.cpu?.setRegister !== 'function') throw new Error('This CPU does not support register edits');
  const name = String(register).toLowerCase();
  const next = registerBitWidth(name) === 16 ? toAddress(value) : toByte(value);
  emu.cpu.setRegister(emu, name, next);
};

const appendRegisterInput = (name, value) => {
  const node = document.createElement('div');
  node.className = 'kv kv-edit';
  const label = document.createElement('b');
  label.textContent = name.toUpperCase();
  const input = document.createElement('input');
  input.dataset.register = name;
  input.value = hex(value, registerHexWidth(name));
  input.setAttribute('aria-label', 'Edit register ' + name.toUpperCase());
  node.append(label, input);
  refs.registers.appendChild(node);
};

const appendRegisterReadout = (name, value) => {
  refs.registers.insertAdjacentHTML('beforeend', kv(name.toUpperCase(), hex(value, registerHexWidth(name))));
};

const renderRegisters = (debug) => {
  if (!running && refs.registers.querySelector('input:focus')) return;
  const r = debug.registers;
  refs.registers.innerHTML = '';
  const editable = canEditCpuState();
  for (const name of editableRegisterNames) {
    if (!(name in r)) continue;
    if (editable) appendRegisterInput(name, r[name]);
    else appendRegisterReadout(name, r[name]);
  }
  refs.registers.insertAdjacentHTML('beforeend', kv('Cycles', String(debug.totalCycles)) + kv('Exec', String(debug.instructionCount)));
};

const renderFlags = (debug) => {
  refs.flags.innerHTML = '';
  const editable = canEditCpuState();
  for (const flag of debug.flags) {
    const node = document.createElement('div');
    node.className = 'kv ' + (flag.set ? 'flag-on' : 'flag-off');
    const label = document.createElement('b');
    label.textContent = flag.name.toUpperCase();
    node.appendChild(label);
    if (editable) {
      const button = document.createElement('button');
      button.className = 'button button-ghost button-small flag-edit' + (flag.set ? ' active' : '');
      button.type = 'button';
      button.dataset.flagMask = String(flag.mask);
      button.setAttribute('aria-pressed', String(flag.set));
      button.textContent = flag.set ? '1' : '0';
      node.appendChild(button);
    } else {
      node.append(flag.set ? '1' : '0');
    }
    refs.flags.appendChild(node);
  }
};

const renderPorts = (debug) => {
  const inputPorts = debug.ports.map((value, index) => kv("IN" + index, hex(value, 2))).join("");
  const outputPorts = (debug.outputPorts ?? []).slice(0, 6).map((value, index) => kv("OUT" + index, hex(value, 2))).join("");
  refs.ports.innerHTML = inputPorts + outputPorts + kv("SHIFT", hex(debug.shiftRegister, 4)) + kv("OFF", String(debug.shiftOffset));
};

const disassemblyLineConfig = () => {
  const source = emu?.manifest?.debugger?.disassembly ?? emu?.manifest?.debuggerDisassembly ?? {};
  return {
    beforeLines: Math.max(0, Math.min(48, integerOr(source.beforeLines ?? source.before ?? source.historyLines, 6))),
    afterLines: Math.max(1, Math.min(64, integerOr(source.afterLines ?? source.after ?? source.forwardLines ?? source.lineCount ?? source.lines, 12))),
  };
};

const DISASSEMBLY_BYTES_COLUMN_WIDTH = 11;

const formatDisassemblyEntry = (prefix, entry) => {
  const bytes = (entry.bytes ?? []).map((b) => hex(b, 2).slice(2)).join(" ");
  return prefix
    + hex(entry.address, 4)
    + "  "
    + bytes.padEnd(DISASSEMBLY_BYTES_COLUMN_WIDTH, " ")
    + "  "
    + entry.mnemonic;
};

const linearDisassemblyEntries = (currentPc, beforeLines, afterLines) => {
  const addressSpace = 0x10000;
  const normalizedPc = toAddress(currentPc);
  const windowBytes = Math.max(32, beforeLines * 6 + 24);
  const searchStart = Math.max(0, normalizedPc - windowBytes);
  let best = [];

  for (let start = searchStart; start < normalizedPc; start += 1) {
    const entries = [];
    let pc = start;
    let guard = 0;
    while (pc < normalizedPc && guard < windowBytes) {
      const entry = emu.cpu.disassemble(pc);
      const size = Math.max(1, entry.size ?? 1);
      entries.push(entry);
      pc = (pc + size) % addressSpace;
      guard += 1;
    }
    if (pc === normalizedPc) {
      const candidate = entries.slice(-beforeLines);
      if (candidate.length > best.length) best = candidate;
    }
  }

  const entries = best.slice();
  let pc = normalizedPc;
  for (let i = 0; i < afterLines; i += 1) {
    const entry = emu.cpu.disassemble(pc);
    entries.push(entry);
    pc = (pc + Math.max(1, entry.size ?? 1)) % addressSpace;
  }
  return entries;
};

const renderDisassembly = (debug, config = disassemblyLineConfig()) => {
  const currentPc = toAddress(debug.registers.pc);
  const entries = linearDisassemblyEntries(currentPc, config.beforeLines, config.afterLines);
  const lines = entries.map((entry) => formatDisassemblyEntry(toAddress(entry.address) === currentPc ? "> " : "  ", entry));
  refs.disasm.textContent = lines.join("\n");
};

const updateDebugger = (force = false) => {
  const now = performance.now();
  if (!force && now - lastDebugUpdate < 100) return;
  lastDebugUpdate = now;
  const disassemblyConfig = disassemblyLineConfig();
  const debugOptions = { historyLength: 0 };
  const actualDebug = running ? emu.cpu.getDebugState(debugOptions) : null;
  const debug = emu.cpu.getDebugState({ ...debugOptions, preferSample: running });
  renderRegisters(debug);
  renderFlags(debug);
  renderPorts(debug);
  withWatchIgnore(() => {
    renderDisassembly(debug, disassemblyConfig);
    renderMemoryMap(debug);
  });
  const lines = [
    'CPU: ' + debug.name,
    'ROMs: ' + loadedFiles.length,
    'Running: ' + String(running),
    'Interrupts: ' + String(debug.interruptEnabled),
    'Halted: ' + String(debug.halted),
    "Autopause: " + (focusPaused ? "paused on focus loss" : (refs["autopause"]?.checked ? "armed" : "off")),
    "Auto read: " + autoReadStatus(),
  ];
  if (actualDebug) lines.push("Displayed PC: " + hex(debug.registers.pc, 4) + "  Actual PC: " + hex(actualDebug.registers.pc, 4));
  if (actualDebug) lines.push("Displayed SP: " + hex(debug.registers.sp, 4) + "  Actual SP: " + hex(actualDebug.registers.sp, 4));
  if (lastAccessBreak) lines.push("Break: " + formatAccessRecord(lastAccessBreak));
  if (lastPcRuleHit) lines.push("PC Rule: " + lastPcRuleHit);
  const websocketRuleHit = websocketConnector?.getLastRuleHit?.();
  if (websocketRuleHit) lines.push("WebSocket Rule: " + websocketRuleHit);
  if (debug.haltedReason) lines.push(debug.haltedReason);
  if (debug.warnings.length) lines.push('Warnings: ' + debug.warnings.join(' | '));
  setStatus(lines, Boolean(debug.haltedReason));
  debuggerLayout.updateCustomDebuggerCards({ debug, actualDebug, running, force });
};

const memoryAddressSpaceSize = () => Math.max(1, inferMemoryMapSize());

const normalizeMemoryAddress = (value) => {
  const size = memoryAddressSpaceSize();
  const parsed = Math.trunc(Number(value) || 0);
  return ((parsed % size) + size) % size;
};

const memoryAddressHexWidth = (...addresses) => {
  const maxAddress = Math.max(memoryAddressSpaceSize() - 1, ...addresses.map((address) => Math.max(0, Math.trunc(Number(address) || 0))));
  return Math.max(4, maxAddress.toString(16).length);
};

const formatMemoryAddress = (address, width = memoryAddressHexWidth(address)) => "0x"
  + normalizeMemoryAddress(address).toString(16).toUpperCase().padStart(width, "0");

const memoryEditorHeaderLine = (start, rowBytes, addressWidth) => {
  const prefixWidth = formatMemoryAddress(start, addressWidth).length + 2;
  const labels = Array.from({ length: rowBytes }, (_, index) => formatMemoryAddress(start + index, addressWidth).slice(-2));
  return "-".repeat(Math.max(1, prefixWidth - 2)) + "  " + labels.join(" ");
};

const memoryEditorConfig = (mode = 'compact') => mode === 'expanded'
  ? { address: 'mem-expanded-address', length: 'mem-expanded-length', output: 'hex-dump-large', rowBytes: 'mem-expanded-row-bytes', maxLength: Math.min(0x10000, memoryAddressSpaceSize()) }
  : { address: 'mem-address', length: 'mem-length', output: 'hex-dump', rowBytes: null, maxLength: Math.min(0x4000, memoryAddressSpaceSize()) };

const memoryPatchConfig = (mode = 'compact') => mode === 'expanded'
  ? { address: 'patch-expanded-address', value: 'patch-expanded-value' }
  : { address: 'patch-address', value: 'patch-value' };

const memorySearchConfig = (mode = 'compact') => mode === 'expanded'
  ? { value: 'search-expanded-value', start: 'search-expanded-start', end: 'search-expanded-end', results: 'search-results-large' }
  : { value: 'search-value', start: 'search-start', end: 'search-end', results: 'search-results' };

const rowBytesForEditor = (mode = 'compact') => {
  if (mode !== 'expanded') return 16;
  const rowBytes = parseNumber(refs['mem-expanded-row-bytes'].value) || 16;
  return [8, 16, 32, 64].includes(rowBytes) ? rowBytes : 16;
};

const boundedMemoryReadLength = (mode = 'compact') => {
  const config = memoryEditorConfig(mode);
  const requested = parseNumber(refs[config.length].value) || 64;
  return Math.max(1, Math.min(config.maxLength, requested));
};

const visibleAutoReadLength = () => Math.max(
  boundedMemoryReadLength('compact'),
  refs['editor-modal']?.hidden ? 0 : boundedMemoryReadLength('expanded'),
);

const autoReadEnabled = () => Boolean(refs['mem-auto-read']?.checked);
const autoReadPauseOnly = () => Boolean(refs['mem-auto-pause-only']?.checked);

const syncAutoReadControls = (sourceId = "") => {
  let enabled = sourceId === "mem-expanded-auto-read"
    ? refs["mem-expanded-auto-read"].checked
    : refs["mem-auto-read"].checked;
  let pauseOnly = sourceId === "mem-expanded-auto-pause-only"
    ? refs["mem-expanded-auto-pause-only"].checked
    : refs["mem-auto-pause-only"].checked;

  if ((sourceId === "mem-auto-pause-only" || sourceId === "mem-expanded-auto-pause-only") && pauseOnly) enabled = true;
  if (!enabled) pauseOnly = false;

  refs["mem-auto-read"].checked = enabled;
  refs["mem-expanded-auto-read"].checked = enabled;
  refs["mem-auto-pause-only"].checked = pauseOnly;
  refs["mem-expanded-auto-pause-only"].checked = pauseOnly;
  refs["mem-auto-pause-only"].disabled = !enabled;
  refs["mem-expanded-auto-pause-only"].disabled = !enabled;
  saveDebuggerUiState();
};

const shouldAutoReadMemory = () => {
  if (!autoReadEnabled()) return false;
  if (running && autoReadPauseOnly()) return false;
  if (running && visibleAutoReadLength() > AUTO_READ_RUNNING_BYTE_LIMIT) return false;
  return true;
};

const autoReadStatus = () => {
  if (!autoReadEnabled()) return 'off';
  if (running && autoReadPauseOnly()) return 'waiting for pause';
  if (running && visibleAutoReadLength() > AUTO_READ_RUNNING_BYTE_LIMIT) {
    return 'waiting for pause; range > ' + hex(AUTO_READ_RUNNING_BYTE_LIMIT, 4);
  }
  return 'live';
};

const autoReadMemoryEditors = (now = performance.now()) => {
  if (!shouldAutoReadMemory()) return;
  if (now - lastAutoReadUpdate < AUTO_READ_INTERVAL_MS) return;
  lastAutoReadUpdate = now;
  refreshMemoryEditors();
};

const preloadMemoryAddress = (address) => {
  const normalized = toAddress(address);
  const value = withWatchIgnore(() => peekMemoryByte(normalized));
  refs['mem-address'].value = hex(normalized, 4);
  refs['patch-address'].value = hex(normalized, 4);
  refs['patch-value'].value = hex(value, 2);
  refs['break-address'].value = hex(normalized, 4);
  if (refs['mem-expanded-address']) refs['mem-expanded-address'].value = hex(normalized, 4);
  if (refs['patch-expanded-address']) refs['patch-expanded-address'].value = hex(normalized, 4);
  if (refs['patch-expanded-value']) refs['patch-expanded-value'].value = hex(value, 2);
  if (refs['break-expanded-address']) refs['break-expanded-address'].value = hex(normalized, 4);
  if (refs['hook-memory-address']) refs['hook-memory-address'].value = hex(normalized, 4);
  readMemoryEditor('compact');
  if (!refs['editor-modal']?.hidden) readMemoryEditor('expanded');
};

const syncExpandedMemoryEditorFromCompact = () => {
  refs['mem-expanded-address'].value = refs['mem-address'].value;
  refs['mem-expanded-length'].value = refs['mem-length'].value;
  refs['patch-expanded-address'].value = refs['patch-address'].value;
  refs['patch-expanded-value'].value = refs['patch-value'].value;
  refs['search-expanded-value'].value = refs['search-value'].value;
  refs['search-expanded-start'].value = refs['search-start'].value;
  refs['search-expanded-end'].value = refs['search-end'].value;
  refs['break-expanded-address'].value = refs['break-address'].value;
  const pc = emu?.cpu.getDebugState?.().registers?.pc;
  if (pc != null) {
    refs['hook-register-pc-address'].value = hex(pc, 4);
    refs['hook-memory-pc-address'].value = hex(pc, 4);
  }
  syncAutoReadControls();
};

const readMemoryEditor = (mode = 'compact') => withWatchIgnore(() => {
  const config = memoryEditorConfig(mode);
  const start = normalizeMemoryAddress(parseNumber(refs[config.address].value));
  const length = boundedMemoryReadLength(mode);
  const rowBytes = rowBytesForEditor(mode);
  const addressWidth = memoryAddressHexWidth(start, start + Math.max(0, length - 1));
  const lines = mode === 'expanded' ? [memoryEditorHeaderLine(start, rowBytes, addressWidth)] : [];
  for (let offset = 0; offset < length; offset += rowBytes) {
    const address = normalizeMemoryAddress(start + offset);
    const bytes = [];
    for (let i = 0; i < rowBytes && offset + i < length; i += 1) {
      const byteAddress = normalizeMemoryAddress(start + offset + i);
      bytes.push(hex(peekMemoryByte(byteAddress), 2).slice(2));
    }
    lines.push(formatMemoryAddress(address, addressWidth) + ': ' + bytes.join(' '));
  }
  const output = refs[config.output];
  output.textContent = lines.join('\n');
  if (mode === 'expanded') syncHexDumpVerticalOverflow(output);
});

const refreshMemoryEditors = () => {
  readMemoryEditor('compact');
  if (!refs['editor-modal']?.hidden) readMemoryEditor('expanded');
};

const writeMemoryByte = (mode = 'compact') => {
  const config = memoryPatchConfig(mode);
  const address = toAddress(parseNumber(refs[config.address].value));
  const value = toByte(parseNumber(refs[config.value].value));
  withWatchIgnore(() => emu.mmu.writeByte(emu, address, value));
  if (isVideoAddress(address)) dirtyVideo.add(address);
  preloadMemoryAddress(address);
  renderVideo();
  updateDebugger(true);
};

const searchMemory = (mode = 'compact') => {
  const config = memorySearchConfig(mode);
  const value = toByte(parseNumber(refs[config.value].value));
  const start = Math.max(0, parseNumber(refs[config.start].value));
  const end = Math.min(0x10000, parseNumber(refs[config.end].value));
  const results = withWatchIgnore(() => emu.mmu.searchByte(emu, value, start, end, 512));
  refs[config.results].innerHTML = '';
  for (const address of results) {
    const button = document.createElement('button');
    button.className = 'button button-ghost';
    button.type = 'button';
    button.textContent = hex(address, 4);
    button.addEventListener('click', () => {
      if (mode === 'expanded') pauseForOverlayButton();
      preloadMemoryAddress(address);
    });
    refs[config.results].appendChild(button);
  }
  if (!results.length) refs[config.results].textContent = 'No matches';
};

const clearSearchResults = (mode = "compact") => {
  refs[memorySearchConfig(mode).results].textContent = "";
  setStatus(["Cleared " + (mode === "expanded" ? "expanded" : "compact") + " search results"]);
};

const syncCpuRegisterOptions = () => {
  if (!refs['hook-register-name'] || !emu?.cpu?.getDebugState) return;
  const current = refs['hook-register-name'].value;
  refs['hook-register-name'].innerHTML = '';
  for (const name of Object.keys(emu.cpu.getDebugState().registers)) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name.toUpperCase();
    refs['hook-register-name'].appendChild(option);
  }
  refs['hook-register-name'].value = current || 'a';
};

const describePcRule = (rule) => {
  const hitText = ' hits ' + String(rule.hits ?? 0);
  if (rule.type === 'register') {
    return 'PC ' + hex(rule.pc, 4) + ' -> ' + rule.register.toUpperCase() + ' = ' + hex(rule.value, registerHexWidth(rule.register)) + hitText;
  }
  return 'PC ' + hex(rule.pc, 4) + ' -> MEM ' + hex(rule.address, 4) + ' = ' + hex(rule.value, 2) + hitText;
};

const renderPcRules = () => {
  if (!refs['pc-hook-list']) return;
  refs['pc-hook-list'].innerHTML = '';
  for (const rule of pcRules) {
    const button = document.createElement('button');
    button.className = 'button button-ghost';
    button.type = 'button';
    button.textContent = describePcRule(rule) + ' x';
    button.addEventListener('click', () => {
      const index = pcRules.findIndex((item) => item.id === rule.id);
      if (index >= 0) pcRules.splice(index, 1);
      renderPcRules();
    });
    refs['pc-hook-list'].appendChild(button);
  }
  if (!pcRules.length) refs['pc-hook-list'].textContent = 'No PC rules';
};

const addPcRegisterRule = () => {
  pauseForOverlayButton();
  const register = String(refs['hook-register-name'].value || 'a').toLowerCase();
  const value = registerBitWidth(register) === 16
    ? toAddress(parseNumber(refs['hook-register-value'].value))
    : toByte(parseNumber(refs['hook-register-value'].value));
  const rule = {
    id: pcRuleId,
    type: 'register',
    pc: toAddress(parseNumber(refs['hook-register-pc-address'].value)),
    register,
    value,
    hits: 0,
  };
  pcRuleId += 1;
  pcRules.push(rule);
  renderPcRules();
  setStatus(['Added PC register rule', describePcRule(rule)]);
};

const addPcMemoryRule = () => {
  pauseForOverlayButton();
  const rule = {
    id: pcRuleId,
    type: 'memory',
    pc: toAddress(parseNumber(refs['hook-memory-pc-address'].value)),
    address: toAddress(parseNumber(refs['hook-memory-address'].value)),
    value: toByte(parseNumber(refs['hook-memory-value'].value)),
    hits: 0,
  };
  pcRuleId += 1;
  pcRules.push(rule);
  renderPcRules();
  setStatus(['Added PC memory rule', describePcRule(rule)]);
};

const applyPcRulesForInstruction = (emuState, pc) => {
  if (!pcRules.length) return;
  const currentPc = toAddress(pc);
  for (const rule of pcRules) {
    if (rule.pc !== currentPc) continue;
    withWatchIgnore(() => {
      if (rule.type === 'register') {
        setCpuRegisterValue(rule.register, rule.value);
      } else {
        emuState.mmu.writeByte(emuState, rule.address, rule.value);
        if (isVideoAddress(rule.address)) dirtyVideo.add(rule.address);
      }
    });
    rule.hits = (rule.hits ?? 0) + 1;
    lastPcRuleHit = describePcRule(rule);
  }
};

const audioControlEnabled = () => emu?.audio?.getEnabled?.() !== false;

const resumeAudio = () => {
  if (!audioControlEnabled()) return;
  emu?.audio?.resume?.().catch(handleControlError);
};

const suspendAudio = () => {
  emu?.audio?.silence?.();
  emu?.audio?.suspend?.().catch(handleControlError);
};

const setRunning = (next) => {
  running = Boolean(next);
  if (running) {
    focusPaused = false;
    resumeAudio();
    lastAccessBreak = null;
    if (emu) emu.debugBreakRequested = false;
  } else {
    releaseAllInputs();
    suspendAudio();
  }
  refs["btn-run-toggle"].classList.toggle("active", running);
  refs["btn-run-toggle"].setAttribute("aria-pressed", String(running));
  refs["run-toggle-label"].textContent = running ? "Pause" : "Run";
  syncGameInputControls();
};

const resetEmulator = async () => {
  setRunning(false);
  releaseAllInputs();
  clearMemory();
  emu.cpu.reset();
  emu.audio?.reset?.();
  await loadRoms();
  emu.cpu.reset?.(emu);
  fullVideoRender = true;
  renderVideo();
  refreshMemoryEditors();
  updateDebugger(true);
};

const stepEmulator = () => {
  setRunning(false);
  emu.cpu.step(emu);
  renderVideo();
  refreshMemoryEditors();
  updateDebugger(true);
};

const runCommandAction = (action) => {
  try {
    switch (action) {
      case "pause": setRunning(!running); updateDebugger(true); break;
      case "step": stepEmulator(); break;
      case "reset": resetEmulator().catch(handleControlError); break;
      case "saveState": stateSnapshots.saveState(); break;
      case "loadState": stateSnapshots.loadSavedState({ resumeAfterLoad: running && !refs["autopause"]?.checked }); break;
      case "loadStateFromDisk": refs["state-file"].click(); break;
      default: break;
    }
  } catch (error) {
    handleControlError(error);
  }
};

const handleControlError = (error) => {
  console.error(error);
  setStatus(error.stack || error.message || String(error), true);
};

const commitRegisterEdit = (input) => {
  if (running || !input?.dataset?.register) return;
  const register = input.dataset.register;
  const value = parseNumber(input.value);
  setCpuRegisterValue(register, value);
  input.value = hex(registerBitWidth(register) === 16 ? toAddress(value) : toByte(value), registerHexWidth(register));
  refreshMemoryEditors();
  updateDebugger(true);
  setStatus(['Set register ' + register.toUpperCase(), input.value]);
};

const toggleFlagEdit = (button) => {
  if (running || !button?.dataset?.flagMask) return;
  const mask = parseNumber(button.dataset.flagMask);
  const debug = emu.cpu.getDebugState();
  const next = (debug.registers.f & mask) ? (debug.registers.f & (~mask)) : (debug.registers.f | mask);
  setCpuRegisterValue('f', next);
  updateDebugger(true);
};

const buttonForInput = (input) => Array.from(document.querySelectorAll("[data-input]"))
  .find((button) => button.dataset.input === input) ?? null;

const syncGameInputControls = () => {
  for (const button of document.querySelectorAll("[data-input]")) {
    button.disabled = !running;
    button.setAttribute("aria-disabled", String(!running));
    if (!running) {
      button.classList.remove("active");
      button.setAttribute("aria-pressed", "false");
    }
  }
};

const setInputPressed = (input, pressed) => {
  if (pressed && !running) return;
  emu.cpu.setInput(input, pressed);
  for (const device of [...(emu.devices.memory ?? []), ...(emu.devices.io ?? [])]) device.handleInput?.(emu, input, pressed);
  const button = buttonForInput(input);
  if (button) {
    button.classList.toggle("active", pressed);
    button.setAttribute("aria-pressed", String(pressed));
  }
  if (pressed) activeInputs.add(input);
  else activeInputs.delete(input);
};

const releaseAllInputs = () => {
  for (const timer of pulseTimers.values()) clearTimeout(timer);
  pulseTimers.clear();
  for (const timer of keyboardReleaseTimers.values()) clearTimeout(timer);
  keyboardReleaseTimers.clear();
  if (queuedInputTimer) clearTimeout(queuedInputTimer);
  queuedInputTimer = null;
  queuedInputTaps.length = 0;
  queuedInputActive = null;
  activeKeyboardInputs.clear();
  for (const input of Array.from(activeInputs)) setInputPressed(input, false);
};

const pulseInput = (input, duration = pulseDurations[input] ?? pulseDurations.default ?? 260) => {
  const timer = pulseTimers.get(input);
  if (timer) clearTimeout(timer);
  setInputPressed(input, true);
  pulseTimers.set(input, setTimeout(() => {
    setInputPressed(input, false);
    pulseTimers.delete(input);
  }, duration));
};

const runQueuedInputTap = () => {
  if (queuedInputActive || queuedInputTimer || queuedInputTaps.length === 0) return;
  const input = queuedInputTaps.shift();
  queuedInputActive = input;
  setInputPressed(input, true);
  queuedInputTimer = setTimeout(() => {
    setInputPressed(input, false);
    queuedInputActive = null;
    queuedInputTimer = setTimeout(() => {
      queuedInputTimer = null;
      runQueuedInputTap();
    }, queuedKeyboardGapMs);
  }, queuedKeyboardPressMs);
};

const queueInputTap = (input) => {
  queuedInputTaps.push(input);
  runQueuedInputTap();
};

const isEditableTarget = (target) => target?.matches?.("input:not([type=button]), textarea, select, [contenteditable=true]");

const keyboardCaptureActive = () => {
  const active = document.activeElement;
  return active === refs.screen || refs["input-buttons"]?.contains(active);
};

const autopauseIfFocusLeft = () => {
  if (suppressNextAutopause) {
    suppressNextAutopause = false;
    return;
  }
  if (!refs["autopause"]?.checked || !running) return;
  if (refs["play-zone"]?.contains(document.activeElement)) return;
  focusPaused = true;
  setRunning(false);
  releaseAllInputs();
  updateDebugger(true);
};

const scheduleAutopauseCheck = () => setTimeout(autopauseIfFocusLeft, 0);

const bindControls = () => {
  window.addEventListener('pointerdown', resumeAudio, { capture: true });
  window.addEventListener('keydown', resumeAudio, { capture: true });
  refs.screen.addEventListener("pointerdown", () => refs.screen.focus());
  refs["memory-map"].addEventListener("click", openMemoryMap);
  refs["memory-map"].setAttribute("tabindex", "0");
  refs["memory-map"].addEventListener("keydown", (event) => {
    if (event.code === "Enter" || event.code === "Space") {
      event.preventDefault();
      openMemoryMap();
    }
  });
  refs["btn-editor-expand"].addEventListener("click", openMemoryEditor);
  refs["btn-map-close"].addEventListener("click", () => {
    pauseForOverlayButton();
    closeMemoryMap();
  });
  refs["btn-map-preload"].addEventListener("click", preloadSelectedMapAddress);
  refs["map-modal"].querySelector("[data-map-close]").addEventListener("click", closeMemoryMap);
  refs["btn-editor-close"].addEventListener("click", () => {
    pauseForOverlayButton();
    closeMemoryEditor();
  });
  refs["editor-modal"].querySelector("[data-editor-close]").addEventListener("click", closeMemoryEditor);
  refs["memory-map-large"].addEventListener("mousemove", (event) => setMapHoverAddress(addressFromMapEvent(event)));
  refs["memory-map-large"].addEventListener("mouseleave", () => setMapHoverAddress(null));
  refs["memory-map-large"].addEventListener("click", (event) => setMapSelectedAddress(addressFromMapEvent(event)));
  refs["btn-break-read"].addEventListener("click", () => addAccessBreakpoint("read"));
  refs["btn-break-write"].addEventListener("click", () => addAccessBreakpoint("write"));
  refs["btn-find-writer"].addEventListener("click", () => addAccessBreakpoint("writer"));
  window.addEventListener("resize", () => {
    debuggerLayout.applyDebuggerLayout();
    syncMemoryMapOverlayBounds();
    syncMemoryEditorOverlayBounds();
    syncRulesOverlayBounds();
  });
  refs["debugger-pane"].addEventListener("scroll", () => {
    syncMemoryMapOverlayBounds();
    syncMemoryEditorOverlayBounds();
    syncRulesOverlayBounds();
  });
  refs["play-zone"].addEventListener("focusout", scheduleAutopauseCheck);
  window.addEventListener("blur", () => {
    if (refs["autopause"]?.checked && running) {
      focusPaused = true;
      setRunning(false);
      releaseAllInputs();
      updateDebugger(true);
    }
  });

  refs["btn-run-toggle"].addEventListener("click", () => runCommandAction("pause"));
  refs["btn-step"].addEventListener("click", () => runCommandAction("step"));
  refs["btn-reset"].addEventListener("click", () => runCommandAction("reset"));
  refs["btn-save-state"].addEventListener("click", () => runCommandAction("saveState"));
  refs["btn-load-state"].addEventListener("click", () => runCommandAction("loadState"));
  refs["btn-load-state-disk"].addEventListener("click", () => runCommandAction("loadStateFromDisk"));
  refs["state-file"].addEventListener("change", () => {
    const file = refs["state-file"].files?.[0];
    const resumeAfterLoad = running && !refs["autopause"]?.checked;
    refs["state-file"].value = "";
    stateSnapshots.loadStateFile(file, { resumeAfterLoad }).catch(handleControlError);
  });
  refs["btn-refresh-roms"].addEventListener("click", () => { romCatalog.refreshRomCatalog({ showStatus: true }).catch(handleControlError); });
  refs["rom-select"].addEventListener("change", () => romCatalog.syncRomOffsetFromCatalogSelection());
  refs["btn-load-catalog-rom"].addEventListener("click", () => { loadSelectedCatalogRom().catch(handleControlError); });
  refs["btn-rom-mode-toggle"].addEventListener("click", () => setRomLoaderMode(romLoaderMode === "disk" ? "catalog" : "disk"));
  refs["btn-rom-advanced-toggle"].addEventListener("click", () => setRomAdvancedOpen(Boolean(refs["rom-advanced-controls"]?.hidden)));
  refs["btn-load-rom"].addEventListener("click", () => { chooseOrLoadMemoryFile().catch(handleControlError); });
  refs["rom-file"].addEventListener("change", () => {
    if (diskRomFiles(refs["rom-file"]?.files).length) loadMemoryFile().catch(handleControlError);
  });
  refs["rom-autorun"]?.addEventListener("change", saveGlobalRomLoaderState);
  refs["btn-debug-reset-defaults"].addEventListener("click", resetDebuggerUiDefaults);
  refs["btn-read-memory"].addEventListener("click", () => readMemoryEditor("compact"));
  refs["btn-write-memory"].addEventListener("click", () => writeMemoryByte("compact"));
  refs["btn-search"].addEventListener("click", () => searchMemory("compact"));
  refs["btn-clear-search"].addEventListener("click", () => clearSearchResults("compact"));
  for (const id of ["mem-auto-read", "mem-auto-pause-only", "mem-expanded-auto-read", "mem-expanded-auto-pause-only"]) {
    refs[id].addEventListener("change", () => {
      syncAutoReadControls(id);
      if (autoReadEnabled() && shouldAutoReadMemory()) refreshMemoryEditors();
    });
  }
  refs["btn-expanded-read-memory"].addEventListener("click", () => { pauseForOverlayButton(); readMemoryEditor("expanded"); });
  refs["mem-expanded-row-bytes"].addEventListener("change", () => readMemoryEditor("expanded"));
  refs["btn-expanded-write-memory"].addEventListener("click", () => { pauseForOverlayButton(); writeMemoryByte("expanded"); });
  refs["btn-expanded-search"].addEventListener("click", () => { pauseForOverlayButton(); searchMemory("expanded"); });
  refs["btn-expanded-clear-search"].addEventListener("click", () => { pauseForOverlayButton(); clearSearchResults("expanded"); });
  refs["btn-expanded-break-read"].addEventListener("click", () => { pauseForOverlayButton(); addAccessBreakpoint("read", "expanded"); });
  refs["btn-expanded-break-write"].addEventListener("click", () => { pauseForOverlayButton(); addAccessBreakpoint("write", "expanded"); });
  refs["btn-expanded-find-writer"].addEventListener("click", () => { pauseForOverlayButton(); addAccessBreakpoint("writer", "expanded"); });
  refs["btn-access-copy"].addEventListener("click", () => { pauseForOverlayButton(); copyJsonToClipboard(accessRulesToJson(), "Access rules").catch(handleControlError); });
  refs["btn-access-import"].addEventListener("click", () => { pauseForOverlayButton(); openRulesImport("access"); });
  refs["btn-access-clear"].addEventListener("click", () => { pauseForOverlayButton(); clearAccessRules(); });
  refs["btn-pc-copy"].addEventListener("click", () => { pauseForOverlayButton(); copyJsonToClipboard(pcRulesToJson(), "PC rules").catch(handleControlError); });
  refs["btn-pc-import"].addEventListener("click", () => { pauseForOverlayButton(); openRulesImport("pc"); });
  refs["btn-pc-clear"].addEventListener("click", () => { pauseForOverlayButton(); clearPcRules(); });
  refs["btn-rules-clear-all"].addEventListener("click", () => { pauseForOverlayButton(); clearAllBreakpointRules(); });
  refs["btn-rules-close"].addEventListener("click", closeRulesImport);
  refs["rules-modal"].querySelector("[data-rules-close]").addEventListener("click", closeRulesImport);
  refs["btn-rules-load"].addEventListener("click", () => {
    pauseForOverlayButton();
    try {
      loadRulesImport();
    } catch (error) {
      handleControlError(error);
    }
  });
  refs["btn-add-register-hook"].addEventListener("click", addPcRegisterRule);
  refs["btn-add-memory-hook"].addEventListener("click", addPcMemoryRule);
  refs["btn-pc-help"].addEventListener("click", () => {
    const nextHidden = !refs["pc-hook-help"].hidden;
    refs["pc-hook-help"].hidden = nextHidden;
    refs["btn-pc-help"].setAttribute("aria-expanded", String(!nextHidden));
    saveDebuggerUiState();
  });
  refs.registers.addEventListener("change", (event) => {
    if (event.target?.matches?.("[data-register]")) commitRegisterEdit(event.target);
  });
  refs.registers.addEventListener("keydown", (event) => {
    if (!event.target?.matches?.("[data-register]")) return;
    if (event.code === "Enter") {
      event.preventDefault();
      commitRegisterEdit(event.target);
      event.target.blur();
    }
    if (event.code === "Escape") {
      event.preventDefault();
      updateDebugger(true);
      event.target.blur();
    }
  });
  refs.flags.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-flag-mask]");
    if (button) toggleFlagEdit(button);
  });

  syncHotkeyLabels();
  bindDebuggerUiPersistence();
  websocketConnector?.bindControls?.();

  for (const button of document.querySelectorAll("[data-input]")) {
    const input = button.dataset.input;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.focus();
      if (queuedKeyboardInput && pulseInputs.has(input)) queueInputTap(input);
      else if (pulseInputs.has(input)) pulseInput(input);
      else setInputPressed(input, true);
    });
    button.addEventListener("pointerup", (event) => {
      event.preventDefault();
      if (!pulseInputs.has(input)) setInputPressed(input, false);
    });
    button.addEventListener("pointercancel", () => {
      if (!pulseInputs.has(input)) setInputPressed(input, false);
    });
    button.addEventListener("pointerleave", () => {
      if (!pulseInputs.has(input)) setInputPressed(input, false);
    });
    button.addEventListener("click", (event) => {
      if (pulseInputs.has(input) && event.detail === 0) {
        if (queuedKeyboardInput) queueInputTap(input);
        else pulseInput(input);
      }
    });
  }

  window.addEventListener("keydown", (event) => {
    if (event.code === "Escape") {
      if (!refs["rules-modal"]?.hidden) {
        event.preventDefault();
        closeRulesImport();
        return;
      }
    }
    if (!isEditableTarget(event.target)) {
      const action = hotkeyActionForEvent(event);
      if (action) {
        event.preventDefault();
        if (!event.repeat) runCommandAction(action);
        return;
      }
    }
    if (!running) return;
    if (!keyboardCaptureActive() || isEditableTarget(event.target)) return;
    const directInput = directInputForKeyboardEvent(event);
    if (queuedKeyboardInput && isModifierOnlyKeyboardEvent(event) && directInput) {
      event.preventDefault();
      if (!event.repeat) {
        activeKeyboardInputs.set(event.code, directInput);
        setInputPressed(directInput, true);
      }
      return;
    }
    if (queuedKeyboardInput && isModifierOnlyKeyboardEvent(event)) return;
    const input = inputForKeyboardEvent(event);
    if (!input) return;
    event.preventDefault();
    if (queuedKeyboardInput) {
      if (!event.repeat) queueInputTap(input);
      return;
    }
    if (pulseInputs.has(input)) {
      if (!event.repeat) pulseInput(input);
      return;
    }
    if (!event.repeat) {
      const releaseTimer = keyboardReleaseTimers.get(event.code);
      if (releaseTimer) {
        clearTimeout(releaseTimer);
        keyboardReleaseTimers.delete(event.code);
      }
      activeKeyboardInputs.set(event.code, input);
      setInputPressed(input, true);
    }
  });
  window.addEventListener("keyup", (event) => {
    if (!running) return;
    if (!keyboardCaptureActive() || isEditableTarget(event.target)) return;
    const directInput = activeKeyboardInputs.get(event.code) ?? directInputForKeyboardEvent(event);
    if (queuedKeyboardInput && directInput && isModifierOnlyKeyboardEvent(event)) {
      event.preventDefault();
      activeKeyboardInputs.delete(event.code);
      setInputPressed(directInput, false);
      return;
    }
    if (queuedKeyboardInput) return;
    const input = activeKeyboardInputs.get(event.code) ?? inputForKeyboardEvent(event);
    if (!input) return;
    event.preventDefault();
    if (pulseInputs.has(input)) return;
    const release = () => {
      activeKeyboardInputs.delete(event.code);
      keyboardReleaseTimers.delete(event.code);
      setInputPressed(input, false);
    };
    if (keyboardReleaseDelayMs > 0) {
      const releaseTimer = keyboardReleaseTimers.get(event.code);
      if (releaseTimer) clearTimeout(releaseTimer);
      keyboardReleaseTimers.set(event.code, setTimeout(release, keyboardReleaseDelayMs));
    } else {
      release();
    }
  });
};

const pauseForCpuHalt = (debug = emu.cpu.getDebugState()) => {
  if (!debug?.haltedReason) return false;
  setRunning(false);
  renderVideo();
  refreshMemoryEditors();
  updateDebugger(true);
  setStatus(["CPU halted", debug.haltedReason], true);
  return true;
};

const frame = () => {
  if (running) {
    for (let i = 0; i < 2; i += 1) {
      const result = emu.cpu.runUntilInterrupt(emu);
      if (result?.halted && pauseForCpuHalt()) break;
    }
    renderVideo();
  }
  autoReadMemoryEditors();
  if (running) updateDebugger(false);
  requestAnimationFrame(frame);
};

const init = async () => {
  collectRefs();
  populatePlatformSwitcher();
  setRomLoaderMode('catalog');
  setRomAdvancedOpen(false);
  loadGlobalRomLoaderState();
  mapCtx = refs['memory-map'].getContext('2d');

  largeMapCtx = refs["memory-map-large"].getContext("2d");

  const manifestURL = new URL(manifestPath, document.baseURI).href;
  emu = await createEmulatorFromManifestURL(manifestURL);
  window.emu = emu;
  romCatalog = createRomCatalog({
    refs,
    getEmu: () => emu,
    platformDefaultRomOffset,
    platformSettingsStorageKey,
    readSettingsBucket,
    selectedPlatform,
    setStatus,
    writeSettingsBucket,
  });
  stateSnapshots = createStateSnapshots({
    clearFocusPaused: () => { focusPaused = false; },
    getEmu: () => emu,
    getLoadedFiles: () => loadedFiles,
    getManifestPath: () => manifestPath,
    getRawMemory,
    getRunning: () => running,
    refs,
    refreshMemoryViews,
    releaseAllInputs,
    setLoadedFiles: (files) => { loadedFiles = files; },
    setRunning,
    setStatus,
  });
  debuggerLayout = createDebuggerLayout({
    globalSettingsStorageKey: GLOBAL_SETTINGS_STORAGE_KEY,
    getEmu: () => emu,
    getRunning: () => running,
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
  });
  websocketConnector = createWebSocketConnector({
    refs,
    getEmu: () => emu,
    selectedPlatform,
    manifestPath,
    parseNumber,
    toByte,
    toAddress,
    hex,
    setStatus,
    setRunning,
    releaseAllInputs,
    pulseInput,
    setInputPressed,
    stepEmulator,
    resetEmulator,
    updateDebugger,
    withWatchIgnore,
    watchIgnoreActive: () => watchIgnoreDepth > 0,
    normalizeMemoryAddress,
    memoryAddressSpaceSize,
    formatMemoryAddress,
    isVideoAddress,
    markVideoAddress: (address) => dirtyVideo.add(address),
    renderVideo,
    refreshMemoryEditors,
    setCpuRegisterValue,
    bytesToBase64,
    base64ToBytes,
    pauseForOverlayButton,
    copyJsonToClipboard,
    openRulesImport,
    handleControlError,
  });
  websocketConnector.configureFromManifest();
  configureScreenFromManifest();
  emu.debugBreakRequested = false;
  configureControlsFromManifest();
  configureMemoryMap();
  emu.debugHooks = { beforeInstruction: applyPcRulesForInstruction };
  emu.mmu.on?.("read", (event) => {
    handleMemoryAccess("read", event);
    websocketConnector?.handleMemoryAccess("read", event);
  });
  emu.mmu.on?.("write", (event) => {
    const { address } = event;
    if (isVideoAddress(address)) dirtyVideo.add(address);
    handleMemoryAccess("write", event);
    websocketConnector?.handleMemoryAccess("write", event);
  });

  await debuggerLayout.initializeDebuggerLayout();
  bindControls();
  syncCpuRegisterOptions();
  renderAccessBreakpoints();
  renderPcRules();
  renderMemoryLegend();
  await romCatalog.refreshRomCatalog();
  await loadStartupRoms();
  emu.cpu.reset?.(emu);
  loadDebuggerUiState();
  renderVideo();
  refreshMemoryEditors();
  setRunning(emu?.manifest?.runOnStart !== false);
  websocketConnector?.startAutoConnections?.();
  updateDebugger(true);
  requestAnimationFrame(frame);
};

init().catch((error) => {
  console.error(error);
  collectRefs();
  setStatus(error.stack || error.message || String(error), true);
});
