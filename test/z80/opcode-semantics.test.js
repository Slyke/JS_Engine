import assert from "assert";
import createZ80CPU from "../../emulator/cpu/z80.js";
import { allOpcodes, createTestEmulator, createTestMemory, emulatorRoot, hex8 } from "../helpers/emulator-harness.js";

// Z80 primary opcode expectations derived from the Zilog Z80 CPU User Manual
// in docs/z80/. Prefix bytes are tested with one documented prefixed operation.
const PC = 0x0200;
const SP = 0x9000;
const HL = 0x4000;
const TARGET = 0x1234;
const RETURN = 0x5678;
const IMM8 = 0x23;
const FLAG = { sign: 0x80, zero: 0x40, halfcarry: 0x10, parity: 0x04, subtract: 0x02, carry: 0x01 };
const REG_NAMES = ["b", "c", "d", "e", "h", "l", "m", "a"];
const PAIRS = ["bc", "de", "hl", "sp"];
const CONDITIONS = ["nz", "z", "nc", "c", "po", "pe", "p", "m"];

const z80Config = {
  cpu: {
    alu: "./cpu/alu/z80.js",
    registers: "./cpu/registers/z80.js",
    control: "./cpu/control/z80.js",
    decoder: "./cpu/decoder/z80.js",
    initialPc: PC,
    initialSp: SP,
  },
};

const u8 = (value) => value & 0xff;
const u16 = (value) => value & 0xffff;
const parityEven = (value) => {
  let bits = value & 0xff;
  bits ^= bits >> 4;
  bits ^= bits >> 2;
  bits ^= bits >> 1;
  return (bits & 1) === 0;
};
const flagByte = ({ sign = false, zero = false, halfcarry = false, parity = false, subtract = false, carry = false } = {}) => (
  (sign ? FLAG.sign : 0)
  | (zero ? FLAG.zero : 0)
  | (halfcarry ? FLAG.halfcarry : 0)
  | (parity ? FLAG.parity : 0)
  | (subtract ? FLAG.subtract : 0)
  | (carry ? FLAG.carry : 0)
);
const szpFlags = (value, extras = {}) => {
  const next = u8(value);
  return flagByte({ sign: (next & 0x80) !== 0, zero: next === 0, parity: parityEven(next), ...extras });
};
const addFlags = (left, right, carry = 0) => {
  const result = left + right + carry;
  const value = u8(result);
  return flagByte({
    sign: (value & 0x80) !== 0,
    zero: value === 0,
    halfcarry: ((left & 0x0f) + (right & 0x0f) + carry) > 0x0f,
    parity: (~(left ^ right) & (left ^ value) & 0x80) !== 0,
    carry: result > 0xff,
  });
};
const subFlags = (left, right, carry = 0) => {
  const result = left - right - carry;
  const value = u8(result);
  return flagByte({
    sign: (value & 0x80) !== 0,
    zero: value === 0,
    halfcarry: ((left ^ right ^ value) & 0x10) !== 0,
    parity: (((left ^ right) & (left ^ value)) & 0x80) !== 0,
    subtract: true,
    carry: result < 0,
  });
};
const conditionFlag = (condition) => ({
  nz: 0,
  z: FLAG.zero,
  nc: 0,
  c: FLAG.carry,
  po: 0,
  pe: FLAG.parity,
  p: 0,
  m: FLAG.sign,
})[condition];
const regValue = (name) => ({ a: 0x42, b: 0x11, c: 0x22, d: 0x33, e: 0x44, h: 0x40, l: 0x00, m: 0x55 })[name];

