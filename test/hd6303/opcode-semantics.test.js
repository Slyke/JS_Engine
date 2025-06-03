import assert from "assert";
import createHD6303CPU from "../../emulator/cpu/hd6303.js";
import { allOpcodes, createTestEmulator, createTestMemory, hex8 } from "../helpers/emulator-harness.js";

// HD6303 expectations are grouped from the HD6303 datasheet in
// docs/psion-organiser-ii/pdffiles/. Undefined primary bytes are explicitly
// classified; documented bytes assert their main observable state effect.
const PC = 0x0200;
const SP = 0x9000;
const X = 0x3000;
const TARGET = 0x1234;
const DIRECT = 0x34;
const OFFSET = 0x02;
const IX_ADDR = X + OFFSET;
const RETURN = 0x5678;
const FLAG = { c: 0x01, v: 0x02, z: 0x04, n: 0x08, i: 0x10 };

const u8 = (value) => value & 0xff;
const u16 = (value) => value & 0xffff;
const signed8 = (value) => (value & 0x80) ? value - 0x100 : value;

const DOCUMENTED = new Set([
  0x01, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
  0x10, 0x11, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b,
  ...Array.from({ length: 0x10 }, (_v, i) => 0x20 + i),
  ...Array.from({ length: 0x10 }, (_v, i) => 0x30 + i),
  0x40, 0x43, 0x44, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4c, 0x4d, 0x4f,
  0x50, 0x53, 0x54, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x5c, 0x5d, 0x5f,
  ...Array.from({ length: 0x20 }, (_v, i) => 0x60 + i),
  0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e,
  ...Array.from({ length: 0x10 }, (_v, i) => 0x90 + i),
  ...Array.from({ length: 0x10 }, (_v, i) => 0xa0 + i),
  ...Array.from({ length: 0x10 }, (_v, i) => 0xb0 + i),
  0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xce,
  ...Array.from({ length: 0x10 }, (_v, i) => 0xd0 + i),
  ...Array.from({ length: 0x10 }, (_v, i) => 0xe0 + i),
  ...Array.from({ length: 0x10 }, (_v, i) => 0xf0 + i),
]);

const createBase = () => ({
  registers: { pc: PC, sp: SP, x: X, a: 0x42, b: 0x24, cc: 0 },
  memory: new Map([
    [SP + 1, RETURN >> 8],
    [SP + 2, RETURN & 0xff],
    [SP + 3, 0xa3],
    [SP + 4, 0xa4],
    [SP + 5, 0xa5],
    [SP + 6, 0x12],
    [SP + 7, 0x34],
    [DIRECT, 0x11],
    [DIRECT + 1, 0x22],
    [IX_ADDR, 0x22],
    [IX_ADDR + 1, 0x33],
    [TARGET, 0x33],
    [TARGET + 1, 0x44],
    [0xfffa, 0x12],
    [0xfffb, 0x34],
  ]),
  pc: PC + 1,
  cycles: 1,
});

