const ROWS = Object.freeze([
  { select: 0x0100, keys: ["shift", "z", "x", "c", "v"] },
  { select: 0x0200, keys: ["a", "s", "d", "f", "g"] },
  { select: 0x0400, keys: ["q", "w", "e", "r", "t"] },
  { select: 0x0800, keys: ["1", "2", "3", "4", "5"] },
  { select: 0x1000, keys: ["0", "9", "8", "7", "6"] },
  { select: 0x2000, keys: ["p", "o", "i", "u", "y"] },
  { select: 0x4000, keys: ["enter", "l", "k", "j", "h"] },
  { select: 0x8000, keys: ["space", ".", "m", "n", "b"] },
]);

const ALIASES = Object.freeze({
  shift: ["shift", "shiftleft", "shiftright"],
  space: ["space", " "]
});

const COMPOSITES = Object.freeze({
  rubout: ["shift", "0"],
  backspace: ["shift", "0"],
  break: ["shift", "space"],
  left: ["shift", "5"],
  right: ["shift", "8"],
  up: ["shift", "7"],
  down: ["shift", "6"],
  cursorleft: ["shift", "5"],
  cursorright: ["shift", "8"],
  cursorup: ["shift", "7"],
  cursordown: ["shift", "6"],
  home: ["shift", "9"],
  edit: ["shift", "enter"],
  not: ["shift", "1"],
  and: ["shift", "2"],
  then: ["shift", "3"],
  to: ["shift", "4"],
  ":": ["shift", "z"],
  colon: ["shift", "z"],
  ";": ["shift", "x"],
  semicolon: ["shift", "x"],
  "?": ["shift", "c"],
  question: ["shift", "c"],
  "/": ["shift", "v"],
  slash: ["shift", "v"],
  "*": ["shift", "p"],
  asterisk: ["shift", "p"],
  ")": ["shift", "o"],
  rightparen: ["shift", "o"],
  "(": ["shift", "i"],
  leftparen: ["shift", "i"],
  "$": ["shift", "u"],
  dollar: ["shift", "u"],
  "\"": ["shift", "y"],
  "'": ["shift", "y"],
  quote: ["shift", "y"],
  doublequote: ["shift", "y"],
  apostrophe: ["shift", "y"],
  "=": ["shift", "l"],
  equals: ["shift", "l"],
  "+": ["shift", "k"],
  plus: ["shift", "k"],
  "-": ["shift", "j"],
  minus: ["shift", "j"],
  power: ["shift", "h"],
  exponent: ["shift", "h"],
  currency: ["shift", "space"],
  ",": ["shift", "."],
  comma: ["shift", "."],
  ">": ["shift", "m"],
  greaterthan: ["shift", "m"],
  "<": ["shift", "n"],
  lessthan: ["shift", "n"],
  or: ["shift", "b"],
  mosaica: ["shift", "a"],
  mosaics: ["shift", "s"],
  mosaicd: ["shift", "d"],
  mosaicf: ["shift", "f"],
  mosaicg: ["shift", "g"],
  mosaicq: ["shift", "q"],
  mosaicw: ["shift", "w"],
  mosaice: ["shift", "e"],
  mosaicr: ["shift", "r"],
  mosaict: ["shift", "t"],
});

const createSinclairZX80Keyboard = () => {
  const keyboard = (emuState) => emuState?.cpu?.keyboardSnapshot?.() ?? emuState?.cpu?.serializeState?.().keyboard ?? {};
  const pressed = (state, key) => Boolean(state[String(key).toLowerCase()]);
  const isPressed = (state, key) => {
    const normalized = String(key).toLowerCase();
    if (pressed(state, normalized)) return true;
    if ((ALIASES[normalized] ?? []).some((alias) => pressed(state, alias))) return true;
    return Object.entries(COMPOSITES).some(([alias, keys]) => pressed(state, alias) && keys.includes(normalized));
  };

  const inByte = (emuState, port) => {
    const state = keyboard(emuState);
    let value = 0xff;
    for (const row of ROWS) {
      if ((port & row.select) !== 0) continue;
      for (let bit = 0; bit < row.keys.length; bit += 1) {
        if (isPressed(state, row.keys[bit])) value &= ~(1 << bit);
      }
    }
    return value;
  };

  return { inByte, outByte() {}, raw: new Uint8Array(0) };
};

export default createSinclairZX80Keyboard;