const createBase = () => ({
  registers: { a: 0x42, f: 0, b: 0x11, c: 0x22, d: 0x33, e: 0x44, h: 0x40, l: 0x00, sp: SP, pc: PC, ix: 0x3000, iy: 0x3100, i: 0x66, r: 0 },
  memory: new Map([[HL, 0x55], [TARGET, 0x77], [u16(TARGET + 1), 0x88], [SP, RETURN & 0xff], [u16(SP + 1), RETURN >> 8], [0x3002, 0x80], [0x3102, 0x80]]),
  pc: PC + 1,
  cycles: 4,
  halted: false,
  interruptEnabled: false,
});
const memoryGet = (state, address) => state.memory.get(u16(address)) ?? 0;
const memorySet = (state, address, value) => state.memory.set(u16(address), u8(value));
const pairValue = (state, pair) => {
  if (pair === "bc") return (state.registers.b << 8) | state.registers.c;
  if (pair === "de") return (state.registers.d << 8) | state.registers.e;
  if (pair === "hl") return (state.registers.h << 8) | state.registers.l;
  if (pair === "sp") return state.registers.sp;
  if (pair === "af") return (state.registers.a << 8) | state.registers.f;
  throw new Error(`Unknown pair ${pair}`);
};
const setPair = (state, pair, value) => {
  const word = u16(value);
  if (pair === "bc") { state.registers.b = word >> 8; state.registers.c = word & 0xff; }
  else if (pair === "de") { state.registers.d = word >> 8; state.registers.e = word & 0xff; }
  else if (pair === "hl") { state.registers.h = word >> 8; state.registers.l = word & 0xff; }
  else if (pair === "sp") state.registers.sp = word;
  else if (pair === "af") { state.registers.a = word >> 8; state.registers.f = word & 0xff; }
};
const testBytes = (opcode, p1 = TARGET & 0xff, p2 = TARGET >> 8, p3 = 0x00) => [opcode, p1, p2, p3, 0x00];

