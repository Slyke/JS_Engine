export const cloneStringMap = (source = {}) => Object.fromEntries(
  Object.entries(source ?? {}).filter(([, value]) => typeof value === "string" && value)
);

export const cloneHotkeyMap = (source = {}) => Object.fromEntries(
  Object.entries(source ?? {}).map(([key, value]) => {
    if (typeof value === "string" && value) return [key, value];
    if (Array.isArray(value)) {
      const values = value.filter((entry) => typeof entry === "string" && entry);
      if (values.length) return [key, values];
    }
    return null;
  }).filter(Boolean)
);

export const humanizeInputId = (id) => String(id)
  .replace(/[-_]+/g, " ")
  .replace(/([a-z])(\d)/gi, (_match, letter, digit) => letter + " " + digit)
  .replace(/\b\w/g, (char) => char.toUpperCase());

export const normalizeInputDefinition = (entry) => {
  const raw = typeof entry === "string" ? { id: entry } : entry;
  const id = String(raw?.id ?? raw?.name ?? "").trim();
  if (!id) return null;
  return {
    id,
    label: String(raw.label ?? humanizeInputId(id)),
    pulse: Boolean(raw.pulse || raw.type === "pulse" || raw.mode === "pulse"),
  };
};

export const advancedInputHotkeysFromControls = (controls = {}) => (
  cloneHotkeyMap(controls.advancedInputHotkeys ?? controls.adVancedInputHotkeys)
);

export const inputDefinitionsFromSource = (source = []) => source
  .map((entry) => normalizeInputDefinition(entry))
  .filter(Boolean);

export const inputDefinitionsFromControls = (controls = {}) => {
  const source = Array.isArray(controls.inputs) ? controls.inputs : Object.keys(controls.inputHotkeys ?? {});
  return inputDefinitionsFromSource(source);
};

export const advancedInputDefinitionsFromControls = (controls = {}) => {
  const hotkeys = advancedInputHotkeysFromControls(controls);
  const source = Array.isArray(controls.advancedInputs) ? controls.advancedInputs : Object.keys(hotkeys);
  return inputDefinitionsFromSource(source);
};

const keyboardGroupId = (entry) => {
  const raw = typeof entry === "string" ? { id: entry } : entry;
  const id = String(raw?.id ?? raw?.name ?? raw?.label ?? "").trim().toLowerCase();
  if (["letters", "alpha", "a-z", "keyboard-a-z"].includes(id)) return "letters";
  if (["numbers", "digits", "0-9", "numbers-0-9"].includes(id)) return "numbers";
  if (["arrows", "arrow", "arrow-keys", "arrow keys", "cursor", "cursor-keys"].includes(id)) return "arrows";
  if (["wsad", "wasd", "wsad-keys", "wasd-keys", "wsad keys", "wasd keys"].includes(id)) return "wsad";
  if (["special", "special-keys", "special keys", "symbols", "symbol-keys", "operators", "operator-keys"].includes(id)) return "special";
  return id || null;
};

const keyboardGroupIdsFromControls = (controls = {}) => (Array.isArray(controls.keyboardGroups) ? controls.keyboardGroups : [])
  .map(keyboardGroupId)
  .filter(Boolean);

export const inputHotkeysFromKeyboardGroups = (controls = {}) => {
  const groups = new Set(keyboardGroupIdsFromControls(controls));
  const map = {};
  if (groups.has("letters")) {
    for (let code = 65; code <= 90; code += 1) {
      const letter = String.fromCharCode(code);
      map[letter.toLowerCase()] = "Key" + letter;
    }
  }
  if (groups.has("numbers")) {
    for (let digit = 0; digit <= 9; digit += 1) map[String(digit)] = "Digit" + String(digit);
  }
  if (groups.has("arrows")) {
    map.up = "ArrowUp";
    map.down = "ArrowDown";
    map.left = "ArrowLeft";
    map.right = "ArrowRight";
  }
  if (groups.has("wsad")) {
    map.up = "KeyW";
    map.down = "KeyS";
    map.left = "KeyA";
    map.right = "KeyD";
  }
  if (groups.has("special")) {
    Object.assign(map, {
      "+": ["Shift+Equal", "NumpadAdd"],
      "-": ["Minus", "NumpadSubtract"],
      "*": ["Shift+Digit8", "NumpadMultiply"],
      "/": ["Slash", "NumpadDivide"],
      ".": ["Period", "NumpadDecimal"],
      ",": "Comma",
      "=": ["Equal", "NumpadEqual"],
      "(": "Shift+Digit9",
      ")": "Shift+Digit0",
      ":": "Shift+Semicolon",
      ";": "Semicolon",
      "'": "Quote",
      "\"": "Shift+Quote",
    });
  }
  return map;
};

export const keyboardGroupDefinitionsFromControls = (controls = {}) => {
  const groups = Array.isArray(controls.keyboardGroups) ? controls.keyboardGroups : [];
  return groups.map((entry) => {
    const raw = typeof entry === "string" ? { id: entry } : entry;
    const id = keyboardGroupId(entry);
    const label = String(raw?.label ?? raw?.name ?? "").trim();
    if (id === "letters") return { label: label || "Keyboard A-Z" };
    if (id === "numbers") return { label: label || "Numbers 0-9" };
    if (id === "arrows") return { label: label || "Arrow Keys" };
    if (id === "wsad") return { label: label || "WSAD" };
    if (id === "special") return { label: label || "Special Keys" };
    return label ? { label } : null;
  }).filter(Boolean);
};

const labelForSingleCode = (code) => {
  if (!code) return "";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  if (code === "Space") return "Space";
  if (code === "Backspace") return "Bksp";
  if (code === "Escape") return "Esc";
  return code.replace(/^Arrow/, "");
};

export const labelForCode = (code) => {
  const firstCode = Array.isArray(code) ? code.find(Boolean) : code;
  if (!firstCode) return "";
  const parts = String(firstCode).split("+");
  const key = parts.pop();
  return [...parts, labelForSingleCode(key)].filter(Boolean).join("+");
};

export const hotkeyCodeOptions = (hotkeyCode) => Array.isArray(hotkeyCode)
  ? hotkeyCode.filter((code) => typeof code === "string" && code)
  : (hotkeyCode ? [String(hotkeyCode)] : []);

export const hotkeyMatchesEvent = (hotkeyCode, event) => {
  const parts = String(hotkeyCode ?? "").split("+");
  const code = parts.pop();
  const modifiers = new Set(parts);
  return code === event.code
    && modifiers.has("Shift") === event.shiftKey
    && modifiers.has("Ctrl") === event.ctrlKey
    && modifiers.has("Alt") === event.altKey
    && modifiers.has("Meta") === event.metaKey;
};
