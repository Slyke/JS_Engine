const ADDRESS_SPACE_SIZE = 0x10000;
const BASIC_START = 0xa000;
const KERNAL_START = 0xe000;
const IO_START = 0xd000;
const IO_END = 0xdfff;
const ROM_SIZE = 0x2000;
const CHAR_ROM_SIZE = 0x1000;
const COLOR_RAM_SIZE = 0x0400;
const CIA_REG_COUNT = 0x10;
const C64_CLOCK_HZ = 1022727;

const u8 = (value) => value & 0xff;
const u16 = (value) => value & 0xffff;
const bytesToArray = (bytes) => Array.from(bytes ?? []);
const restoreBytes = (target, source, fill = 0) => {
  target.fill(fill);
  if (source == null) return;
  const bytes = source instanceof Uint8Array ? source : Uint8Array.from(source);
  target.set(bytes.subarray(0, target.length));
};

const FONT_5X7 = Object.freeze({
  " ": [0, 0, 0, 0, 0, 0, 0],
  "!": [4, 4, 4, 4, 0, 4, 0],
  "\"": [10, 10, 0, 0, 0, 0, 0],
  "#": [10, 31, 10, 31, 10, 0, 0],
  "$": [14, 20, 14, 5, 30, 4, 0],
  "%": [17, 2, 4, 8, 17, 0, 0],
  "&": [12, 18, 20, 8, 21, 18, 13],
  "'": [4, 4, 0, 0, 0, 0, 0],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
  "*": [0, 10, 4, 31, 4, 10, 0],
  "+": [0, 4, 4, 31, 4, 4, 0],
  ",": [0, 0, 0, 0, 4, 4, 8],
  "-": [0, 0, 0, 31, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 12, 12],
  "/": [1, 2, 4, 8, 16, 0, 0],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 2, 4, 8, 31],
  "3": [30, 1, 1, 14, 1, 1, 30],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 2, 12],
  ":": [0, 12, 12, 0, 12, 12, 0],
  ";": [0, 12, 12, 0, 12, 4, 8],
  "<": [2, 4, 8, 16, 8, 4, 2],
  "=": [0, 0, 31, 0, 31, 0, 0],
  ">": [8, 4, 2, 1, 2, 4, 8],
  "?": [14, 17, 1, 2, 4, 0, 4],
  "@": [14, 17, 23, 21, 23, 16, 14],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 18, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  "[": [14, 8, 8, 8, 8, 8, 14],
  "\\": [16, 8, 4, 2, 1, 0, 0],
  "]": [14, 2, 2, 2, 2, 2, 14],
  "^": [4, 10, 17, 0, 0, 0, 0],
  "_": [0, 0, 0, 0, 0, 0, 31],
});

export const screenCodeToChar = (code) => {
  const value = code & 0x7f;
  if (value === 0) return "@";
  if (value >= 1 && value <= 26) return String.fromCharCode(64 + value);
  if (value >= 32 && value <= 95) return String.fromCharCode(value);
  if (value >= 96 && value <= 121) return String.fromCharCode(64 + (value - 96));
  return " ";
};

const glyphRowsForChar = (ch) => FONT_5X7[ch] ?? FONT_5X7[ch?.toUpperCase?.()] ?? FONT_5X7[" "];

export const createFallbackCharacterRom = () => {
  const rom = new Uint8Array(CHAR_ROM_SIZE);
  for (let code = 0; code < 256; code += 1) {
    const rows = glyphRowsForChar(screenCodeToChar(code));
    const inverse = code >= 128;
    for (let y = 0; y < 8; y += 1) {
      let byte = 0;
      if (y > 0 && y < 8) {
        const bits = rows[y - 1] ?? 0;
        for (let x = 0; x < 5; x += 1) {
          if ((bits & (1 << (4 - x))) !== 0) byte |= 1 << (6 - x);
        }
      }
      rom[(code * 8 + y) & (CHAR_ROM_SIZE - 1)] = inverse ? (~byte & 0xff) : byte;
    }
  }
  rom.set(rom.subarray(0, 0x800), 0x800);
  return rom;
};