const buildCase = (opcode) => {
  const expected = createBase();
  let bytes = testBytes(opcode);
  let name = `opcode ${hex8(opcode)}`;
  const setPcCycles = (pc, cycles) => { expected.pc = u16(pc); expected.cycles = cycles; };

  if ((opcode & 0xc0) === 0x40) {
    if (opcode === 0x76) {
      expected.halted = true;
      name = "HALT";
      return { opcode, name, bytes, expected };
    }
    const dst = REG_NAMES[(opcode >> 3) & 7];
    const src = REG_NAMES[opcode & 7];
    const value = src === "m" ? memoryGet(expected, HL) : expected.registers[src];
    if (dst === "m") memorySet(expected, HL, value);
    else expected.registers[dst] = value;
    expected.cycles = dst === "m" || src === "m" ? 7 : 4;
    return { opcode, name: `LD ${dst.toUpperCase()},${src.toUpperCase()}`, bytes, expected };
  }

  if ((opcode & 0xc7) === 0x06) {
    const dst = REG_NAMES[(opcode >> 3) & 7];
    bytes = testBytes(opcode, IMM8);
    if (dst === "m") memorySet(expected, HL, IMM8);
    else expected.registers[dst] = IMM8;
    setPcCycles(PC + 2, dst === "m" ? 10 : 7);
    return { opcode, name: `LD ${dst.toUpperCase()},n`, bytes, expected };
  }

  if ((opcode & 0xc7) === 0x04 || (opcode & 0xc7) === 0x05) {
    const inc = (opcode & 0xc7) === 0x04;
    const dst = REG_NAMES[(opcode >> 3) & 7];
    const before = dst === "m" ? memoryGet(expected, HL) : expected.registers[dst];
    const after = u8(before + (inc ? 1 : -1));
    if (dst === "m") memorySet(expected, HL, after);
    else expected.registers[dst] = after;
    expected.registers.f = flagByte({
      sign: (after & 0x80) !== 0,
      zero: after === 0,
      halfcarry: inc ? ((before & 0x0f) + 1) > 0x0f : (before & 0x0f) === 0,
      parity: inc ? before === 0x7f : before === 0x80,
      subtract: !inc,
      carry: false,
    });
    expected.cycles = dst === "m" ? 11 : 4;
    return { opcode, name: `${inc ? "INC" : "DEC"} ${dst.toUpperCase()}`, bytes, expected };
  }

  if ((opcode & 0xc0) === 0x80) {
    const op = (opcode >> 3) & 7;
    const src = REG_NAMES[opcode & 7];
    const value = src === "m" ? memoryGet(expected, HL) : expected.registers[src];
    const a = expected.registers.a;
    const carry = (expected.registers.f & FLAG.carry) ? 1 : 0;
    const names = ["ADD A", "ADC A", "SUB", "SBC A", "AND", "XOR", "OR", "CP"];
    if (op === 0) { expected.registers.a = u8(a + value); expected.registers.f = addFlags(a, value); }
    else if (op === 1) { expected.registers.a = u8(a + value + carry); expected.registers.f = addFlags(a, value, carry); }
    else if (op === 2) { expected.registers.a = u8(a - value); expected.registers.f = subFlags(a, value); }
    else if (op === 3) { expected.registers.a = u8(a - value - carry); expected.registers.f = subFlags(a, value, carry); }
    else if (op === 4) { expected.registers.a = a & value; expected.registers.f = szpFlags(expected.registers.a, { halfcarry: true }); }
    else if (op === 5) { expected.registers.a = a ^ value; expected.registers.f = szpFlags(expected.registers.a); }
    else if (op === 6) { expected.registers.a = a | value; expected.registers.f = szpFlags(expected.registers.a); }
    else expected.registers.f = subFlags(a, value);
    expected.cycles = src === "m" ? 7 : 4;
    return { opcode, name: `${names[op]},${src.toUpperCase()}`, bytes, expected };
  }

  switch (opcode) {
    case 0x00: return { opcode, name: "NOP", bytes, expected };
    case 0x08:
      expected.registers.a = 0x99; expected.registers.f = 0xaa; expected.altAF = 0x4200;
      return { opcode, name: "EX AF,AF'", bytes, setup: { altAF: 0x99aa }, expected };
    case 0x10:
      bytes = testBytes(opcode, 0x02); expected.registers.b = 0x10; setPcCycles(PC + 4, 13);
      return { opcode, name: "DJNZ taken", bytes, expected };
    case 0x18:
      bytes = testBytes(opcode, 0x02); setPcCycles(PC + 4, 12);
      return { opcode, name: "JR", bytes, expected };
    case 0x20: case 0x28: case 0x30: case 0x38: {
      const condition = ["nz", "z", "nc", "c"][(opcode >> 3) & 3];
      bytes = testBytes(opcode, 0x02); expected.registers.f = conditionFlag(condition); setPcCycles(PC + 4, 12);
      return { opcode, name: `JR ${condition.toUpperCase()} taken`, bytes, setup: { f: expected.registers.f }, expected };
    }
    case 0x01: case 0x11: case 0x21: case 0x31: {
      const pair = PAIRS[(opcode >> 4) & 3]; setPair(expected, pair, TARGET); setPcCycles(PC + 3, 10);
      return { opcode, name: `LD ${pair.toUpperCase()},nn`, bytes, expected };
    }
    case 0x02: memorySet(expected, pairValue(expected, "bc"), expected.registers.a); expected.cycles = 7; return { opcode, name: "LD (BC),A", bytes, expected };
    case 0x12: memorySet(expected, pairValue(expected, "de"), expected.registers.a); expected.cycles = 7; return { opcode, name: "LD (DE),A", bytes, expected };
    case 0x0a: expected.registers.a = memoryGet(expected, pairValue(expected, "bc")); expected.cycles = 7; return { opcode, name: "LD A,(BC)", bytes, expected };
    case 0x1a: expected.registers.a = memoryGet(expected, pairValue(expected, "de")); expected.cycles = 7; return { opcode, name: "LD A,(DE)", bytes, expected };
    case 0x03: case 0x13: case 0x23: case 0x33: { const pair = PAIRS[(opcode >> 4) & 3]; setPair(expected, pair, pairValue(expected, pair) + 1); expected.cycles = 6; return { opcode, name: `INC ${pair.toUpperCase()}`, bytes, expected }; }
    case 0x0b: case 0x1b: case 0x2b: case 0x3b: { const pair = PAIRS[(opcode >> 4) & 3]; setPair(expected, pair, pairValue(expected, pair) - 1); expected.cycles = 6; return { opcode, name: `DEC ${pair.toUpperCase()}`, bytes, expected }; }
    case 0x09: case 0x19: case 0x29: case 0x39: { const pair = PAIRS[(opcode >> 4) & 3]; const result = pairValue(expected, "hl") + pairValue(expected, pair); setPair(expected, "hl", result); expected.registers.f = flagByte({ carry: result > 0xffff }); expected.cycles = 11; return { opcode, name: `ADD HL,${pair.toUpperCase()}`, bytes, expected }; }
    case 0x07: { const carry = (expected.registers.a >> 7) & 1; expected.registers.a = u8((expected.registers.a << 1) | carry); expected.registers.f = flagByte({ carry: carry === 1 }); return { opcode, name: "RLCA", bytes, expected }; }
    case 0x0f: { const carry = expected.registers.a & 1; expected.registers.a = u8((carry << 7) | (expected.registers.a >> 1)); expected.registers.f = flagByte({ carry: carry === 1 }); return { opcode, name: "RRCA", bytes, expected }; }
    case 0x17: { const carry = (expected.registers.a >> 7) & 1; expected.registers.a = u8(expected.registers.a << 1); expected.registers.f = flagByte({ carry: carry === 1 }); return { opcode, name: "RLA", bytes, expected }; }
    case 0x1f: { const carry = expected.registers.a & 1; expected.registers.a = u8(expected.registers.a >> 1); expected.registers.f = flagByte({ carry: carry === 1 }); return { opcode, name: "RRA", bytes, expected }; }
    case 0x22: memorySet(expected, TARGET, expected.registers.l); memorySet(expected, TARGET + 1, expected.registers.h); setPcCycles(PC + 3, 16); return { opcode, name: "LD (nn),HL", bytes, expected };
    case 0x2a: expected.registers.l = memoryGet(expected, TARGET); expected.registers.h = memoryGet(expected, TARGET + 1); setPcCycles(PC + 3, 16); return { opcode, name: "LD HL,(nn)", bytes, expected };
    case 0x32: memorySet(expected, TARGET, expected.registers.a); setPcCycles(PC + 3, 13); return { opcode, name: "LD (nn),A", bytes, expected };
    case 0x3a: expected.registers.a = memoryGet(expected, TARGET); setPcCycles(PC + 3, 13); return { opcode, name: "LD A,(nn)", bytes, expected };
    case 0x27: expected.registers.a = 0x10; setPcCycles(PC + 1, 4); return { opcode, name: "DAA", bytes, setup: { a: 0x0a }, expected };
    case 0x2f: expected.registers.a ^= 0xff; expected.registers.f = FLAG.halfcarry | FLAG.subtract; return { opcode, name: "CPL", bytes, expected };
    case 0x37: expected.registers.f = FLAG.carry; return { opcode, name: "SCF", bytes, expected };
    case 0x3f: expected.registers.f = FLAG.carry; return { opcode, name: "CCF", bytes, setup: { f: 0 }, expected };
    case 0xcb:
      bytes = [0xcb, 0x40, 0, 0]; expected.registers.f = FLAG.halfcarry; setPcCycles(PC + 2, 8);
      return { opcode, name: "CB BIT 0,B", bytes, expected };
    case 0xdd:
      bytes = [0xdd, 0x21, TARGET & 0xff, TARGET >> 8]; expected.registers.ix = TARGET; setPcCycles(PC + 4, 14);
      return { opcode, name: "DD LD IX,nn", bytes, expected };
    case 0xed:
      bytes = [0xed, 0x47, 0, 0]; expected.registers.i = expected.registers.a; setPcCycles(PC + 2, 9);
      return { opcode, name: "ED LD I,A", bytes, expected };
    case 0xfd:
      bytes = [0xfd, 0x21, TARGET & 0xff, TARGET >> 8]; expected.registers.iy = TARGET; setPcCycles(PC + 4, 14);
      return { opcode, name: "FD LD IY,nn", bytes, expected };
    case 0xd9:
      expected.registers.b = 0xa1; expected.registers.c = 0xa2; expected.registers.d = 0xa3; expected.registers.e = 0xa4; expected.registers.h = 0xa5; expected.registers.l = 0xa6;
      return { opcode, name: "EXX", bytes, setup: { shadow: true }, expected };
    case 0xe3: { const h = expected.registers.h; const l = expected.registers.l; expected.registers.l = RETURN & 0xff; expected.registers.h = RETURN >> 8; memorySet(expected, SP, l); memorySet(expected, SP + 1, h); expected.cycles = 19; return { opcode, name: "EX (SP),HL", bytes, expected }; }
    case 0xe9: setPcCycles(HL, 4); expected.registers.pc = HL; return { opcode, name: "JP (HL)", bytes, expected };
    case 0xeb: { const de = pairValue(expected, "de"); setPair(expected, "de", pairValue(expected, "hl")); setPair(expected, "hl", de); return { opcode, name: "EX DE,HL", bytes, expected }; }
    case 0xf3: expected.interruptEnabled = false; return { opcode, name: "DI", bytes, setup: { interruptEnabled: true }, expected };
    case 0xf9: expected.registers.sp = HL; expected.cycles = 6; return { opcode, name: "LD SP,HL", bytes, expected };
    case 0xfb: expected.interruptEnabled = true; return { opcode, name: "EI", bytes, expected };
    case 0xd3:
      bytes = testBytes(opcode, 0x06); setPcCycles(PC + 2, 11);
      return { opcode, name: "OUT (n),A", bytes, expected, outputPort: 0x4206 };
    case 0xdb:
      bytes = testBytes(opcode, 0x06); expected.registers.a = 0x5a; setPcCycles(PC + 2, 11);
      return { opcode, name: "IN A,(n)", bytes, expected, inputPort: 0x4206, inputValue: 0x5a };
    case 0xc3: expected.registers.pc = TARGET; setPcCycles(TARGET, 10); return { opcode, name: "JP nn", bytes, expected };
    case 0xcd: expected.registers.sp = SP - 2; memorySet(expected, SP - 2, (PC + 3) & 0xff); memorySet(expected, SP - 1, (PC + 3) >> 8); expected.registers.pc = TARGET; setPcCycles(TARGET, 17); return { opcode, name: "CALL nn", bytes, expected };
    case 0xc9: expected.registers.sp = SP + 2; expected.registers.pc = RETURN; setPcCycles(RETURN, 10); return { opcode, name: "RET", bytes, expected };
    default:
      break;
  }

  if ((opcode & 0xc7) === 0xc0) {
    const condition = CONDITIONS[(opcode >> 3) & 7]; expected.registers.f = conditionFlag(condition); expected.registers.sp = SP + 2; expected.registers.pc = RETURN; setPcCycles(RETURN, 11);
    return { opcode, name: `RET ${condition.toUpperCase()} taken`, bytes, setup: { f: expected.registers.f }, expected };
  }
  if ((opcode & 0xc7) === 0xc2) {
    const condition = CONDITIONS[(opcode >> 3) & 7]; expected.registers.f = conditionFlag(condition); expected.registers.pc = TARGET; setPcCycles(TARGET, 10);
    return { opcode, name: `JP ${condition.toUpperCase()},nn taken`, bytes, setup: { f: expected.registers.f }, expected };
  }
  if ((opcode & 0xc7) === 0xc4) {
    const condition = CONDITIONS[(opcode >> 3) & 7]; expected.registers.f = conditionFlag(condition); expected.registers.sp = SP - 2; memorySet(expected, SP - 2, (PC + 3) & 0xff); memorySet(expected, SP - 1, (PC + 3) >> 8); expected.registers.pc = TARGET; setPcCycles(TARGET, 17);
    return { opcode, name: `CALL ${condition.toUpperCase()},nn taken`, bytes, setup: { f: expected.registers.f }, expected };
  }
  if ((opcode & 0xc7) === 0xc7) {
    const target = opcode & 0x38; expected.registers.sp = SP - 2; memorySet(expected, SP - 2, (PC + 1) & 0xff); memorySet(expected, SP - 1, (PC + 1) >> 8); expected.registers.pc = target; setPcCycles(target, 11);
    return { opcode, name: `RST ${target}`, bytes, expected };
  }
  if ((opcode & 0xcf) === 0xc1) {
    const pair = opcode === 0xf1 ? "af" : PAIRS[(opcode >> 4) & 3]; setPair(expected, pair, RETURN); expected.registers.sp = SP + 2; expected.cycles = 10;
    return { opcode, name: `POP ${pair.toUpperCase()}`, bytes, expected };
  }
  if ((opcode & 0xcf) === 0xc5) {
    const pair = opcode === 0xf5 ? "af" : PAIRS[(opcode >> 4) & 3]; const value = pairValue(expected, pair); expected.registers.sp = SP - 2; memorySet(expected, SP - 2, value & 0xff); memorySet(expected, SP - 1, value >> 8); expected.cycles = 11;
    return { opcode, name: `PUSH ${pair.toUpperCase()}`, bytes, expected };
  }
  if ([0xc6, 0xce, 0xd6, 0xde, 0xe6, 0xee, 0xf6, 0xfe].includes(opcode)) {
    bytes = testBytes(opcode, IMM8);
    const a = expected.registers.a; const carry = (expected.registers.f & FLAG.carry) ? 1 : 0;
    if (opcode === 0xc6) { expected.registers.a = u8(a + IMM8); expected.registers.f = addFlags(a, IMM8); }
    else if (opcode === 0xce) { expected.registers.a = u8(a + IMM8 + carry); expected.registers.f = addFlags(a, IMM8, carry); }
    else if (opcode === 0xd6) { expected.registers.a = u8(a - IMM8); expected.registers.f = subFlags(a, IMM8); }
    else if (opcode === 0xde) { expected.registers.a = u8(a - IMM8 - carry); expected.registers.f = subFlags(a, IMM8, carry); }
    else if (opcode === 0xe6) { expected.registers.a = a & IMM8; expected.registers.f = szpFlags(expected.registers.a, { halfcarry: true }); }
    else if (opcode === 0xee) { expected.registers.a = a ^ IMM8; expected.registers.f = szpFlags(expected.registers.a); }
    else if (opcode === 0xf6) { expected.registers.a = a | IMM8; expected.registers.f = szpFlags(expected.registers.a); }
    else expected.registers.f = subFlags(a, IMM8);
    setPcCycles(PC + 2, 7);
    return { opcode, name: "immediate ALU", bytes, expected };
  }
  throw new Error(`No Z80 semantic fixture for ${hex8(opcode)}`);
};