const getD = (state) => (state.registers.a << 8) | state.registers.b;
const setD = (state, value) => {
  const word = u16(value);
  state.registers.a = word >> 8;
  state.registers.b = word & 0xff;
};
const memGet = (state, address) => state.memory.get(u16(address)) ?? 0;
const memSet = (state, address, value) => state.memory.set(u16(address), u8(value));
const memWord = (state, address) => (memGet(state, address) << 8) | memGet(state, address + 1);
const memSetWord = (state, address, value) => {
  memSet(state, address, value >> 8);
  memSet(state, address + 1, value);
};
const setNZ8 = (state, value) => {
  const next = u8(value);
  state.registers.cc = (state.registers.cc & ~(FLAG.n | FLAG.z)) | ((next & 0x80) ? FLAG.n : 0) | (next === 0 ? FLAG.z : 0);
  return next;
};
const setNZ16 = (state, value) => {
  const next = u16(value);
  state.registers.cc = (state.registers.cc & ~(FLAG.n | FLAG.z)) | ((next & 0x8000) ? FLAG.n : 0) | (next === 0 ? FLAG.z : 0);
  return next;
};
const add8 = (state, left, right, carry = 0) => {
  const result = left + right + carry;
  const value = setNZ8(state, result);
  state.registers.cc = (state.registers.cc & ~(FLAG.c | FLAG.v)) | (result > 0xff ? FLAG.c : 0) | ((~(left ^ right) & (left ^ value) & 0x80) ? FLAG.v : 0);
  return value;
};
const sub8 = (state, left, right, carry = 0) => {
  const result = left - right - carry;
  const value = setNZ8(state, result);
  state.registers.cc = (state.registers.cc & ~(FLAG.c | FLAG.v)) | (result < 0 ? FLAG.c : 0) | ((((left ^ right) & (left ^ value)) & 0x80) ? FLAG.v : 0);
  return value;
};
const logic8 = (state, value) => {
  const next = setNZ8(state, value);
  state.registers.cc &= ~FLAG.v;
  return next;
};
const unary = (state, value, op) => {
  const before = u8(value);
  if (op === "neg") return sub8(state, 0, before);
  if (op === "com") { state.registers.cc |= FLAG.c; return logic8(state, ~before); }
  if (op === "lsr") { const next = before >> 1; state.registers.cc = (state.registers.cc & ~(FLAG.n | FLAG.z | FLAG.v | FLAG.c)) | (next === 0 ? FLAG.z : 0) | ((before & 1) ? FLAG.c | FLAG.v : 0); return next; }
  if (op === "ror") { const next = ((state.registers.cc & FLAG.c) ? 0x80 : 0) | (before >> 1); state.registers.cc = (state.registers.cc & ~(FLAG.n | FLAG.z | FLAG.v | FLAG.c)) | ((next & 0x80) ? FLAG.n : 0) | (next === 0 ? FLAG.z : 0) | ((before & 1) ? FLAG.c : 0); if (((next & 0x80) !== 0) !== ((before & 1) !== 0)) state.registers.cc |= FLAG.v; return next; }
  if (op === "asr") { const next = (before & 0x80) | (before >> 1); state.registers.cc = (state.registers.cc & ~(FLAG.n | FLAG.z | FLAG.v | FLAG.c)) | ((next & 0x80) ? FLAG.n : 0) | (next === 0 ? FLAG.z : 0) | ((before & 1) ? FLAG.c : 0); if (((next & 0x80) !== 0) !== ((before & 1) !== 0)) state.registers.cc |= FLAG.v; return next; }
  if (op === "asl") { const next = u8(before << 1); state.registers.cc = (state.registers.cc & ~(FLAG.n | FLAG.z | FLAG.v | FLAG.c)) | ((next & 0x80) ? FLAG.n : 0) | (next === 0 ? FLAG.z : 0) | ((before & 0x80) ? FLAG.c : 0); if (((next & 0x80) !== 0) !== ((before & 0x80) !== 0)) state.registers.cc |= FLAG.v; return next; }
  if (op === "rol") { const next = u8((before << 1) | ((state.registers.cc & FLAG.c) ? 1 : 0)); state.registers.cc = (state.registers.cc & ~(FLAG.n | FLAG.z | FLAG.v | FLAG.c)) | ((next & 0x80) ? FLAG.n : 0) | (next === 0 ? FLAG.z : 0) | ((before & 0x80) ? FLAG.c : 0); if (((next & 0x80) !== 0) !== ((before & 0x80) !== 0)) state.registers.cc |= FLAG.v; return next; }
  if (op === "dec") { const next = setNZ8(state, before - 1); state.registers.cc = (state.registers.cc & ~FLAG.v) | (before === 0x80 ? FLAG.v : 0); return next; }
  if (op === "inc") { const next = setNZ8(state, before + 1); state.registers.cc = (state.registers.cc & ~FLAG.v) | (before === 0x7f ? FLAG.v : 0); return next; }
  if (op === "tst") { const next = setNZ8(state, before); state.registers.cc &= ~(FLAG.v | FLAG.c); return next; }
  if (op === "clr") { state.registers.cc = (state.registers.cc & ~(FLAG.n | FLAG.v | FLAG.c)) | FLAG.z; return 0; }
  throw new Error(`Unknown unary op ${op}`);
};

const bytes = (...values) => [...values, 0, 0, 0].slice(0, 5);
const branchTakenCc = (opcode) => ({
  0x20: 0, 0x21: 0, 0x22: 0, 0x23: FLAG.c, 0x24: 0, 0x25: FLAG.c, 0x26: 0, 0x27: FLAG.z,
  0x28: 0, 0x29: FLAG.v, 0x2a: 0, 0x2b: FLAG.n, 0x2c: 0, 0x2d: FLAG.n, 0x2e: 0, 0x2f: FLAG.z,
})[opcode] ?? 0;