const KEY_MATRIX = Object.freeze({
  delete: [0, 0], backspace: [0, 0],
  return: [1, 0], enter: [1, 0],
  cursorright: [2, 0], cursorleft: [2, 0],
  f7: [3, 0], f1: [4, 0], f3: [5, 0], f5: [6, 0],
  cursordown: [7, 0], cursorup: [7, 0],
  "3": [0, 1], w: [1, 1], a: [2, 1], "4": [3, 1], z: [4, 1], s: [5, 1], e: [6, 1], shift: [7, 1], leftshift: [7, 1],
  "5": [0, 2], r: [1, 2], d: [2, 2], "6": [3, 2], c: [4, 2], f: [5, 2], t: [6, 2], x: [7, 2],
  "7": [0, 3], y: [1, 3], g: [2, 3], "8": [3, 3], b: [4, 3], h: [5, 3], u: [6, 3], v: [7, 3],
  "9": [0, 4], i: [1, 4], j: [2, 4], "0": [3, 4], m: [4, 4], k: [5, 4], o: [6, 4], n: [7, 4],
  plus: [0, 5], "+": [0, 5], p: [1, 5], l: [2, 5], minus: [3, 5], "-": [3, 5], period: [4, 5], ".": [4, 5],
  colon: [5, 5], ":": [5, 5], at: [6, 5], "@": [6, 5], comma: [7, 5], ",": [7, 5],
  pound: [0, 6], asterisk: [1, 6], "*": [1, 6], semicolon: [2, 6], ";": [2, 6], home: [3, 6],
  rightshift: [4, 6], equals: [5, 6], "=": [5, 6], arrowup: [6, 6], slash: [7, 6], "/": [7, 6],
  "1": [0, 7], arrowleft: [1, 7], control: [2, 7], ctrl: [2, 7], "2": [3, 7], space: [4, 7], commodore: [5, 7],
  q: [6, 7], runstop: [7, 7], escape: [7, 7],
});

const pressedKeys = (emu) => Object.entries(KEY_MATRIX).filter(([id]) => emu?.cpu?.isInputPressed?.(id));