const applySetup = (cpu, emu, memory, fixture) => {
  const base = createBase();
  memory.load(PC, fixture.bytes);
  for (const [address, value] of base.memory.entries()) memory.writeByte(emu, address, value);
  for (const [register, value] of Object.entries(base.registers)) cpu.setRegister(emu, register, value);
  if (fixture.setup?.a != null) cpu.setRegister(emu, "a", fixture.setup.a);
  if (fixture.setup?.f != null) cpu.setRegister(emu, "f", fixture.setup.f);
  if (fixture.setup?.altAF != null) cpu.setAltAF(emu, fixture.setup.altAF);
  if (fixture.setup?.shadow) {
    Object.assign(cpu.registers, { b_: 0xa1, c_: 0xa2, d_: 0xa3, e_: 0xa4, h_: 0xa5, l_: 0xa6 });
  }
  if (fixture.setup?.interruptEnabled) cpu.setInterruptEnabled?.(emu, true);
  if (fixture.inputPort != null) emu.io.raw[fixture.inputPort] = fixture.inputValue;
};

const assertExpected = (cpu, emu, memory, fixture) => {
  const debug = cpu.getDebugState({ historyLength: 1 });
  for (const [register, value] of Object.entries(fixture.expected.registers)) {
    if (register === "pc" || register === "r") continue;
    assert.strictEqual(debug.registers[register], value, `${fixture.name}: register ${register}`);
  }
  for (const [address, value] of fixture.expected.memory.entries()) {
    assert.strictEqual(memory.readByte(emu, address), value, `${fixture.name}: memory ${address.toString(16)}`);
  }
  assert.strictEqual(debug.registers.pc, fixture.expected.pc, `${fixture.name}: PC`);
  assert.strictEqual(debug.lastOpCycles, fixture.expected.cycles, `${fixture.name}: cycles`);
  assert.strictEqual(debug.halted, fixture.expected.halted, `${fixture.name}: halted`);
  assert.strictEqual(debug.interruptEnabled, fixture.expected.interruptEnabled, `${fixture.name}: interrupt enabled`);
  if (fixture.outputPort != null) assert.strictEqual(emu.io.raw[fixture.outputPort], fixture.expected.registers.a, `${fixture.name}: output port`);
  if (fixture.expected.altAF != null) assert.strictEqual(cpu.getAltAF(emu), fixture.expected.altAF, `${fixture.name}: alternate AF`);
};

