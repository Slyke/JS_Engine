import assert from "assert";
import createI8080CPU from "../../emulator/cpu/i8080.js";
import { FLAG } from "../../emulator/cpu/registers/i8080.js";
import { allOpcodes, createTestEmulator, createTestMemory, hex8 } from "../helpers/emulator-harness.js";

// Intel 8080 semantic expectations derived from the Intel 8080 Microcomputer
// Systems User's Manual in docs/i8080/.
const PC = 0x0200;
const SP = 0x9000;
const HL = 0x4000;
const TARGET = 0x1234;
const RETURN = 0x5678;
const IMM8 = 0x23;
const REG_NAMES = ["b", "c", "d", "e", "h", "l", "m", "a"];
const PAIRS = ["bc", "de", "hl", "sp"];
const CONDITIONS = ["nz", "z", "nc", "c", "po", "pe", "p", "m"];
const UNDOCUMENTED = new Set([0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38, 0xcb, 0xd9, 0xdd, 0xed, 0xfd]);

const u8 = (value) => value & 0xff;
const u16 = (value) => value & 0xffff;
const parityEven = (value) => {
  let bits = value & 0xff;
  bits ^= bits >> 4;
  bits &= 0x0f;
  return ((0x6996 >> bits) & 1) === 0;
};

const flagByte = ({ sign = false, zero = false, halfcarry = false, parity = false, carry = false } = {}) => (
  0x02
  | (sign ? FLAG.sign : 0)
  | (zero ? FLAG.zero : 0)
  | (halfcarry ? FLAG.halfcarry : 0)
  | (parity ? FLAG.parity : 0)
  | (carry ? FLAG.carry : 0)
);

const szpFlags = (value, extras = {}) => {
  const next = u8(value);
  return flagByte({
    sign: (next & 0x80) !== 0,
    zero: next === 0,
    parity: parityEven(next),
    ...extras,
  });
};

const addFlags = (left, right, carry = 0) => {
  const result = left + right + carry;
  return szpFlags(result, {
    carry: result > 0xff,
    halfcarry: ((left & 0x0f) + (right & 0x0f) + carry) > 0x0f,
  });
};

const subFlags = (left, right, borrow = 0) => {
  const result = left - right - borrow;
  const out = u8(result);
  return szpFlags(out, {
    carry: result < 0,
    halfcarry: ((left ^ right ^ out) & 0x10) !== 0,
  });
};

const conditionFlag = (condition) => ({
  nz: 0x02,
  z: FLAG.zero | 0x02,
  nc: 0x02,
  c: FLAG.carry | 0x02,
  po: 0x02,
  pe: FLAG.parity | 0x02,
  p: 0x02,
  m: FLAG.sign | 0x02,
})[condition];

const regValue = (name) => ({
  a: 0x42,
  b: 0x11,
  c: 0x22,
  d: 0x33,
  e: 0x44,
  h: 0x40,
  l: 0x00,
  m: 0x55,
})[name];

const pairValue = (pair) => ({
  bc: 0x1122,
  de: 0x3344,
  hl: HL,
  sp: SP,
  psw: 0x4202,
})[pair];

const setPairExpected = (expected, pair, value) => {
  const word = u16(value);
  if (pair === "bc") {
    expected.registers.b = word >> 8;
    expected.registers.c = word & 0xff;
  } else if (pair === "de") {
    expected.registers.d = word >> 8;
    expected.registers.e = word & 0xff;
  } else if (pair === "hl") {
    expected.registers.h = word >> 8;
    expected.registers.l = word & 0xff;
  } else if (pair === "sp") {
    expected.registers.sp = word;
  } else if (pair === "psw") {
    expected.registers.a = word >> 8;
    expected.registers.f = (word & 0xd7) | 0x02;
  }
};

const getExpectedPair = (expected, pair) => {
  if (pair === "bc") return (expected.registers.b << 8) | expected.registers.c;
  if (pair === "de") return (expected.registers.d << 8) | expected.registers.e;
  if (pair === "hl") return (expected.registers.h << 8) | expected.registers.l;
  if (pair === "sp") return expected.registers.sp;
  if (pair === "psw") return (expected.registers.a << 8) | (expected.registers.f | 0x02);
  throw new Error(`Unknown pair ${pair}`);
};