const createCIA = (id, interruptTarget = "irq") => {
  const regs = new Uint8Array(CIA_REG_COUNT);
  let timerALatch = 0xffff;
  let timerBLatch = 0xffff;
  let timerA = 0xffff;
  let timerB = 0xffff;
  let icr = 0;
  let imr = 0;
  let interruptActive = false;
  let nmiPending = false;

  const reset = () => {
    regs.fill(0);
    timerALatch = 0xffff;
    timerBLatch = 0xffff;
    timerA = 0xffff;
    timerB = 0xffff;
    icr = 0;
    imr = 0;
    interruptActive = false;
    nmiPending = false;
    if (id === "cia2") {
      regs[0] = 0x03;
      regs[2] = 0x3f;
    }
  };

  const portOutput = (port, ddr) => (port & ddr) | ((~ddr) & 0xff);

  const readKeyboardPortA = (emu) => {
    let value = portOutput(regs[0], regs[2]);
    const portB = portOutput(regs[1], regs[3]);
    for (const [, [row, column]] of pressedKeys(emu)) {
      if ((portB & (1 << row)) === 0) value &= ~(1 << column);
    }
    return value;
  };

  const readKeyboardPortB = (emu) => {
    let value = portOutput(regs[1], regs[3]);
    const portA = portOutput(regs[0], regs[2]);
    for (const [, [row, column]] of pressedKeys(emu)) {
      if ((portA & (1 << column)) === 0) value &= ~(1 << row);
    }
    return value;
  };

  const raiseInterrupt = (bit) => {
    icr |= bit & 0x1f;
    if ((icr & imr) !== 0) {
      interruptActive = true;
      if (interruptTarget === "nmi") nmiPending = true;
    }
  };

  const read = (emu, offset, sideEffects = true) => {
    const reg = offset & 0x0f;
    if (id === "cia1" && reg === 0) return readKeyboardPortA(emu);
    if (id === "cia1" && reg === 1) return readKeyboardPortB(emu);
    if (reg === 4) return timerA & 0xff;
    if (reg === 5) return (timerA >> 8) & 0xff;
    if (reg === 6) return timerB & 0xff;
    if (reg === 7) return (timerB >> 8) & 0xff;
    if (reg === 13) {
      const value = icr | (interruptActive ? 0x80 : 0);
      if (sideEffects) {
        icr = 0;
        interruptActive = false;
      }
      return value;
    }
    return regs[reg];
  };

  const write = (_emu, offset, value) => {
    const reg = offset & 0x0f;
    const next = value & 0xff;
    regs[reg] = next;
    if (reg === 4) timerALatch = (timerALatch & 0xff00) | next;
    else if (reg === 5) timerALatch = (next << 8) | (timerALatch & 0x00ff);
    else if (reg === 6) timerBLatch = (timerBLatch & 0xff00) | next;
    else if (reg === 7) timerBLatch = (next << 8) | (timerBLatch & 0x00ff);
    else if (reg === 13) {
      if ((next & 0x80) !== 0) imr |= next & 0x1f;
      else imr &= ~(next & 0x1f);
      interruptActive = (icr & imr) !== 0;
    } else if (reg === 14) {
      if ((next & 0x10) !== 0) timerA = timerALatch || 0x10000;
    } else if (reg === 15) {
      if ((next & 0x10) !== 0) timerB = timerBLatch || 0x10000;
    }
  };

  const tickTimer = (which, cycles) => {
    const controlReg = which === "a" ? 14 : 15;
    const latch = which === "a" ? timerALatch : timerBLatch;
    let counter = which === "a" ? timerA : timerB;
    const control = regs[controlReg];
    if ((control & 0x01) === 0) return counter;

    let remaining = Math.max(0, cycles | 0);
    while (remaining > 0) {
      if (counter <= remaining) {
        remaining -= counter || 1;
        raiseInterrupt(which === "a" ? 0x01 : 0x02);
        if ((control & 0x08) !== 0) {
          regs[controlReg] &= ~0x01;
          counter = latch || 0x10000;
          break;
        }
        counter = latch || 0x10000;
      } else {
        counter -= remaining;
        remaining = 0;
      }
    }
    return counter & 0xffff;
  };

  const tick = (cycles) => {
    timerA = tickTimer("a", cycles);
    timerB = tickTimer("b", cycles);
  };

  const serializeState = () => ({
    regs: bytesToArray(regs),
    timerALatch,
    timerBLatch,
    timerA,
    timerB,
    icr,
    imr,
    interruptActive,
    nmiPending,
  });

  const restoreState = (snapshot = {}) => {
    restoreBytes(regs, snapshot.regs);
    timerALatch = snapshot.timerALatch ?? 0xffff;
    timerBLatch = snapshot.timerBLatch ?? 0xffff;
    timerA = snapshot.timerA ?? timerALatch;
    timerB = snapshot.timerB ?? timerBLatch;
    icr = snapshot.icr ?? 0;
    imr = snapshot.imr ?? 0;
    interruptActive = Boolean(snapshot.interruptActive);
    nmiPending = Boolean(snapshot.nmiPending);
  };

  reset();

  return {
    regs,
    read,
    write,
    tick,
    reset,
    serializeState,
    restoreState,
    irqActive: () => interruptTarget === "irq" && interruptActive,
    consumeNmi: () => {
      const pending = interruptTarget === "nmi" && nmiPending;
      nmiPending = false;
      return pending;
    },
    portAValue: () => portOutput(regs[0], regs[2]),
  };
};