const buildBinary = (opcode, state, source, mode) => {
  const low = opcode & 0x0f;
  const target = opcode < 0xc0 ? "a" : "b";
  const left = state.registers[target];
  if (low === 0x0) state.registers[target] = sub8(state, left, source);
  else if (low === 0x1) sub8(state, left, source);
  else if (low === 0x2) state.registers[target] = sub8(state, left, source, (state.registers.cc & FLAG.c) ? 1 : 0);
  else if (low === 0x4) state.registers[target] = logic8(state, left & source);
  else if (low === 0x5) logic8(state, left & source);
  else if (low === 0x6) state.registers[target] = logic8(state, source);
  else if (low === 0x7) { /* store handled by caller */ }
  else if (low === 0x8) state.registers[target] = logic8(state, left ^ source);
  else if (low === 0x9) state.registers[target] = add8(state, left, source, (state.registers.cc & FLAG.c) ? 1 : 0);
  else if (low === 0x0a) state.registers[target] = logic8(state, left | source);
  else if (low === 0x0b) state.registers[target] = add8(state, left, source);
  else throw new Error(`Unhandled binary ${hex8(opcode)} ${mode}`);
};

const buildCase = (opcode) => {
  if (!DOCUMENTED.has(opcode)) return { opcode, documented: false, name: "undefined HD6303 opcode" };

  const expected = createBase();
  let program = bytes(opcode);
  const setPcCycles = (pc, cycles) => { expected.pc = u16(pc); expected.cycles = cycles; };

  if (opcode >= 0x20 && opcode <= 0x2f) {
    program = bytes(opcode, OFFSET);
    expected.registers.cc = branchTakenCc(opcode);
    setPcCycles(opcode === 0x21 ? PC + 2 : PC + 2 + signed8(OFFSET), 3);
    return { opcode, documented: true, name: "conditional branch taken", bytes: program, setup: { cc: expected.registers.cc }, expected };
  }

  const accUnary = { 0x40: ["a", "neg"], 0x43: ["a", "com"], 0x44: ["a", "lsr"], 0x46: ["a", "ror"], 0x47: ["a", "asr"], 0x48: ["a", "asl"], 0x49: ["a", "rol"], 0x4a: ["a", "dec"], 0x4c: ["a", "inc"], 0x4d: ["a", "tst"], 0x4f: ["a", "clr"], 0x50: ["b", "neg"], 0x53: ["b", "com"], 0x54: ["b", "lsr"], 0x56: ["b", "ror"], 0x57: ["b", "asr"], 0x58: ["b", "asl"], 0x59: ["b", "rol"], 0x5a: ["b", "dec"], 0x5c: ["b", "inc"], 0x5d: ["b", "tst"], 0x5f: ["b", "clr"] };
  if (accUnary[opcode]) {
    const [register, op] = accUnary[opcode];
    const next = unary(expected, expected.registers[register], op);
    if (op !== "tst") expected.registers[register] = next;
    expected.cycles = 2;
    return { opcode, documented: true, name: `${op.toUpperCase()} ${register.toUpperCase()}`, bytes: program, expected };
  }

  if (opcode >= 0x60 && opcode <= 0x7f) {
    const indexed = opcode < 0x70;
    const address = indexed ? IX_ADDR : TARGET;
    const opMap = { 0x0: "neg", 0x3: "com", 0x4: "lsr", 0x6: "ror", 0x7: "asr", 0x8: "asl", 0x9: "rol", 0x0a: "dec", 0x0c: "inc", 0x0d: "tst", 0x0f: "clr" };
    const low = opcode & 0x0f;
    if ([0x1, 0x2, 0x5, 0x0b].includes(low)) {
      program = indexed ? bytes(opcode, 0x0f, OFFSET) : bytes(opcode, 0x0f, DIRECT);
      const bitAddress = indexed ? IX_ADDR : DIRECT;
      const before = memGet(expected, bitAddress);
      if (low === 0x1) memSet(expected, bitAddress, before & 0x0f);
      else if (low === 0x2) memSet(expected, bitAddress, before | 0x0f);
      else if (low === 0x5) memSet(expected, bitAddress, before ^ 0x0f);
      logic8(expected, memGet(expected, bitAddress) & 0x0f);
      setPcCycles(PC + 3, indexed ? (low === 0x0b ? 5 : 7) : (low === 0x0b ? 4 : 6));
      return { opcode, documented: true, name: "bit memory operation", bytes: program, expected };
    }
    if (low === 0x0e) {
      program = indexed ? bytes(opcode, OFFSET) : bytes(opcode, TARGET >> 8, TARGET & 0xff);
      setPcCycles(address, 3);
      expected.registers.pc = address;
      return { opcode, documented: true, name: "JMP memory", bytes: program, expected };
    }
    const op = opMap[low];
    program = indexed ? bytes(opcode, OFFSET) : bytes(opcode, TARGET >> 8, TARGET & 0xff);
    const next = unary(expected, memGet(expected, address), op);
    if (op !== "tst") memSet(expected, address, next);
    setPcCycles(indexed ? PC + 2 : PC + 3, indexed ? (op === "tst" ? 4 : 6) : 6);
    return { opcode, documented: true, name: `${op.toUpperCase()} memory`, bytes: program, expected };
  }

  switch (opcode) {
    case 0x01: expected.cycles = 2; return { opcode, documented: true, name: "NOP", bytes: program, expected };
    case 0x04: setD(expected, getD(expected) >> 1); expected.cycles = 3; return { opcode, documented: true, name: "LSRD", bytes: program, expected };
    case 0x05: {
      const before = getD(expected);
      const next = u16(before << 1);
      setD(expected, next);
      expected.registers.cc = ((next & 0x8000) ? FLAG.n : 0) | (next === 0 ? FLAG.z : 0) | ((before & 0x8000) ? FLAG.c : 0);
      if (((next & 0x8000) !== 0) !== ((before & 0x8000) !== 0)) expected.registers.cc |= FLAG.v;
      expected.cycles = 3;
      return { opcode, documented: true, name: "ASLD", bytes: program, expected };
    }
    case 0x06: expected.registers.cc = expected.registers.a; expected.cycles = 2; return { opcode, documented: true, name: "TAP", bytes: program, expected };
    case 0x07: expected.registers.a = expected.registers.cc; expected.cycles = 2; return { opcode, documented: true, name: "TPA", bytes: program, expected };
    case 0x08: expected.registers.x = X + 1; expected.cycles = 4; return { opcode, documented: true, name: "INX", bytes: program, expected };
    case 0x09: expected.registers.x = X - 1; expected.cycles = 4; return { opcode, documented: true, name: "DEX", bytes: program, expected };
    case 0x0a: expected.registers.cc &= ~FLAG.v; expected.cycles = 2; return { opcode, documented: true, name: "CLV", bytes: program, expected };
    case 0x0b: expected.registers.cc |= FLAG.v; expected.cycles = 2; return { opcode, documented: true, name: "SEV", bytes: program, expected };
    case 0x0c: expected.registers.cc &= ~FLAG.c; expected.cycles = 2; return { opcode, documented: true, name: "CLC", bytes: program, expected };
    case 0x0d: expected.registers.cc |= FLAG.c; expected.cycles = 2; return { opcode, documented: true, name: "SEC", bytes: program, expected };
    case 0x0e: expected.registers.cc &= ~FLAG.i; expected.cycles = 2; return { opcode, documented: true, name: "CLI", bytes: program, expected };
    case 0x0f: expected.registers.cc |= FLAG.i; expected.cycles = 2; return { opcode, documented: true, name: "SEI", bytes: program, expected };
    case 0x10: expected.registers.a = sub8(expected, expected.registers.a, expected.registers.b); expected.cycles = 2; return { opcode, documented: true, name: "SBA", bytes: program, expected };
    case 0x11: sub8(expected, expected.registers.a, expected.registers.b); expected.cycles = 2; return { opcode, documented: true, name: "CBA", bytes: program, expected };
    case 0x16: expected.registers.b = logic8(expected, expected.registers.a); expected.cycles = 2; return { opcode, documented: true, name: "TAB", bytes: program, expected };
    case 0x17: expected.registers.a = logic8(expected, expected.registers.b); expected.cycles = 2; return { opcode, documented: true, name: "TBA", bytes: program, expected };
    case 0x18: { const d = getD(expected); setD(expected, X); expected.registers.x = d; expected.cycles = 3; return { opcode, documented: true, name: "XGDX", bytes: program, expected }; }
    case 0x19: expected.cycles = 2; return { opcode, documented: true, name: "DAA neutral", bytes: program, expected };
    case 0x1a: expected.cycles = 4; return { opcode, documented: true, name: "SLP", bytes: program, expected };
    case 0x1b: expected.registers.a = add8(expected, expected.registers.a, expected.registers.b); expected.cycles = 2; return { opcode, documented: true, name: "ABA", bytes: program, expected };
    case 0x30: expected.registers.x = SP + 1; expected.cycles = 3; return { opcode, documented: true, name: "TSX", bytes: program, expected };
    case 0x31: expected.registers.sp = SP + 1; expected.cycles = 3; return { opcode, documented: true, name: "INS", bytes: program, expected };
    case 0x32: expected.registers.sp = SP + 1; expected.registers.a = memGet(expected, SP + 1); expected.cycles = 4; return { opcode, documented: true, name: "PULA", bytes: program, expected };
    case 0x33: expected.registers.sp = SP + 1; expected.registers.b = memGet(expected, SP + 1); expected.cycles = 4; return { opcode, documented: true, name: "PULB", bytes: program, expected };
    case 0x34: expected.registers.sp = SP - 1; expected.cycles = 3; return { opcode, documented: true, name: "DES", bytes: program, expected };
    case 0x35: expected.registers.sp = X - 1; expected.cycles = 3; return { opcode, documented: true, name: "TXS", bytes: program, expected };
    case 0x36: memSet(expected, SP, expected.registers.a); expected.registers.sp = SP - 1; expected.cycles = 4; return { opcode, documented: true, name: "PSHA", bytes: program, expected };
    case 0x37: memSet(expected, SP, expected.registers.b); expected.registers.sp = SP - 1; expected.cycles = 4; return { opcode, documented: true, name: "PSHB", bytes: program, expected };
    case 0x38: expected.registers.sp = SP + 2; expected.registers.x = memWord(expected, SP + 1); expected.cycles = 5; return { opcode, documented: true, name: "PULX", bytes: program, expected };
    case 0x39: expected.registers.sp = SP + 2; expected.registers.pc = RETURN; setPcCycles(RETURN, 5); return { opcode, documented: true, name: "RTS", bytes: program, expected };
    case 0x3a: expected.registers.x = X + expected.registers.b; expected.cycles = 3; return { opcode, documented: true, name: "ABX", bytes: program, expected };
    case 0x3b:
      expected.registers.cc = RETURN >> 8;
      expected.registers.b = RETURN & 0xff;
      expected.registers.a = 0xa3;
      expected.registers.x = 0xa4a5;
      expected.registers.sp = SP + 7;
      expected.registers.pc = TARGET;
      setPcCycles(TARGET, 10);
      return { opcode, documented: true, name: "RTI", bytes: program, expected };
    case 0x3c: memSet(expected, SP, X & 0xff); memSet(expected, SP - 1, X >> 8); expected.registers.sp = SP - 2; expected.cycles = 5; return { opcode, documented: true, name: "PSHX", bytes: program, expected };
    case 0x3d: setD(expected, expected.registers.a * expected.registers.b); expected.cycles = 7; return { opcode, documented: true, name: "MUL", bytes: program, expected };
    case 0x3e: expected.cycles = 9; return { opcode, documented: true, name: "WAI", bytes: program, expected };
    case 0x3f:
      expected.registers.sp = SP - 7;
      expected.registers.pc = TARGET;
      setPcCycles(TARGET, 12);
      return { opcode, documented: true, name: "SWI", bytes: program, expected };
    default:
      break;
  }

  const modeInfo = (() => {
    if (opcode >= 0x80 && opcode <= 0x8f) {
      const word = [0x83, 0x8c, 0x8e].includes(opcode);
      return { mode: "immA", source: 0x12, bytes: word ? bytes(opcode, 0x12, 0x34) : bytes(opcode, 0x12), pc: PC + (word ? 3 : 2), cycles: [0x83, 0x8c].includes(opcode) ? 4 : [0x8d].includes(opcode) ? 7 : [0x8e].includes(opcode) ? 3 : 2 };
    }
    if (opcode >= 0xc0 && opcode <= 0xcf) {
      const word = [0xc3, 0xcc, 0xce].includes(opcode);
      return { mode: "immB", source: 0x12, bytes: word ? bytes(opcode, 0x12, 0x34) : bytes(opcode, 0x12), pc: PC + (word ? 3 : 2), cycles: [0xc3].includes(opcode) ? 4 : [0xcc, 0xce].includes(opcode) ? 3 : 2 };
    }
    if (opcode >= 0x90 && opcode <= 0x9f) return { mode: "dirA", source: memGet(expected, DIRECT), bytes: bytes(opcode, DIRECT), pc: PC + 2, cycles: [0x93, 0x9c].includes(opcode) ? 5 : [0x9d].includes(opcode) ? 7 : [0x9e].includes(opcode) ? 4 : [0x97].includes(opcode) ? 4 : [0x9f].includes(opcode) ? 5 : 3, address: DIRECT };
    if (opcode >= 0xd0 && opcode <= 0xdf) return { mode: "dirB", source: memGet(expected, DIRECT), bytes: bytes(opcode, DIRECT), pc: PC + 2, cycles: [0xd3].includes(opcode) ? 5 : [0xdc, 0xde].includes(opcode) ? 4 : [0xd7].includes(opcode) ? 4 : [0xdd, 0xdf].includes(opcode) ? 5 : 3, address: DIRECT };
    if (opcode >= 0xa0 && opcode <= 0xaf) return { mode: "idxA", source: memGet(expected, IX_ADDR), bytes: bytes(opcode, OFFSET), pc: PC + 2, cycles: [0xa3, 0xac].includes(opcode) ? 5 : [0xad].includes(opcode) ? 7 : [0xae].includes(opcode) ? 5 : [0xa7].includes(opcode) ? 4 : [0xaf].includes(opcode) ? 6 : 4, address: IX_ADDR };
    if (opcode >= 0xe0 && opcode <= 0xef) return { mode: "idxB", source: memGet(expected, IX_ADDR), bytes: bytes(opcode, OFFSET), pc: PC + 2, cycles: [0xe3].includes(opcode) ? 5 : [0xec, 0xee].includes(opcode) ? 5 : [0xe7].includes(opcode) ? 4 : [0xed].includes(opcode) ? 5 : [0xef].includes(opcode) ? 6 : 4, address: IX_ADDR };
    if (opcode >= 0xb0 && opcode <= 0xbf) return { mode: "extA", source: memGet(expected, TARGET), bytes: bytes(opcode, TARGET >> 8, TARGET & 0xff), pc: PC + 3, cycles: [0xb3, 0xbc].includes(opcode) ? 6 : [0xbd].includes(opcode) ? 8 : [0xbe].includes(opcode) ? 6 : [0xb7].includes(opcode) ? 5 : [0xbf].includes(opcode) ? 7 : 4, address: TARGET };
    if (opcode >= 0xf0 && opcode <= 0xff) return { mode: "extB", source: memGet(expected, TARGET), bytes: bytes(opcode, TARGET >> 8, TARGET & 0xff), pc: PC + 3, cycles: [0xf3].includes(opcode) ? 6 : [0xfc].includes(opcode) ? 5 : [0xfe].includes(opcode) ? 6 : [0xf7].includes(opcode) ? 5 : [0xfd].includes(opcode) ? 6 : [0xff].includes(opcode) ? 7 : 4, address: TARGET };
    return null;
  })();

  if (modeInfo) {
    program = modeInfo.bytes;
    const low = opcode & 0x0f;
    if (low <= 0x0b && low !== 0x03 && low !== 0x07) buildBinary(opcode, expected, modeInfo.source, modeInfo.mode);
    else if (low === 0x03) {
      const word = modeInfo.mode.startsWith("imm") ? 0x1234 : memWord(expected, modeInfo.address);
      if (opcode < 0xc0) setD(expected, getD(expected) - word);
      else setD(expected, getD(expected) + word);
    } else if (low === 0x07) {
      const target = opcode < 0xc0 ? "a" : "b";
      memSet(expected, modeInfo.address, expected.registers[target]);
      logic8(expected, expected.registers[target]);
    } else if (low === 0x0c) {
      const word = modeInfo.mode.startsWith("imm") ? 0x1234 : memWord(expected, modeInfo.address);
      if (opcode === 0x8c || opcode === 0x9c || opcode === 0xac || opcode === 0xbc) {
        const result = expected.registers.x - word;
        const value = u16(result);
        expected.registers.cc = ((value & 0x8000) ? FLAG.n : 0) | (value === 0 ? FLAG.z : 0) | (result < 0 ? FLAG.c : 0) | ((((expected.registers.x ^ word) & (expected.registers.x ^ value)) & 0x8000) ? FLAG.v : 0);
      } else {
        setD(expected, word);
      }
    } else if (low === 0x0d) {
      if ([0x8d, 0x9d, 0xad, 0xbd].includes(opcode)) {
        const returnAddress = modeInfo.pc;
        memSet(expected, SP, returnAddress & 0xff);
        memSet(expected, SP - 1, returnAddress >> 8);
        expected.registers.sp = SP - 2;
        expected.registers.pc = modeInfo.address ?? u16(PC + 2 + signed8(0x12));
        setPcCycles(expected.registers.pc, modeInfo.cycles);
        return { opcode, documented: true, name: "JSR/BSR", bytes: program, expected };
      }
      memSetWord(expected, modeInfo.address, getD(expected));
      setNZ16(expected, getD(expected));
    } else if (low === 0x0e) {
      const word = modeInfo.mode.startsWith("imm") ? 0x1234 : memWord(expected, modeInfo.address);
      if (opcode < 0xc0) expected.registers.sp = setNZ16(expected, word);
      else expected.registers.x = setNZ16(expected, word);
    } else if (low === 0x0f) {
      if (opcode < 0xc0) memSetWord(expected, modeInfo.address, expected.registers.sp);
      else memSetWord(expected, modeInfo.address, expected.registers.x);
      setNZ16(expected, opcode < 0xc0 ? expected.registers.sp : expected.registers.x);
    }
    setPcCycles(modeInfo.pc, modeInfo.cycles);
    return { opcode, documented: true, name: `addressing group ${modeInfo.mode}`, bytes: program, expected };
  }

  throw new Error(`No HD6303 fixture for ${hex8(opcode)}`);
};