const createBase = () => ({
  registers: {
    a: regValue("a"),
    f: 0x02,
    b: regValue("b"),
    c: regValue("c"),
    d: regValue("d"),
    e: regValue("e"),
    h: regValue("h"),
    l: regValue("l"),
    sp: SP,
    pc: PC,
  },
  memory: new Map([
    [HL, regValue("m")],
    [TARGET, 0x77],
    [u16(TARGET + 1), 0x88],
    [pairValue("bc"), 0xb1],
    [pairValue("de"), 0xd1],
    [SP, RETURN & 0xff],
    [u16(SP + 1), RETURN >> 8],
  ]),
  interruptEnabled: false,
  halted: false,
  pc: PC + 1,
  cycles: 4,
});

const memoryGet = (state, address) => state.memory.get(u16(address)) ?? 0x00;
const memorySet = (state, address, value) => state.memory.set(u16(address), u8(value));

const testBytes = (opcode, p1 = IMM8, p2 = TARGET >> 8) => [opcode, p1, p2, 0x00];

const buildCase = (opcode) => {
  if (UNDOCUMENTED.has(opcode)) return { opcode, documented: false, name: "undocumented by Intel 8080 manual" };

  const expected = createBase();
  let bytes = testBytes(opcode, TARGET & 0xff, TARGET >> 8);
  const nameParts = [];
  const setPcCycles = (pc, cycles) => {
    expected.pc = u16(pc);
    expected.cycles = cycles;
  };

  if ((opcode & 0xc0) === 0x40) {
    if (opcode === 0x76) {
      expected.halted = true;
      expected.cycles = 7;
      return { opcode, documented: true, name: "HLT", bytes, expected };
    }
    const dst = REG_NAMES[(opcode >> 3) & 7];
    const src = REG_NAMES[opcode & 7];
    nameParts.push(`MOV ${dst.toUpperCase()},${src.toUpperCase()}`);
    const value = src === "m" ? memoryGet(expected, HL) : expected.registers[src];
    if (dst === "m") memorySet(expected, HL, value);
    else expected.registers[dst] = value;
    expected.cycles = dst === "m" || src === "m" ? 7 : 5;
    return { opcode, documented: true, name: nameParts.join(" "), bytes, expected };
  }

  if ((opcode & 0xc7) === 0x06) {
    const dst = REG_NAMES[(opcode >> 3) & 7];
    bytes = testBytes(opcode, IMM8);
    if (dst === "m") memorySet(expected, HL, IMM8);
    else expected.registers[dst] = IMM8;
    setPcCycles(PC + 2, dst === "m" ? 10 : 7);
    return { opcode, documented: true, name: `MVI ${dst.toUpperCase()}`, bytes, expected };
  }

  if ((opcode & 0xc7) === 0x04) {
    const dst = REG_NAMES[(opcode >> 3) & 7];
    const before = dst === "m" ? memoryGet(expected, HL) : expected.registers[dst];
    const after = u8(before + 1);
    if (dst === "m") memorySet(expected, HL, after);
    else expected.registers[dst] = after;
    expected.registers.f = szpFlags(after, {
      halfcarry: ((before & 0x0f) + 1) > 0x0f,
      carry: (expected.registers.f & FLAG.carry) !== 0,
    });
    expected.cycles = dst === "m" ? 10 : 5;
    return { opcode, documented: true, name: `INR ${dst.toUpperCase()}`, bytes, expected };
  }

  if ((opcode & 0xc7) === 0x05) {
    const dst = REG_NAMES[(opcode >> 3) & 7];
    const before = dst === "m" ? memoryGet(expected, HL) : expected.registers[dst];
    const after = u8(before - 1);
    if (dst === "m") memorySet(expected, HL, after);
    else expected.registers[dst] = after;
    expected.registers.f = szpFlags(after, {
      halfcarry: (before & 0x0f) === 0,
      carry: (expected.registers.f & FLAG.carry) !== 0,
    });
    expected.cycles = dst === "m" ? 10 : 5;
    return { opcode, documented: true, name: `DCR ${dst.toUpperCase()}`, bytes, expected };
  }

  if ((opcode & 0xc0) === 0x80) {
    const op = (opcode >> 3) & 7;
    const src = REG_NAMES[opcode & 7];
    const value = src === "m" ? memoryGet(expected, HL) : expected.registers[src];
    const carry = (expected.registers.f & FLAG.carry) ? 1 : 0;
    const a = expected.registers.a;
    const names = ["ADD", "ADC", "SUB", "SBB", "ANA", "XRA", "ORA", "CMP"];
    if (op === 0) {
      expected.registers.a = u8(a + value);
      expected.registers.f = addFlags(a, value);
    } else if (op === 1) {
      expected.registers.a = u8(a + value + carry);
      expected.registers.f = addFlags(a, value, carry);
    } else if (op === 2) {
      expected.registers.a = u8(a - value);
      expected.registers.f = subFlags(a, value);
    } else if (op === 3) {
      expected.registers.a = u8(a - value - carry);
      expected.registers.f = subFlags(a, value, carry);
    } else if (op === 4) {
      expected.registers.a = a & value;
      expected.registers.f = szpFlags(expected.registers.a, { halfcarry: true });
    } else if (op === 5) {
      expected.registers.a = a ^ value;
      expected.registers.f = szpFlags(expected.registers.a);
    } else if (op === 6) {
      expected.registers.a = a | value;
      expected.registers.f = szpFlags(expected.registers.a);
    } else {
      expected.registers.f = subFlags(a, value);
    }
    expected.cycles = src === "m" ? 7 : 4;
    return { opcode, documented: true, name: `${names[op]} ${src.toUpperCase()}`, bytes, expected };
  }

  switch (opcode) {
    case 0x00:
      return { opcode, documented: true, name: "NOP", bytes, expected };
    case 0x01: case 0x11: case 0x21: case 0x31: {
      const pair = PAIRS[(opcode >> 4) & 3];
      setPairExpected(expected, pair, TARGET);
      setPcCycles(PC + 3, 10);
      return { opcode, documented: true, name: `LXI ${pair.toUpperCase()}`, bytes, expected };
    }
    case 0x02:
      memorySet(expected, pairValue("bc"), expected.registers.a);
      expected.cycles = 7;
      return { opcode, documented: true, name: "STAX B", bytes, expected };
    case 0x12:
      memorySet(expected, pairValue("de"), expected.registers.a);
      expected.cycles = 7;
      return { opcode, documented: true, name: "STAX D", bytes, expected };
    case 0x0a:
      expected.registers.a = memoryGet(expected, pairValue("bc"));
      expected.cycles = 7;
      return { opcode, documented: true, name: "LDAX B", bytes, expected };
    case 0x1a:
      expected.registers.a = memoryGet(expected, pairValue("de"));
      expected.cycles = 7;
      return { opcode, documented: true, name: "LDAX D", bytes, expected };
    case 0x03: case 0x13: case 0x23: case 0x33: {
      const pair = PAIRS[(opcode >> 4) & 3];
      setPairExpected(expected, pair, getExpectedPair(expected, pair) + 1);
      expected.cycles = 5;
      return { opcode, documented: true, name: `INX ${pair.toUpperCase()}`, bytes, expected };
    }
    case 0x0b: case 0x1b: case 0x2b: case 0x3b: {
      const pair = PAIRS[(opcode >> 4) & 3];
      setPairExpected(expected, pair, getExpectedPair(expected, pair) - 1);
      expected.cycles = 5;
      return { opcode, documented: true, name: `DCX ${pair.toUpperCase()}`, bytes, expected };
    }
    case 0x09: case 0x19: case 0x29: case 0x39: {
      const pair = PAIRS[(opcode >> 4) & 3];
      const result = getExpectedPair(expected, "hl") + getExpectedPair(expected, pair);
      setPairExpected(expected, "hl", result);
      expected.registers.f = flagByte({ carry: result > 0xffff });
      expected.cycles = 10;
      return { opcode, documented: true, name: `DAD ${pair.toUpperCase()}`, bytes, expected };
    }
    case 0x07: {
      const carry = (expected.registers.a >> 7) & 1;
      expected.registers.a = u8((expected.registers.a << 1) | carry);
      expected.registers.f = flagByte({ carry: carry === 1 });
      return { opcode, documented: true, name: "RLC", bytes, expected };
    }
    case 0x0f: {
      const carry = expected.registers.a & 1;
      expected.registers.a = u8((carry << 7) | (expected.registers.a >> 1));
      expected.registers.f = flagByte({ carry: carry === 1 });
      return { opcode, documented: true, name: "RRC", bytes, expected };
    }
    case 0x17: {
      const carryIn = (expected.registers.f & FLAG.carry) ? 1 : 0;
      const carry = (expected.registers.a >> 7) & 1;
      expected.registers.a = u8((expected.registers.a << 1) | carryIn);
      expected.registers.f = flagByte({ carry: carry === 1 });
      return { opcode, documented: true, name: "RAL", bytes, expected };
    }
    case 0x1f: {
      const carryIn = (expected.registers.f & FLAG.carry) ? 0x80 : 0;
      const carry = expected.registers.a & 1;
      expected.registers.a = u8(carryIn | (expected.registers.a >> 1));
      expected.registers.f = flagByte({ carry: carry === 1 });
      return { opcode, documented: true, name: "RAR", bytes, expected };
    }
    case 0x22:
      memorySet(expected, TARGET, expected.registers.l);
      memorySet(expected, TARGET + 1, expected.registers.h);
      setPcCycles(PC + 3, 16);
      return { opcode, documented: true, name: "SHLD", bytes, expected };
    case 0x2a:
      expected.registers.l = memoryGet(expected, TARGET);
      expected.registers.h = memoryGet(expected, TARGET + 1);
      setPcCycles(PC + 3, 16);
      return { opcode, documented: true, name: "LHLD", bytes, expected };
    case 0x32:
      memorySet(expected, TARGET, expected.registers.a);
      setPcCycles(PC + 3, 13);
      return { opcode, documented: true, name: "STA", bytes, expected };
    case 0x3a:
      expected.registers.a = memoryGet(expected, TARGET);
      setPcCycles(PC + 3, 13);
      return { opcode, documented: true, name: "LDA", bytes, expected };
    case 0x27: {
      expected.registers.a = 0x10;
      expected.registers.f = szpFlags(0x10, { halfcarry: true });
      return { opcode, documented: true, name: "DAA", bytes, setup: { a: 0x0a, f: 0x02 }, expected };
    }
    case 0x2f:
      expected.registers.a ^= 0xff;
      return { opcode, documented: true, name: "CMA", bytes, expected };
    case 0x37:
      expected.registers.f = 0x02 | FLAG.carry;
      return { opcode, documented: true, name: "STC", bytes, expected };
    case 0x3f:
      expected.registers.f = 0x02 | FLAG.carry;
      return { opcode, documented: true, name: "CMC", bytes, setup: { f: 0x02 }, expected };
    case 0xc1: case 0xd1: case 0xe1:
    case 0xf1: {
      const pair = opcode === 0xf1 ? "psw" : PAIRS[(opcode >> 4) & 3];
      setPairExpected(expected, pair, RETURN);
      expected.registers.sp = SP + 2;
      expected.cycles = 10;
      return { opcode, documented: true, name: `POP ${pair.toUpperCase()}`, bytes, expected };
    }
    case 0xc5: case 0xd5: case 0xe5:
    case 0xf5: {
      const pair = opcode === 0xf5 ? "psw" : PAIRS[(opcode >> 4) & 3];
      const value = getExpectedPair(expected, pair);
      expected.registers.sp = SP - 2;
      memorySet(expected, SP - 2, value & 0xff);
      memorySet(expected, SP - 1, value >> 8);
      expected.cycles = 11;
      return { opcode, documented: true, name: `PUSH ${pair.toUpperCase()}`, bytes, expected };
    }
    case 0xc9:
      expected.registers.pc = RETURN;
      expected.registers.sp = SP + 2;
      expected.pc = RETURN;
      expected.cycles = 10;
      return { opcode, documented: true, name: "RET", bytes, expected };
    case 0xc3:
      expected.registers.pc = TARGET;
      setPcCycles(TARGET, 10);
      return { opcode, documented: true, name: "JMP", bytes, expected };
    case 0xcd:
      expected.registers.sp = SP - 2;
      memorySet(expected, SP - 2, (PC + 3) & 0xff);
      memorySet(expected, SP - 1, (PC + 3) >> 8);
      expected.registers.pc = TARGET;
      setPcCycles(TARGET, 17);
      return { opcode, documented: true, name: "CALL", bytes, expected };
    case 0xc6: case 0xce: case 0xd6: case 0xde:
    case 0xe6: case 0xee: case 0xf6: case 0xfe: {
      bytes = testBytes(opcode, IMM8);
      const a = expected.registers.a;
      const carry = (expected.registers.f & FLAG.carry) ? 1 : 0;
      const ops = { 0xc6: "ADI", 0xce: "ACI", 0xd6: "SUI", 0xde: "SBI", 0xe6: "ANI", 0xee: "XRI", 0xf6: "ORI", 0xfe: "CPI" };
      if (opcode === 0xc6) {
        expected.registers.a = u8(a + IMM8);
        expected.registers.f = addFlags(a, IMM8);
      } else if (opcode === 0xce) {
        expected.registers.a = u8(a + IMM8 + carry);
        expected.registers.f = addFlags(a, IMM8, carry);
      } else if (opcode === 0xd6) {
        expected.registers.a = u8(a - IMM8);
        expected.registers.f = subFlags(a, IMM8);
      } else if (opcode === 0xde) {
        expected.registers.a = u8(a - IMM8 - carry);
        expected.registers.f = subFlags(a, IMM8, carry);
      } else if (opcode === 0xe6) {
        expected.registers.a = a & IMM8;
        expected.registers.f = szpFlags(expected.registers.a, { halfcarry: true });
      } else if (opcode === 0xee) {
        expected.registers.a = a ^ IMM8;
        expected.registers.f = szpFlags(expected.registers.a);
      } else if (opcode === 0xf6) {
        expected.registers.a = a | IMM8;
        expected.registers.f = szpFlags(expected.registers.a);
      } else {
        expected.registers.f = subFlags(a, IMM8);
      }
      setPcCycles(PC + 2, 7);
      return { opcode, documented: true, name: ops[opcode], bytes, expected };
    }
    case 0xd3:
      bytes = testBytes(opcode, 0x06);
      setPcCycles(PC + 2, 10);
      return { opcode, documented: true, name: "OUT", bytes, expected, outputPort: 0x06 };
    case 0xdb:
      bytes = testBytes(opcode, 0x01);
      expected.registers.a = 0x09;
      setPcCycles(PC + 2, 10);
      return { opcode, documented: true, name: "IN", bytes, expected, input: "coin" };
    case 0xe3: {
      const oldL = expected.registers.l;
      const oldH = expected.registers.h;
      expected.registers.l = RETURN & 0xff;
      expected.registers.h = RETURN >> 8;
      memorySet(expected, SP, oldL);
      memorySet(expected, SP + 1, oldH);
      expected.cycles = 18;
      return { opcode, documented: true, name: "XTHL", bytes, expected };
    }
    case 0xe9:
      expected.registers.pc = HL;
      setPcCycles(HL, 5);
      return { opcode, documented: true, name: "PCHL", bytes, expected };
    case 0xeb: {
      const de = getExpectedPair(expected, "de");
      setPairExpected(expected, "de", getExpectedPair(expected, "hl"));
      setPairExpected(expected, "hl", de);
      expected.cycles = 5;
      return { opcode, documented: true, name: "XCHG", bytes, expected };
    }
    case 0xf3:
      expected.interruptEnabled = false;
      return { opcode, documented: true, name: "DI", bytes, setup: { interruptEnabled: true }, expected };
    case 0xf9:
      expected.registers.sp = HL;
      expected.cycles = 5;
      return { opcode, documented: true, name: "SPHL", bytes, expected };
    case 0xfb:
      expected.interruptEnabled = true;
      return { opcode, documented: true, name: "EI", bytes, expected };
    default:
      break;
  }

  if ((opcode & 0xc7) === 0xc0) {
    const condition = CONDITIONS[(opcode >> 3) & 7];
    expected.registers.f = conditionFlag(condition);
    expected.registers.pc = RETURN;
    expected.registers.sp = SP + 2;
    setPcCycles(RETURN, 11);
    return { opcode, documented: true, name: `R${condition.toUpperCase()} taken`, bytes, setup: { f: expected.registers.f }, expected };
  }
  if ((opcode & 0xc7) === 0xc2) {
    const condition = CONDITIONS[(opcode >> 3) & 7];
    expected.registers.f = conditionFlag(condition);
    expected.registers.pc = TARGET;
    setPcCycles(TARGET, 10);
    return { opcode, documented: true, name: `J${condition.toUpperCase()} taken`, bytes, setup: { f: expected.registers.f }, expected };
  }
  if ((opcode & 0xc7) === 0xc4) {
    const condition = CONDITIONS[(opcode >> 3) & 7];
    expected.registers.f = conditionFlag(condition);
    expected.registers.sp = SP - 2;
    memorySet(expected, SP - 2, (PC + 3) & 0xff);
    memorySet(expected, SP - 1, (PC + 3) >> 8);
    expected.registers.pc = TARGET;
    setPcCycles(TARGET, 17);
    return { opcode, documented: true, name: `C${condition.toUpperCase()} taken`, bytes, setup: { f: expected.registers.f }, expected };
  }
  if ((opcode & 0xc7) === 0xc7) {
    const target = opcode & 0x38;
    expected.registers.sp = SP - 2;
    memorySet(expected, SP - 2, (PC + 1) & 0xff);
    memorySet(expected, SP - 1, (PC + 1) >> 8);
    expected.registers.pc = target;
    setPcCycles(target, 11);
    return { opcode, documented: true, name: `RST ${target}`, bytes, expected };
  }

  throw new Error(`No i8080 semantic fixture for ${hex8(opcode)}`);
};

