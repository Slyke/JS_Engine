const PORT5_NO_KEY = 0x7c;
const PORT5_ON_CLEAR = 0x80;
const KBB_BACK = 0x73;
const KBB_NKYS = 0x74;
const KBT_BUFF = 0x20b0;
const KBT_SIZE = 16;

const INPUT_KEY_CODES = Object.freeze({
  onclear: 1,
  onClear: 1,
  ac: 1,
  mode: 2,
  up: 3,
  down: 4,
  left: 5,
  right: 6,
  delete: 8,
  del: 8,
  backspace: 8,
  exe: 13,
  enter: 13,
  space: 32,
  " ": 32,
  "!": 33,
  quote: 34,
  "\"": 34,
  "#": 35,
  "$": 36,
  "%": 37,
  "&": 38,
  "'": 39,
  apostrophe: 39,
  "(": 40,
  ")": 41,
  "*": 42,
  asterisk: 42,
  multiply: 42,
  "+": 43,
  plus: 43,
  add: 43,
  ",": 44,
  comma: 44,
  "-": 45,
  minus: 45,
  subtract: 45,
  ".": 46,
  period: 46,
  dot: 46,
  "/": 47,
  slash: 47,
  divide: 47,
  ":": 58,
  ";": 59,
  semicolon: 59,
  "<": 60,
  "=": 61,
  equals: 61,
  ">": 62,
  "?": 63,
});

const COUNTER_COLUMNS = Object.freeze([
  { values: [0x3f], keys: { 6: "d", 5: "j", 4: "p", 3: "v", 2: "z" } },
  { values: [0x5e, 0x5f], keys: { 6: "f", 5: "l", 4: "r", 3: "x", 2: "exe" } },
  { values: [0x6d, 0x6e, 0x6f], keys: { 6: "e", 5: "k", 4: "q", 3: "w", 2: "space" } },
  { values: [0x74, 0x75, 0x76, 0x77], keys: { 6: "c", 5: "i", 4: "o", 3: "u", 2: "y" } },
  { values: [0x78, 0x79, 0x7a, 0x7b], keys: { 6: "b", 5: "h", 4: "n", 3: "t", 2: "delete" } },
  { values: [0x7c, 0x7d], keys: { 6: "a", 5: "g", 4: "m", 3: "s", 2: "shift" } },
  { values: [0x7e], keys: { 6: "right", 5: "left", 4: "down", 3: "up", 2: "mode" } },
]);

const ALL_COLUMNS = Object.freeze(COUNTER_COLUMNS.map((column) => column.keys));
const stateByEmu = new WeakMap();
const defaultState = { counter: 0, allLow: true };

const stateFor = (emuState) => {
  if (!emuState || (typeof emuState !== "object" && typeof emuState !== "symbol")) return defaultState;
  let state = stateByEmu.get(emuState);
  if (!state) {
    state = { counter: 0, allLow: true };
    stateByEmu.set(emuState, state);
  }
  return state;
};

const resetCounter = (emuState) => {
  const state = stateFor(emuState);
  state.counter = 0;
  state.allLow = true;
};

const clockCounter = (emuState) => {
  const state = stateFor(emuState);
  state.counter = (state.counter + 1) & 0x7f;
  state.allLow = false;
};

const keyboardSnapshot = (emuState) => (
  emuState?.cpu?.keyboardSnapshot?.()
  ?? emuState?.cpu?.getDebugState?.({ historyLength: 0 })?.keyboard
  ?? emuState?.cpu?.serializeState?.().keyboard
  ?? {}
);

const pressed = (keyboard, key) => Boolean(keyboard[String(key).toLowerCase()]);

const keyPressed = (keyboard, key) => {
  if (pressed(keyboard, key)) return true;
  if (key === "onClear") return pressed(keyboard, "onclear") || pressed(keyboard, "ac");
  if (key === "exe") return pressed(keyboard, "enter");
  if (key === "space") return pressed(keyboard, " ");
  if (key === "delete") return pressed(keyboard, "del") || pressed(keyboard, "backspace") || pressed(keyboard, "rubout");
  return false;
};

const inputKeyCode = (input) => {
  const id = String(input ?? "");
  const direct = INPUT_KEY_CODES[id] ?? INPUT_KEY_CODES[id.toLowerCase()];
  if (direct != null) return direct;
  if (/^[a-z]$/i.test(id)) return id.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(id)) return id.charCodeAt(0);
  return null;
};

const bufferKey = (emuState, code) => {
  const mmu = emuState?.mmu;
  if (!mmu) return;
  const count = mmu.readByte(emuState, KBB_NKYS) & 0xff;
  if (count >= KBT_SIZE) return;
  const back = mmu.readByte(emuState, KBB_BACK) & 0x0f;
  const index = (back + count) & 0x0f;
  mmu.writeByte(emuState, KBT_BUFF + index, code & 0xff);
  mmu.writeByte(emuState, KBB_NKYS, count + 1);
};

const handleInput = (emuState, input, isPressed) => {
  if (!isPressed) return;
  const code = inputKeyCode(input);
  if (code == null) return;
  bufferKey(emuState, code);
};

const selectedColumns = (state) => {
  if (state.allLow) return ALL_COLUMNS;
  const selected = COUNTER_COLUMNS.find((column) => column.values.includes(state.counter));
  return selected ? [selected.keys] : [];
};

const readPort5 = (emuState) => {
  const keyboard = keyboardSnapshot(emuState);
  let value = PORT5_NO_KEY;
  if (keyPressed(keyboard, "onClear")) value |= PORT5_ON_CLEAR;

  for (const keys of selectedColumns(stateFor(emuState))) {
    for (const [bit, key] of Object.entries(keys)) {
      if (keyPressed(keyboard, key)) value &= ~(1 << Number(bit));
    }
  }

  return value & 0xff;
};

const createPsionKeyboard = (_size = 1, options = {}) => {
  const role = String(options.role ?? "port5");

  const readByte = (emuState) => {
    if (role === "counterReset") {
      resetCounter(emuState);
      return 0;
    }
    if (role === "counterClock") {
      clockCounter(emuState);
      return 0;
    }
    return readPort5(emuState);
  };

  const peekByte = (emuState) => role === "port5" ? readPort5(emuState) : 0;

  const writeByte = (emuState) => {
    if (role === "counterReset") resetCounter(emuState);
    else if (role === "counterClock") clockCounter(emuState);
  };

  const api = {
    readByte,
    peekByte,
    writeByte,
    reset: resetCounter,
    serializeState: (emuState) => ({ ...stateFor(emuState), byteLength: 2 }),
    restoreState: (emuState, snapshot = {}) => {
      const state = stateFor(emuState);
      state.counter = Number(snapshot.counter) & 0x7f;
      state.allLow = snapshot.allLow !== false;
    },
  };
  if (role === "port5") api.handleInput = handleInput;
  return api;
};

export default createPsionKeyboard;