const applySetup = (cpu, emu, memory, fixture) => {
  const base = createBase();
  memory.load(PC, fixture.bytes);
  for (const [address, value] of base.memory.entries()) memory.writeByte(emu, address, value);
  for (const [register, value] of Object.entries(base.registers)) cpu.setRegister(emu, register, value);
  if (fixture.setup?.cc != null) cpu.setRegister(emu, "cc", fixture.setup.cc);
};

const assertExpected = (cpu, emu, memory, fixture) => {
  const debug = cpu.getDebugState({ historyLength: 1 });
  for (const [register, value] of Object.entries(fixture.expected.registers)) {
    if (register === "pc") continue;
    assert.strictEqual(debug.registers[register], u16(value) & (register === "x" || register === "sp" ? 0xffff : 0xff), `${fixture.name}: register ${register}`);
  }
  assert.strictEqual(debug.registers.pc, fixture.expected.pc, `${fixture.name}: PC`);
  assert.strictEqual(debug.lastOpCycles, fixture.expected.cycles, `${fixture.name}: cycles`);
  for (const [address, value] of fixture.expected.memory.entries()) {
    assert.strictEqual(memory.readByte(emu, address), value, `${fixture.name}: memory ${address.toString(16)}`);
  }
};

describe("Hitachi HD6303 documented opcode semantics", () => {
  for (const opcode of allOpcodes()) {
    const fixture = buildCase(opcode);
    if (!fixture.documented) {
      it(`${hex8(opcode)} is explicitly classified as undefined`, () => {
        assert.strictEqual(fixture.name, "undefined HD6303 opcode");
      });
      continue;
    }
    it(`${hex8(opcode)} ${fixture.name} applies documented state changes`, async () => {
      const memory = createTestMemory();
      const cpu = await createHD6303CPU({ cpu: { initialPc: PC, initialSp: SP, initialX: X } });
      const emu = createTestEmulator(cpu, memory);
      cpu.attach(emu);
      applySetup(cpu, emu, memory, fixture);

      cpu.step(emu);

      assertExpected(cpu, emu, memory, fixture);
    });
  }
});