const createCommodore64Memory = (_size = ADDRESS_SPACE_SIZE, options = {}) => {
  const ram = new Uint8Array(ADDRESS_SPACE_SIZE);
  const basic = new Uint8Array(ROM_SIZE).fill(0xff);
  const kernal = new Uint8Array(ROM_SIZE).fill(0xff);
  const charRom = createFallbackCharacterRom();
  const colorRam = new Uint8Array(COLOR_RAM_SIZE);
  const vic = new Uint8Array(0x40);
  const sid = new Uint8Array(0x20);
  const cia1 = createCIA("cia1", "irq");
  const cia2 = createCIA("cia2", "nmi");
  const soundWrites = [];

  let cpuPortDdr = 0x2f;
  let cpuPortData = 0x37;
  let rasterCycle = 0;

  const cpuPortValue = () => (cpuPortData & cpuPortDdr) | ((~cpuPortDdr) & 0xff);
  const loram = () => (cpuPortValue() & 0x01) !== 0;
  const hiram = () => (cpuPortValue() & 0x02) !== 0;
  const charen = () => (cpuPortValue() & 0x04) !== 0;
  const romIoWindowEnabled = () => loram() || hiram();
  const basicVisible = () => loram() && hiram();
  const kernalVisible = () => hiram();
  const ioVisible = () => romIoWindowEnabled() && charen();
  const charRomVisible = () => romIoWindowEnabled() && !charen();

  const reset = () => {
    ram.fill(0);
    colorRam.fill(0x0e);
    vic.fill(0);
    sid.fill(0);
    cia1.reset();
    cia2.reset();
    cpuPortDdr = options.cpuPortDdr ?? 0x2f;
    cpuPortData = options.cpuPortData ?? 0x37;
    ram[0] = cpuPortDdr;
    ram[1] = cpuPortData;
    vic[0x11] = 0x1b;
    vic[0x16] = 0xc8;
    vic[0x18] = 0x14;
    vic[0x20] = 0x0e;
    vic[0x21] = 0x06;
    rasterCycle = 0;
    soundWrites.length = 0;
  };

  const readVicRegister = (offset) => {
    const reg = offset & 0x3f;
    const raster = Math.floor((rasterCycle / 63) % 312);
    if (reg === 0x11) return (vic[reg] & 0x7f) | ((raster & 0x100) ? 0x80 : 0);
    if (reg === 0x12) return raster & 0xff;
    return vic[reg] ?? 0xff;
  };

  const writeVicRegister = (offset, value) => {
    vic[offset & 0x3f] = value & 0xff;
  };

  const readSidRegister = (offset) => {
    const reg = offset & 0x1f;
    if (reg === 0x1b || reg === 0x1c) return (Math.random() * 256) & 0xff;
    return sid[reg] ?? 0;
  };

  const writeSidRegister = (emu, offset, value) => {
    const reg = offset & 0x1f;
    const next = value & 0xff;
    sid[reg] = next;
    soundWrites.push({ address: IO_START + 0x400 + reg, value: next });
    if (soundWrites.length > 32) soundWrites.shift();
    emu?.audio?.writeRegister?.(reg, next);
  };

  const readIo = (emu, address, sideEffects = true) => {
    if (address < 0xd400) return readVicRegister(address - 0xd000);
    if (address < 0xd800) return readSidRegister(address - 0xd400);
    if (address < 0xdc00) return colorRam[address & 0x03ff] | 0xf0;
    if (address < 0xdd00) return cia1.read(emu, address & 0x0f, sideEffects);
    if (address < 0xde00) return cia2.read(emu, address & 0x0f, sideEffects);
    return 0xff;
  };

  const writeIo = (emu, address, value) => {
    if (address < 0xd400) writeVicRegister(address - 0xd000, value);
    else if (address < 0xd800) writeSidRegister(emu, address - 0xd400, value);
    else if (address < 0xdc00) colorRam[address & 0x03ff] = value & 0x0f;
    else if (address < 0xdd00) cia1.write(emu, address & 0x0f, value);
    else if (address < 0xde00) cia2.write(emu, address & 0x0f, value);
  };

  const readByteInternal = (emu, address, sideEffects = true) => {
    const addr = address & 0xffff;
    if (addr === 0x0000) return cpuPortDdr;
    if (addr === 0x0001) return cpuPortValue();
    if (addr >= BASIC_START && addr < 0xc000 && basicVisible()) return basic[addr - BASIC_START];
    if (addr >= KERNAL_START && kernalVisible()) return kernal[addr - KERNAL_START];
    if (addr >= IO_START && addr <= IO_END) {
      if (ioVisible()) return readIo(emu, addr, sideEffects);
      if (charRomVisible()) return charRom[addr & (CHAR_ROM_SIZE - 1)];
    }
    return ram[addr];
  };

  const readByte = (emu, address) => readByteInternal(emu, address, true);
  const peekByte = (emu, address) => readByteInternal(emu, address, false);

  const writeByte = (emu, address, value) => {
    const addr = address & 0xffff;
    const next = value & 0xff;
    if (addr === 0x0000) {
      cpuPortDdr = next;
      ram[0] = next;
      return;
    }
    if (addr === 0x0001) {
      cpuPortData = next;
      ram[1] = next;
      return;
    }
    if (addr >= IO_START && addr <= IO_END && ioVisible()) {
      writeIo(emu, addr, next);
      return;
    }
    ram[addr] = next;
  };

  const loadByte = (emu, address, value, loadOptions = {}) => {
    const offset = address & 0xffff;
    const next = value & 0xff;
    const target = String(loadOptions.target ?? "").toLowerCase();
    if (loadOptions.physical === true || target === "ram") {
      ram[offset] = next;
    } else if (target === "basic") {
      if (offset < ROM_SIZE) basic[offset] = next;
    } else if (target === "kernal" || target === "kernel") {
      kernal[offset % ROM_SIZE] = next;
    } else if (target === "character" || target === "char" || target === "chargen") {
      charRom[offset % CHAR_ROM_SIZE] = next;
    } else if (target === "system" || target === "system-rom" || target === "rom") {
      if (offset < ROM_SIZE) basic[offset] = next;
      else if (offset < ROM_SIZE * 2) kernal[offset - ROM_SIZE] = next;
    } else {
      writeByte(emu, offset, next);
    }
  };

  const loadBytes = (emu, offset, bytes, loadOptions = {}) => {
    const start = offset & 0xffff;
    const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes ?? []);
    for (let i = 0; i < data.length; i += 1) loadByte(emu, start + i, data[i], loadOptions);
    return { start, length: data.length, end: (start + Math.max(0, data.length - 1)) & 0xffff };
  };

  const readWord = (emu, address) => readByte(emu, address) | (readByte(emu, address + 1) << 8);
  const peekWord = (emu, address) => peekByte(emu, address) | (peekByte(emu, address + 1) << 8);
  const writeWord = (emu, address, value) => {
    writeByte(emu, address, value);
    writeByte(emu, address + 1, value >> 8);
  };

  const vicBankBase = () => ((~cia2.portAValue()) & 0x03) * 0x4000;
  const readVideoByte = (_emu, vicAddress) => {
    const local = vicAddress & 0x3fff;
    const physical = (vicBankBase() + local) & 0xffff;
    const charWindow = local >= 0x1000 && local < 0x2000 && (vicBankBase() === 0x0000 || vicBankBase() === 0x8000);
    return charWindow ? charRom[local & (CHAR_ROM_SIZE - 1)] : ram[physical];
  };

  const tick = (_emu, cycles) => {
    const count = Math.max(0, Number(cycles) || 0);
    rasterCycle = (rasterCycle + count) % (63 * 312);
    cia1.tick(count);
    cia2.tick(count);
  };

  const irqActive = () => cia1.irqActive();
  const consumeNmi = () => cia2.consumeNmi();

  const serializeState = () => ({
    ram: bytesToArray(ram),
    basic: bytesToArray(basic),
    kernal: bytesToArray(kernal),
    charRom: bytesToArray(charRom),
    colorRam: bytesToArray(colorRam),
    vic: bytesToArray(vic),
    sid: bytesToArray(sid),
    cia1: cia1.serializeState(),
    cia2: cia2.serializeState(),
    cpuPortDdr,
    cpuPortData,
    rasterCycle,
  });

  const restoreState = (_emu, snapshot = {}) => {
    restoreBytes(ram, snapshot.ram);
    restoreBytes(basic, snapshot.basic, 0xff);
    restoreBytes(kernal, snapshot.kernal, 0xff);
    restoreBytes(charRom, snapshot.charRom);
    restoreBytes(colorRam, snapshot.colorRam, 0x0e);
    restoreBytes(vic, snapshot.vic);
    restoreBytes(sid, snapshot.sid);
    cia1.restoreState(snapshot.cia1);
    cia2.restoreState(snapshot.cia2);
    cpuPortDdr = snapshot.cpuPortDdr ?? 0x2f;
    cpuPortData = snapshot.cpuPortData ?? 0x37;
    rasterCycle = snapshot.rasterCycle ?? 0;
  };

  const getMemoryMap = () => [
    { type: "ram", label: "Zero Page / Stack / RAM", start: 0x0000, end: 0x7fff, size: 0x8000, writable: true },
    { type: "ram", label: "Cartridge / RAM", start: 0x8000, end: 0x9fff, size: 0x2000, writable: true },
    { type: "rom", label: "BASIC ROM / RAM", start: 0xa000, end: 0xbfff, size: 0x2000, writable: false },
    { type: "ram", label: "System RAM", start: 0xc000, end: 0xcfff, size: 0x1000, writable: true },
    { type: "io", label: "VIC-II / SID / Color / CIA", start: 0xd000, end: 0xdfff, size: 0x1000, writable: true },
    { type: "rom", label: "KERNAL ROM / RAM", start: 0xe000, end: 0xffff, size: 0x2000, writable: false },
  ];

  const searchByte = (emu, value, start = 0, end = 0x10000, limit = 1024) => {
    const needle = value & 0xff;
    const results = [];
    for (let address = start >>> 0; address < (end >>> 0) && results.length < limit; address += 1) {
      if (peekByte(emu, address) === needle) results.push(address & 0xffff);
    }
    return results;
  };

  const debugPorts = () => [
    cpuPortDdr,
    cpuPortValue(),
    vic[0x18],
    vic[0x11],
    readVicRegister(0x12),
    cia1.regs[13] | (cia1.irqActive() ? 0x80 : 0),
    cia1.regs[14],
    sid[0x18],
  ];

  reset();

  return {
    raw: ram,
    basic,
    kernal,
    charRom,
    colorRam,
    vic,
    sid,
    cia1,
    cia2,
    soundWrites,
    readByte,
    peekByte,
    writeByte,
    loadByte,
    loadBytes,
    readWord,
    peekWord,
    writeWord,
    readVideoByte,
    tick,
    irqActive,
    consumeNmi,
    reset,
    serializeState,
    restoreState,
    getMemoryMap,
    searchByte,
    debugPorts,
    getState: () => ({
      cpuPortDdr,
      cpuPortData,
      cpuPortValue: cpuPortValue(),
      loram: loram(),
      hiram: hiram(),
      charen: charen(),
      vicBankBase: vicBankBase(),
      clockHz: C64_CLOCK_HZ,
    }),
  };
};

export default createCommodore64Memory;