describe("Z80 documented primary opcode semantics", () => {
  for (const opcode of allOpcodes()) {
    const fixture = buildCase(opcode);
    it(`${hex8(opcode)} ${fixture.name} applies documented state changes`, async () => {
      const memory = createTestMemory();
      const cpu = await createZ80CPU(z80Config, emulatorRoot);
      const emu = createTestEmulator(cpu, memory, z80Config);
      cpu.attach(emu);
      applySetup(cpu, emu, memory, fixture);

      cpu.step(emu);

      assertExpected(cpu, emu, memory, fixture);
    });
  }
});

describe("Z80 platform-specific HALT handling", () => {
  it("pushes the return address and vectors when interruptOnHalt is configured", async () => {
    const config = {
      cpu: {
        ...z80Config.cpu,
        interruptOnHalt: true,
        haltInterruptVector: 0x0038,
      },
    };
    const memory = createTestMemory();
    memory.load(PC, [0x76]);
    const cpu = await createZ80CPU(config, emulatorRoot);
    const emu = createTestEmulator(cpu, memory, config);
    cpu.attach(emu);
    cpu.setRegister(emu, "pc", PC);
    cpu.setRegister(emu, "sp", SP);

    cpu.step(emu);

    const debug = cpu.getDebugState();
    assert.strictEqual(debug.halted, false);
    assert.strictEqual(debug.registers.pc, 0x0038);
    assert.strictEqual(debug.registers.sp, SP - 2);
    assert.strictEqual(memory.readByte(emu, SP - 2), (PC + 1) & 0xff);
    assert.strictEqual(memory.readByte(emu, SP - 1), (PC + 1) >> 8);
    assert.strictEqual(debug.lastOpCycles, 11);
  });
});