const applySetup = (cpu, emu, memory, fixture) => {
  const base = createBase();
  memory.load(PC, fixture.bytes);
  for (const [address, value] of base.memory.entries()) memory.writeByte(emu, address, value);
  for (const [register, value] of Object.entries(base.registers)) cpu.setRegister(emu, register, value);
  if (fixture.setup?.a != null) cpu.setRegister(emu, "a", fixture.setup.a);
  if (fixture.setup?.f != null) cpu.setRegister(emu, "f", fixture.setup.f);
  if (fixture.setup?.interruptEnabled) {
    memory.load(PC, [0xfb]);
    cpu.step(emu);
    memory.load(PC, fixture.bytes);
    cpu.setRegister(emu, "pc", PC);
  }
  if (fixture.input) cpu.setInput(fixture.input, true);
};

const assertExpected = (cpu, emu, memory, fixture) => {
  const debug = cpu.getDebugState({ historyLength: 1 });
  for (const [register, value] of Object.entries(fixture.expected.registers)) {
    if (register === "pc") continue;
    assert.strictEqual(debug.registers[register], value, `${fixture.name}: register ${register}`);
  }
  for (const [address, value] of fixture.expected.memory.entries()) {
    assert.strictEqual(memory.readByte(emu, address), value, `${fixture.name}: memory ${hex8(address >> 8)}${hex8(address)}`);
  }
  assert.strictEqual(debug.lastOpCycles, fixture.expected.cycles, `${fixture.name}: cycles`);
  assert.strictEqual(debug.registers.pc, fixture.expected.pc, `${fixture.name}: PC`);
  assert.strictEqual(debug.halted, fixture.expected.halted, `${fixture.name}: halted`);
  assert.strictEqual(debug.interruptEnabled, fixture.expected.interruptEnabled, `${fixture.name}: interrupt enabled`);
  if (fixture.outputPort != null) {
    assert.strictEqual(debug.outputPorts[fixture.outputPort], fixture.expected.registers.a, `${fixture.name}: output port`);
  }
};

describe("Intel 8080 documented opcode semantics", () => {
  for (const opcode of allOpcodes()) {
    const fixture = buildCase(opcode);
    if (!fixture.documented) {
      it(`${hex8(opcode)} is explicitly classified as undocumented`, () => {
        assert.strictEqual(fixture.name, "undocumented by Intel 8080 manual");
      });
      continue;
    }

    it(`${hex8(opcode)} ${fixture.name} applies documented state changes`, async () => {
      const memory = createTestMemory();
      const cpu = await createI8080CPU({ cpu: { initialPc: PC, initialSp: SP } });
      const emu = createTestEmulator(cpu, memory);
      cpu.attach(emu);
      applySetup(cpu, emu, memory, fixture);

      cpu.step(emu);

      assertExpected(cpu, emu, memory, fixture);
    });
  }
});