describe("Z80 indexed memory opcodes", () => {
  it("executes DEC (IY+d)", async () => {
    const memory = createTestMemory();
    memory.load(PC, [0xfd, 0x35, 0x23]);
    const cpu = await createZ80CPU(z80Config, emulatorRoot);
    const emu = createTestEmulator(cpu, memory, z80Config);
    cpu.attach(emu);
    cpu.setRegister(emu, "pc", PC);
    cpu.setRegister(emu, "iy", 0x4000);
    cpu.setRegister(emu, "f", FLAG.carry);
    memory.writeByte(emu, 0x4023, 0x01);

    cpu.step(emu);

    const debug = cpu.getDebugState();
    assert.strictEqual(memory.readByte(emu, 0x4023), 0x00);
    assert.strictEqual(debug.registers.f, FLAG.zero | FLAG.subtract | FLAG.carry);
    assert.strictEqual(debug.registers.pc, PC + 3);
    assert.strictEqual(debug.lastOpCycles, 23);
  });

  it("executes INC (IX+d)", async () => {
    const memory = createTestMemory();
    memory.load(PC, [0xdd, 0x34, 0xfe]);
    const cpu = await createZ80CPU(z80Config, emulatorRoot);
    const emu = createTestEmulator(cpu, memory, z80Config);
    cpu.attach(emu);
    cpu.setRegister(emu, "pc", PC);
    cpu.setRegister(emu, "ix", 0x4002);
    cpu.setRegister(emu, "f", FLAG.carry);
    memory.writeByte(emu, 0x4000, 0x7f);

    cpu.step(emu);

    const debug = cpu.getDebugState();
    assert.strictEqual(memory.readByte(emu, 0x4000), 0x80);
    assert.strictEqual(debug.registers.f, FLAG.sign | FLAG.halfcarry | FLAG.parity | FLAG.carry);
    assert.strictEqual(debug.registers.pc, PC + 3);
    assert.strictEqual(debug.lastOpCycles, 23);
  });
});

describe("Z80 ED block transfer opcodes", () => {
  it("repeats LDIR until BC reaches zero", async () => {
    const memory = createTestMemory();
    memory.load(PC, [0xed, 0xb0]);
    memory.writeByte(null, 0x4100, 0xaa);
    memory.writeByte(null, 0x4101, 0xbb);
    const cpu = await createZ80CPU(z80Config, emulatorRoot);
    const emu = createTestEmulator(cpu, memory, z80Config);
    cpu.attach(emu);
    cpu.setRegister(emu, "pc", PC);
    cpu.setRegister(emu, "b", 0x00);
    cpu.setRegister(emu, "c", 0x02);
    cpu.setRegister(emu, "d", 0x42);
    cpu.setRegister(emu, "e", 0x00);
    cpu.setRegister(emu, "h", 0x41);
    cpu.setRegister(emu, "l", 0x00);

    cpu.step(emu);

    let debug = cpu.getDebugState();
    assert.strictEqual(memory.readByte(emu, 0x4200), 0xaa);
    assert.strictEqual(debug.registers.pc, PC);
    assert.strictEqual(debug.registers.b, 0x00);
    assert.strictEqual(debug.registers.c, 0x01);
    assert.strictEqual(debug.registers.h, 0x41);
    assert.strictEqual(debug.registers.l, 0x01);
    assert.strictEqual(debug.registers.d, 0x42);
    assert.strictEqual(debug.registers.e, 0x01);
    assert.strictEqual(debug.registers.f & FLAG.parity, FLAG.parity);
    assert.strictEqual(debug.lastOpCycles, 21);

    cpu.step(emu);

    debug = cpu.getDebugState();
    assert.strictEqual(memory.readByte(emu, 0x4201), 0xbb);
    assert.strictEqual(debug.registers.pc, PC + 2);
    assert.strictEqual(debug.registers.b, 0x00);
    assert.strictEqual(debug.registers.c, 0x00);
    assert.strictEqual(debug.registers.f & FLAG.parity, 0);
    assert.strictEqual(debug.lastOpCycles, 16);
  });

  it("executes single-step LDDR", async () => {
    const memory = createTestMemory();
    memory.load(PC, [0xed, 0xb8]);
    memory.writeByte(null, 0x4102, 0xcc);
    const cpu = await createZ80CPU(z80Config, emulatorRoot);
    const emu = createTestEmulator(cpu, memory, z80Config);
    cpu.attach(emu);
    cpu.setRegister(emu, "pc", PC);
    cpu.setRegister(emu, "b", 0x00);
    cpu.setRegister(emu, "c", 0x01);
    cpu.setRegister(emu, "d", 0x42);
    cpu.setRegister(emu, "e", 0x02);
    cpu.setRegister(emu, "h", 0x41);
    cpu.setRegister(emu, "l", 0x02);
    cpu.setRegister(emu, "f", FLAG.zero | FLAG.carry);

    cpu.step(emu);

    const debug = cpu.getDebugState();
    assert.strictEqual(memory.readByte(emu, 0x4202), 0xcc);
    assert.strictEqual(debug.registers.pc, PC + 2);
    assert.strictEqual(debug.registers.b, 0x00);
    assert.strictEqual(debug.registers.c, 0x00);
    assert.strictEqual(debug.registers.h, 0x41);
    assert.strictEqual(debug.registers.l, 0x01);
    assert.strictEqual(debug.registers.d, 0x42);
    assert.strictEqual(debug.registers.e, 0x01);
    assert.strictEqual(debug.registers.f, FLAG.zero | FLAG.carry);
    assert.strictEqual(debug.lastOpCycles, 16);
  });
});
