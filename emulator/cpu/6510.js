const REGISTER_DEFS = Object.freeze([
  { name: "pc", bits: 16 },
  { name: "sp", bits: 8 },
  { name: "a", bits: 8 },
  { name: "x", bits: 8 },
  { name: "y", bits: 8 },
  { name: "p", bits: 8 },
  { name: "f", bits: 8 },
]);

const FLAG_C = 0x01;
const FLAG_Z = 0x02;
const FLAG_I = 0x04;
const FLAG_D = 0x08;
const FLAG_B = 0x10;
const FLAG_U = 0x20;
const FLAG_V = 0x40;
const FLAG_N = 0x80;

const u8 = (value) => value & 0xff;
const u16 = (value) => value & 0xffff;
const s8 = (value) => (value & 0x80) ? value - 0x100 : value;
const hex = (value, width) => "0x" + (value >>> 0).toString(16).toUpperCase().padStart(width, "0");

const OPCODES = Object.freeze({
  0x00: ["BRK", "imp", 1], 0x01: ["ORA", "indx", 2], 0x05: ["ORA", "zp", 2], 0x06: ["ASL", "zp", 2],
  0x08: ["PHP", "imp", 1], 0x09: ["ORA", "imm", 2], 0x0a: ["ASL", "acc", 1], 0x0d: ["ORA", "abs", 3],
  0x0e: ["ASL", "abs", 3], 0x10: ["BPL", "rel", 2], 0x11: ["ORA", "indy", 2], 0x15: ["ORA", "zpx", 2],
  0x16: ["ASL", "zpx", 2], 0x18: ["CLC", "imp", 1], 0x19: ["ORA", "absy", 3], 0x1d: ["ORA", "absx", 3],
  0x1e: ["ASL", "absx", 3], 0x20: ["JSR", "abs", 3], 0x21: ["AND", "indx", 2], 0x24: ["BIT", "zp", 2],
  0x25: ["AND", "zp", 2], 0x26: ["ROL", "zp", 2], 0x28: ["PLP", "imp", 1], 0x29: ["AND", "imm", 2],
  0x2a: ["ROL", "acc", 1], 0x2c: ["BIT", "abs", 3], 0x2d: ["AND", "abs", 3], 0x2e: ["ROL", "abs", 3],
  0x30: ["BMI", "rel", 2], 0x31: ["AND", "indy", 2], 0x35: ["AND", "zpx", 2], 0x36: ["ROL", "zpx", 2],
  0x38: ["SEC", "imp", 1], 0x39: ["AND", "absy", 3], 0x3d: ["AND", "absx", 3], 0x3e: ["ROL", "absx", 3],
  0x40: ["RTI", "imp", 1], 0x41: ["EOR", "indx", 2], 0x45: ["EOR", "zp", 2], 0x46: ["LSR", "zp", 2],
  0x48: ["PHA", "imp", 1], 0x49: ["EOR", "imm", 2], 0x4a: ["LSR", "acc", 1], 0x4c: ["JMP", "abs", 3],
  0x4d: ["EOR", "abs", 3], 0x4e: ["LSR", "abs", 3], 0x50: ["BVC", "rel", 2], 0x51: ["EOR", "indy", 2],
  0x55: ["EOR", "zpx", 2], 0x56: ["LSR", "zpx", 2], 0x58: ["CLI", "imp", 1], 0x59: ["EOR", "absy", 3],
  0x5d: ["EOR", "absx", 3], 0x5e: ["LSR", "absx", 3], 0x60: ["RTS", "imp", 1], 0x61: ["ADC", "indx", 2],
  0x65: ["ADC", "zp", 2], 0x66: ["ROR", "zp", 2], 0x68: ["PLA", "imp", 1], 0x69: ["ADC", "imm", 2],
  0x6a: ["ROR", "acc", 1], 0x6c: ["JMP", "ind", 3], 0x6d: ["ADC", "abs", 3], 0x6e: ["ROR", "abs", 3],
  0x70: ["BVS", "rel", 2], 0x71: ["ADC", "indy", 2], 0x75: ["ADC", "zpx", 2], 0x76: ["ROR", "zpx", 2],
  0x78: ["SEI", "imp", 1], 0x79: ["ADC", "absy", 3], 0x7d: ["ADC", "absx", 3], 0x7e: ["ROR", "absx", 3],
  0x81: ["STA", "indx", 2], 0x84: ["STY", "zp", 2], 0x85: ["STA", "zp", 2], 0x86: ["STX", "zp", 2],
  0x88: ["DEY", "imp", 1], 0x8a: ["TXA", "imp", 1], 0x8c: ["STY", "abs", 3], 0x8d: ["STA", "abs", 3],
  0x8e: ["STX", "abs", 3], 0x90: ["BCC", "rel", 2], 0x91: ["STA", "indy", 2], 0x94: ["STY", "zpx", 2],
  0x95: ["STA", "zpx", 2], 0x96: ["STX", "zpy", 2], 0x98: ["TYA", "imp", 1], 0x99: ["STA", "absy", 3],
  0x9a: ["TXS", "imp", 1], 0x9d: ["STA", "absx", 3], 0xa0: ["LDY", "imm", 2], 0xa1: ["LDA", "indx", 2],
  0xa2: ["LDX", "imm", 2], 0xa4: ["LDY", "zp", 2], 0xa5: ["LDA", "zp", 2], 0xa6: ["LDX", "zp", 2],
  0xa8: ["TAY", "imp", 1], 0xa9: ["LDA", "imm", 2], 0xaa: ["TAX", "imp", 1], 0xac: ["LDY", "abs", 3],
  0xad: ["LDA", "abs", 3], 0xae: ["LDX", "abs", 3], 0xb0: ["BCS", "rel", 2], 0xb1: ["LDA", "indy", 2],
  0xb4: ["LDY", "zpx", 2], 0xb5: ["LDA", "zpx", 2], 0xb6: ["LDX", "zpy", 2], 0xb8: ["CLV", "imp", 1],
  0xb9: ["LDA", "absy", 3], 0xba: ["TSX", "imp", 1], 0xbc: ["LDY", "absx", 3], 0xbd: ["LDA", "absx", 3],
  0xbe: ["LDX", "absy", 3], 0xc0: ["CPY", "imm", 2], 0xc1: ["CMP", "indx", 2], 0xc4: ["CPY", "zp", 2],
  0xc5: ["CMP", "zp", 2], 0xc6: ["DEC", "zp", 2], 0xc8: ["INY", "imp", 1], 0xc9: ["CMP", "imm", 2],
  0xca: ["DEX", "imp", 1], 0xcc: ["CPY", "abs", 3], 0xcd: ["CMP", "abs", 3], 0xce: ["DEC", "abs", 3],
  0xd0: ["BNE", "rel", 2], 0xd1: ["CMP", "indy", 2], 0xd5: ["CMP", "zpx", 2], 0xd6: ["DEC", "zpx", 2],
  0xd8: ["CLD", "imp", 1], 0xd9: ["CMP", "absy", 3], 0xdd: ["CMP", "absx", 3], 0xde: ["DEC", "absx", 3],
  0xe0: ["CPX", "imm", 2], 0xe1: ["SBC", "indx", 2], 0xe4: ["CPX", "zp", 2], 0xe5: ["SBC", "zp", 2],
  0xe6: ["INC", "zp", 2], 0xe8: ["INX", "imp", 1], 0xe9: ["SBC", "imm", 2], 0xea: ["NOP", "imp", 1],
  0xec: ["CPX", "abs", 3], 0xed: ["SBC", "abs", 3], 0xee: ["INC", "abs", 3], 0xf0: ["BEQ", "rel", 2],
  0xf1: ["SBC", "indy", 2], 0xf5: ["SBC", "zpx", 2], 0xf6: ["INC", "zpx", 2], 0xf8: ["SED", "imp", 1],
  0xf9: ["SBC", "absy", 3], 0xfd: ["SBC", "absx", 3], 0xfe: ["INC", "absx", 3],
});

const MODE_FORMAT = Object.freeze({
  acc: () => "A",
  imm: (b1) => "#" + hex(b1, 2),
  zp: (b1) => hex(b1, 2),
  zpx: (b1) => hex(b1, 2) + ",X",
  zpy: (b1) => hex(b1, 2) + ",Y",
  abs: (b1, b2) => hex((b2 << 8) | b1, 4),
  absx: (b1, b2) => hex((b2 << 8) | b1, 4) + ",X",
  absy: (b1, b2) => hex((b2 << 8) | b1, 4) + ",Y",
  ind: (b1, b2) => "(" + hex((b2 << 8) | b1, 4) + ")",
  indx: (b1) => "(" + hex(b1, 2) + ",X)",
  indy: (b1) => "(" + hex(b1, 2) + "),Y",
  rel: (b1, _b2, pc) => hex(u16(pc + 2 + s8(b1)), 4),
  imp: () => "",
});

const create6510CPU = async (manifest = {}) => {
  let emu = null;
  let runtime = null;
  const keyboardState = new Map();

  const initialRegisters = () => ({
    pc: u16(manifest.cpu?.initialPc ?? 0),
    sp: u8(manifest.cpu?.initialSp ?? 0xfd),
    a: 0,
    x: 0,
    y: 0,
    p: FLAG_U | FLAG_I,
    f: FLAG_U | FLAG_I,
  });

  const resetRuntime = () => ({
    halted: false,
    haltedReason: "",
    lastOpCycles: 0,
    lastOpcode: 0,
    lastAddress: 0,
    instructionCount: 0,
    history: [],
    warnings: [],
    irqCount: 0,
    nmiCount: 0,
  });

  const syncF = () => {
    cpu.registers.p = u8(cpu.registers.p | FLAG_U);
    cpu.registers.f = cpu.registers.p;
  };

  const readByte = (address) => {
    if (!emu?.mmu) throw new Error("6510 CPU is not attached to an emulator MMU");
    return emu.mmu.readByte(emu, u16(address)) & 0xff;
  };

  const safeReadByte = (address) => {
    try {
      return emu?.mmu ? emu.mmu.readByte(emu, u16(address)) & 0xff : 0xff;
    } catch {
      return 0xff;
    }
  };

  const writeByte = (address, value) => {
    if (!emu?.mmu) throw new Error("6510 CPU is not attached to an emulator MMU");
    emu.mmu.writeByte(emu, u16(address), u8(value));
  };

  const readWord = (address) => readByte(address) | (readByte(address + 1) << 8);
  const safeReadWord = (address) => safeReadByte(address) | (safeReadByte(address + 1) << 8);

  const readWordBug = (address) => {
    const lo = readByte(address);
    const hiAddress = (address & 0xff00) | ((address + 1) & 0x00ff);
    return lo | (readByte(hiAddress) << 8);
  };

  const fetchByte = () => {
    const value = readByte(cpu.registers.pc);
    cpu.registers.pc = u16(cpu.registers.pc + 1);
    return value;
  };

  const fetchWord = () => {
    const lo = fetchByte();
    const hi = fetchByte();
    return lo | (hi << 8);
  };

  const addCycles = (count) => {
    const cycles = Number(count) || 0;
    cpu.cycles += cycles;
    emu?.mmu?.tick?.(emu, cycles);
  };

  const setFlag = (mask, enabled) => {
    cpu.registers.p = enabled ? (cpu.registers.p | mask) : (cpu.registers.p & (~mask));
    syncF();
  };

  const getFlag = (mask) => (cpu.registers.p & mask) !== 0;
  const setNZ = (value) => {
    const next = u8(value);
    setFlag(FLAG_Z, next === 0);
    setFlag(FLAG_N, (next & 0x80) !== 0);
    return next;
  };

  const pushByte = (value) => {
    writeByte(0x0100 | cpu.registers.sp, value);
    cpu.registers.sp = u8(cpu.registers.sp - 1);
  };

  const pullByte = () => {
    cpu.registers.sp = u8(cpu.registers.sp + 1);
    return readByte(0x0100 | cpu.registers.sp);
  };

  const pushWord = (value) => {
    pushByte((value >> 8) & 0xff);
    pushByte(value & 0xff);
  };

  const pullWord = () => {
    const lo = pullByte();
    const hi = pullByte();
    return lo | (hi << 8);
  };

  const zeroPageWord = (address) => readByte(address & 0xff) | (readByte((address + 1) & 0xff) << 8);
  const pageCrossed = (a, b) => (a & 0xff00) !== (b & 0xff00);

  const addr = {
    zp: () => fetchByte(),
    zpx: () => u8(fetchByte() + cpu.registers.x),
    zpy: () => u8(fetchByte() + cpu.registers.y),
    abs: () => fetchWord(),
    absx: (extraCycle = true) => {
      const base = fetchWord();
      const next = u16(base + cpu.registers.x);
      if (extraCycle && pageCrossed(base, next)) addCycles(1);
      return next;
    },
    absy: (extraCycle = true) => {
      const base = fetchWord();
      const next = u16(base + cpu.registers.y);
      if (extraCycle && pageCrossed(base, next)) addCycles(1);
      return next;
    },
    indx: () => zeroPageWord(fetchByte() + cpu.registers.x),
    indy: (extraCycle = true) => {
      const base = zeroPageWord(fetchByte());
      const next = u16(base + cpu.registers.y);
      if (extraCycle && pageCrossed(base, next)) addCycles(1);
      return next;
    },
  };

  const operandAddress = (mode, write = false) => {
    switch (mode) {
      case "zp": return addr.zp();
      case "zpx": return addr.zpx();
      case "zpy": return addr.zpy();
      case "abs": return addr.abs();
      case "absx": return addr.absx(!write);
      case "absy": return addr.absy(!write);
      case "indx": return addr.indx();
      case "indy": return addr.indy(!write);
      default: throw new Error("Addressing mode has no address: " + mode);
    }
  };

  const readOperand = (mode) => mode === "imm" ? fetchByte() : readByte(operandAddress(mode));

  const logical = (mode, fn) => {
    cpu.registers.a = setNZ(fn(cpu.registers.a, readOperand(mode)));
  };

  const compare = (left, value) => {
    const result = u8(left - value);
    setFlag(FLAG_C, left >= value);
    setFlag(FLAG_Z, result === 0);
    setFlag(FLAG_N, (result & 0x80) !== 0);
  };

  const adc = (value) => {
    const a = cpu.registers.a;
    const carry = getFlag(FLAG_C) ? 1 : 0;
    const binary = a + value + carry;
    setFlag(FLAG_V, (~(a ^ value) & (a ^ binary) & 0x80) !== 0);

    if (getFlag(FLAG_D)) {
      let lo = (a & 0x0f) + (value & 0x0f) + carry;
      let hi = (a >> 4) + (value >> 4);
      if (lo > 9) {
        lo += 6;
        hi += 1;
      }
      if (hi > 9) hi += 6;
      setFlag(FLAG_C, hi > 0x0f);
      cpu.registers.a = setNZ(((hi << 4) | (lo & 0x0f)) & 0xff);
      return;
    }

    setFlag(FLAG_C, binary > 0xff);
    cpu.registers.a = setNZ(binary);
  };

  const sbc = (value) => {
    const a = cpu.registers.a;
    const carry = getFlag(FLAG_C) ? 1 : 0;
    const inverted = value ^ 0xff;
    const binary = a + inverted + carry;
    setFlag(FLAG_V, ((a ^ binary) & (inverted ^ binary) & 0x80) !== 0);

    if (getFlag(FLAG_D)) {
      let lo = (a & 0x0f) - (value & 0x0f) - (1 - carry);
      let hi = (a >> 4) - (value >> 4);
      if (lo < 0) {
        lo -= 6;
        hi -= 1;
      }
      if (hi < 0) hi -= 6;
      setFlag(FLAG_C, a - value - (1 - carry) >= 0);
      cpu.registers.a = setNZ(((hi << 4) | (lo & 0x0f)) & 0xff);
      return;
    }

    setFlag(FLAG_C, binary > 0xff);
    cpu.registers.a = setNZ(binary);
  };

  const shiftMemory = (mode, fn) => {
    if (mode === "acc") {
      cpu.registers.a = setNZ(fn(cpu.registers.a));
      return;
    }
    const address = operandAddress(mode, true);
    writeByte(address, setNZ(fn(readByte(address))));
  };

  const rmwOperand = (mode, fn) => {
    const address = operandAddress(mode, true);
    const result = u8(fn(readByte(address)));
    writeByte(address, result);
    return result;
  };

  const unofficialSlo = (mode) => {
    const result = rmwOperand(mode, (v) => {
      setFlag(FLAG_C, (v & 0x80) !== 0);
      return v << 1;
    });
    cpu.registers.a = setNZ(cpu.registers.a | result);
  };

  const unofficialRla = (mode) => {
    const result = rmwOperand(mode, (v) => {
      const carry = getFlag(FLAG_C) ? 1 : 0;
      setFlag(FLAG_C, (v & 0x80) !== 0);
      return (v << 1) | carry;
    });
    cpu.registers.a = setNZ(cpu.registers.a & result);
  };

  const unofficialSre = (mode) => {
    const result = rmwOperand(mode, (v) => {
      setFlag(FLAG_C, (v & 0x01) !== 0);
      return v >> 1;
    });
    cpu.registers.a = setNZ(cpu.registers.a ^ result);
  };

  const unofficialRra = (mode) => {
    const result = rmwOperand(mode, (v) => {
      const carry = getFlag(FLAG_C) ? 0x80 : 0;
      setFlag(FLAG_C, (v & 0x01) !== 0);
      return (v >> 1) | carry;
    });
    adc(result);
  };

  const unofficialDcp = (mode) => {
    const result = rmwOperand(mode, (v) => v - 1);
    compare(cpu.registers.a, result);
  };

  const unofficialIsc = (mode) => {
    const result = rmwOperand(mode, (v) => v + 1);
    sbc(result);
  };

  const unofficialLax = (mode) => {
    const result = setNZ(readOperand(mode));
    cpu.registers.a = result;
    cpu.registers.x = result;
  };

  const unofficialSax = (mode) => {
    writeByte(operandAddress(mode, true), cpu.registers.a & cpu.registers.x);
  };

  const unofficialNop = (mode = "imp") => {
    switch (mode) {
      case "imm": fetchByte(); break;
      case "zp": addr.zp(); break;
      case "zpx": addr.zpx(); break;
      case "abs": addr.abs(); break;
      case "absx": addr.absx(true); break;
      default: break;
    }
  };

  const branch = (condition) => {
    const offset = s8(fetchByte());
    if (!condition) return;
    const before = cpu.registers.pc;
    cpu.registers.pc = u16(cpu.registers.pc + offset);
    addCycles(1);
    if (pageCrossed(before, cpu.registers.pc)) addCycles(1);
  };

  const serviceInterrupt = (vector, breakFlag = false) => {
    pushWord(cpu.registers.pc);
    pushByte((cpu.registers.p | FLAG_U | (breakFlag ? FLAG_B : 0)) & 0xff);
    setFlag(FLAG_I, true);
    cpu.registers.pc = readWord(vector);
    addCycles(7);
  };

  const interruptBeforeInstruction = () => {
    if (emu?.mmu?.consumeNmi?.(emu)) {
      runtime.nmiCount += 1;
      serviceInterrupt(0xfffa, false);
      return true;
    }
    if (!getFlag(FLAG_I) && emu?.mmu?.irqActive?.(emu)) {
      runtime.irqCount += 1;
      serviceInterrupt(0xfffe, false);
      return true;
    }
    return false;
  };

  const unsupported = (opcode) => {
    runtime.halted = true;
    runtime.haltedReason = "Unsupported 6510 opcode " + hex(opcode, 2) + " at " + hex(runtime.lastAddress, 4);
    runtime.warnings.push(runtime.haltedReason);
    if (runtime.warnings.length > 16) runtime.warnings.shift();
    if (emu) emu.debugBreakRequested = true;
  };

  const executeOpcode = (opcode) => {
    switch (opcode) {
      case 0x00:
        fetchByte();
        serviceInterrupt(0xfffe, true);
        break;
      case 0x01: logical("indx", (a, v) => a | v); addCycles(6); break;
      case 0x05: logical("zp", (a, v) => a | v); addCycles(3); break;
      case 0x06: shiftMemory("zp", (v) => { setFlag(FLAG_C, (v & 0x80) !== 0); return v << 1; }); addCycles(5); break;
      case 0x08: pushByte(cpu.registers.p | FLAG_B | FLAG_U); addCycles(3); break;
      case 0x09: logical("imm", (a, v) => a | v); addCycles(2); break;
      case 0x0a: shiftMemory("acc", (v) => { setFlag(FLAG_C, (v & 0x80) !== 0); return v << 1; }); addCycles(2); break;
      case 0x0d: logical("abs", (a, v) => a | v); addCycles(4); break;
      case 0x0e: shiftMemory("abs", (v) => { setFlag(FLAG_C, (v & 0x80) !== 0); return v << 1; }); addCycles(6); break;
      case 0x10: branch(!getFlag(FLAG_N)); addCycles(2); break;
      case 0x11: logical("indy", (a, v) => a | v); addCycles(5); break;
      case 0x15: logical("zpx", (a, v) => a | v); addCycles(4); break;
      case 0x16: shiftMemory("zpx", (v) => { setFlag(FLAG_C, (v & 0x80) !== 0); return v << 1; }); addCycles(6); break;
      case 0x18: setFlag(FLAG_C, false); addCycles(2); break;
      case 0x19: logical("absy", (a, v) => a | v); addCycles(4); break;
      case 0x1d: logical("absx", (a, v) => a | v); addCycles(4); break;
      case 0x1e: shiftMemory("absx", (v) => { setFlag(FLAG_C, (v & 0x80) !== 0); return v << 1; }); addCycles(7); break;
      case 0x20: { const target = fetchWord(); pushWord(u16(cpu.registers.pc - 1)); cpu.registers.pc = target; addCycles(6); break; }
      case 0x21: logical("indx", (a, v) => a & v); addCycles(6); break;
      case 0x24: { const v = readOperand("zp"); setFlag(FLAG_Z, (cpu.registers.a & v) === 0); setFlag(FLAG_N, (v & FLAG_N) !== 0); setFlag(FLAG_V, (v & FLAG_V) !== 0); addCycles(3); break; }
      case 0x25: logical("zp", (a, v) => a & v); addCycles(3); break;
      case 0x26: shiftMemory("zp", (v) => { const c = getFlag(FLAG_C) ? 1 : 0; setFlag(FLAG_C, (v & 0x80) !== 0); return (v << 1) | c; }); addCycles(5); break;
      case 0x28: cpu.registers.p = (pullByte() | FLAG_U) & (~FLAG_B); syncF(); addCycles(4); break;
      case 0x29: logical("imm", (a, v) => a & v); addCycles(2); break;
      case 0x2a: shiftMemory("acc", (v) => { const c = getFlag(FLAG_C) ? 1 : 0; setFlag(FLAG_C, (v & 0x80) !== 0); return (v << 1) | c; }); addCycles(2); break;
      case 0x2c: { const v = readOperand("abs"); setFlag(FLAG_Z, (cpu.registers.a & v) === 0); setFlag(FLAG_N, (v & FLAG_N) !== 0); setFlag(FLAG_V, (v & FLAG_V) !== 0); addCycles(4); break; }
      case 0x2d: logical("abs", (a, v) => a & v); addCycles(4); break;
      case 0x2e: shiftMemory("abs", (v) => { const c = getFlag(FLAG_C) ? 1 : 0; setFlag(FLAG_C, (v & 0x80) !== 0); return (v << 1) | c; }); addCycles(6); break;
      case 0x30: branch(getFlag(FLAG_N)); addCycles(2); break;
      case 0x31: logical("indy", (a, v) => a & v); addCycles(5); break;
      case 0x35: logical("zpx", (a, v) => a & v); addCycles(4); break;
      case 0x36: shiftMemory("zpx", (v) => { const c = getFlag(FLAG_C) ? 1 : 0; setFlag(FLAG_C, (v & 0x80) !== 0); return (v << 1) | c; }); addCycles(6); break;
      case 0x38: setFlag(FLAG_C, true); addCycles(2); break;
      case 0x39: logical("absy", (a, v) => a & v); addCycles(4); break;
      case 0x3d: logical("absx", (a, v) => a & v); addCycles(4); break;
      case 0x3e: shiftMemory("absx", (v) => { const c = getFlag(FLAG_C) ? 1 : 0; setFlag(FLAG_C, (v & 0x80) !== 0); return (v << 1) | c; }); addCycles(7); break;
      case 0x40: cpu.registers.p = (pullByte() | FLAG_U) & (~FLAG_B); syncF(); cpu.registers.pc = pullWord(); addCycles(6); break;
      case 0x41: logical("indx", (a, v) => a ^ v); addCycles(6); break;
      case 0x45: logical("zp", (a, v) => a ^ v); addCycles(3); break;
      case 0x46: shiftMemory("zp", (v) => { setFlag(FLAG_C, (v & 0x01) !== 0); return v >> 1; }); addCycles(5); break;
      case 0x48: pushByte(cpu.registers.a); addCycles(3); break;
      case 0x49: logical("imm", (a, v) => a ^ v); addCycles(2); break;
      case 0x4a: shiftMemory("acc", (v) => { setFlag(FLAG_C, (v & 0x01) !== 0); return v >> 1; }); addCycles(2); break;
      case 0x4c: cpu.registers.pc = fetchWord(); addCycles(3); break;
      case 0x4d: logical("abs", (a, v) => a ^ v); addCycles(4); break;
      case 0x4e: shiftMemory("abs", (v) => { setFlag(FLAG_C, (v & 0x01) !== 0); return v >> 1; }); addCycles(6); break;
      case 0x50: branch(!getFlag(FLAG_V)); addCycles(2); break;
      case 0x51: logical("indy", (a, v) => a ^ v); addCycles(5); break;
      case 0x55: logical("zpx", (a, v) => a ^ v); addCycles(4); break;
      case 0x56: shiftMemory("zpx", (v) => { setFlag(FLAG_C, (v & 0x01) !== 0); return v >> 1; }); addCycles(6); break;
      case 0x58: setFlag(FLAG_I, false); addCycles(2); break;
      case 0x59: logical("absy", (a, v) => a ^ v); addCycles(4); break;
      case 0x5d: logical("absx", (a, v) => a ^ v); addCycles(4); break;
      case 0x5e: shiftMemory("absx", (v) => { setFlag(FLAG_C, (v & 0x01) !== 0); return v >> 1; }); addCycles(7); break;
      case 0x60: cpu.registers.pc = u16(pullWord() + 1); addCycles(6); break;
      case 0x61: adc(readOperand("indx")); addCycles(6); break;
      case 0x65: adc(readOperand("zp")); addCycles(3); break;
      case 0x66: shiftMemory("zp", (v) => { const c = getFlag(FLAG_C) ? 0x80 : 0; setFlag(FLAG_C, (v & 0x01) !== 0); return (v >> 1) | c; }); addCycles(5); break;
      case 0x68: cpu.registers.a = setNZ(pullByte()); addCycles(4); break;
      case 0x69: adc(readOperand("imm")); addCycles(2); break;
      case 0x6a: shiftMemory("acc", (v) => { const c = getFlag(FLAG_C) ? 0x80 : 0; setFlag(FLAG_C, (v & 0x01) !== 0); return (v >> 1) | c; }); addCycles(2); break;
      case 0x6c: cpu.registers.pc = readWordBug(fetchWord()); addCycles(5); break;
      case 0x6d: adc(readOperand("abs")); addCycles(4); break;
      case 0x6e: shiftMemory("abs", (v) => { const c = getFlag(FLAG_C) ? 0x80 : 0; setFlag(FLAG_C, (v & 0x01) !== 0); return (v >> 1) | c; }); addCycles(6); break;
      case 0x70: branch(getFlag(FLAG_V)); addCycles(2); break;
      case 0x71: adc(readOperand("indy")); addCycles(5); break;
      case 0x75: adc(readOperand("zpx")); addCycles(4); break;
      case 0x76: shiftMemory("zpx", (v) => { const c = getFlag(FLAG_C) ? 0x80 : 0; setFlag(FLAG_C, (v & 0x01) !== 0); return (v >> 1) | c; }); addCycles(6); break;
      case 0x78: setFlag(FLAG_I, true); addCycles(2); break;
      case 0x79: adc(readOperand("absy")); addCycles(4); break;
      case 0x7d: adc(readOperand("absx")); addCycles(4); break;
      case 0x7e: shiftMemory("absx", (v) => { const c = getFlag(FLAG_C) ? 0x80 : 0; setFlag(FLAG_C, (v & 0x01) !== 0); return (v >> 1) | c; }); addCycles(7); break;
      case 0x81: writeByte(operandAddress("indx", true), cpu.registers.a); addCycles(6); break;
      case 0x84: writeByte(operandAddress("zp", true), cpu.registers.y); addCycles(3); break;
      case 0x85: writeByte(operandAddress("zp", true), cpu.registers.a); addCycles(3); break;
      case 0x86: writeByte(operandAddress("zp", true), cpu.registers.x); addCycles(3); break;
      case 0x88: cpu.registers.y = setNZ(cpu.registers.y - 1); addCycles(2); break;
      case 0x8a: cpu.registers.a = setNZ(cpu.registers.x); addCycles(2); break;
      case 0x8c: writeByte(operandAddress("abs", true), cpu.registers.y); addCycles(4); break;
      case 0x8d: writeByte(operandAddress("abs", true), cpu.registers.a); addCycles(4); break;
      case 0x8e: writeByte(operandAddress("abs", true), cpu.registers.x); addCycles(4); break;
      case 0x90: branch(!getFlag(FLAG_C)); addCycles(2); break;
      case 0x91: writeByte(operandAddress("indy", true), cpu.registers.a); addCycles(6); break;
      case 0x94: writeByte(operandAddress("zpx", true), cpu.registers.y); addCycles(4); break;
      case 0x95: writeByte(operandAddress("zpx", true), cpu.registers.a); addCycles(4); break;
      case 0x96: writeByte(operandAddress("zpy", true), cpu.registers.x); addCycles(4); break;
      case 0x98: cpu.registers.a = setNZ(cpu.registers.y); addCycles(2); break;
      case 0x99: writeByte(operandAddress("absy", true), cpu.registers.a); addCycles(5); break;
      case 0x9a: cpu.registers.sp = u8(cpu.registers.x); addCycles(2); break;
      case 0x9d: writeByte(operandAddress("absx", true), cpu.registers.a); addCycles(5); break;
      case 0xa0: cpu.registers.y = setNZ(readOperand("imm")); addCycles(2); break;
      case 0xa1: cpu.registers.a = setNZ(readOperand("indx")); addCycles(6); break;
      case 0xa2: cpu.registers.x = setNZ(readOperand("imm")); addCycles(2); break;
      case 0xa4: cpu.registers.y = setNZ(readOperand("zp")); addCycles(3); break;
      case 0xa5: cpu.registers.a = setNZ(readOperand("zp")); addCycles(3); break;
      case 0xa6: cpu.registers.x = setNZ(readOperand("zp")); addCycles(3); break;
      case 0xa8: cpu.registers.y = setNZ(cpu.registers.a); addCycles(2); break;
      case 0xa9: cpu.registers.a = setNZ(readOperand("imm")); addCycles(2); break;
      case 0xaa: cpu.registers.x = setNZ(cpu.registers.a); addCycles(2); break;
      case 0xac: cpu.registers.y = setNZ(readOperand("abs")); addCycles(4); break;
      case 0xad: cpu.registers.a = setNZ(readOperand("abs")); addCycles(4); break;
      case 0xae: cpu.registers.x = setNZ(readOperand("abs")); addCycles(4); break;
      case 0xb0: branch(getFlag(FLAG_C)); addCycles(2); break;
      case 0xb1: cpu.registers.a = setNZ(readOperand("indy")); addCycles(5); break;
      case 0xb4: cpu.registers.y = setNZ(readOperand("zpx")); addCycles(4); break;
      case 0xb5: cpu.registers.a = setNZ(readOperand("zpx")); addCycles(4); break;
      case 0xb6: cpu.registers.x = setNZ(readOperand("zpy")); addCycles(4); break;
      case 0xb8: setFlag(FLAG_V, false); addCycles(2); break;
      case 0xb9: cpu.registers.a = setNZ(readOperand("absy")); addCycles(4); break;
      case 0xba: cpu.registers.x = setNZ(cpu.registers.sp); addCycles(2); break;
      case 0xbc: cpu.registers.y = setNZ(readOperand("absx")); addCycles(4); break;
      case 0xbd: cpu.registers.a = setNZ(readOperand("absx")); addCycles(4); break;
      case 0xbe: cpu.registers.x = setNZ(readOperand("absy")); addCycles(4); break;
      case 0xc0: compare(cpu.registers.y, readOperand("imm")); addCycles(2); break;
      case 0xc1: compare(cpu.registers.a, readOperand("indx")); addCycles(6); break;
      case 0xc4: compare(cpu.registers.y, readOperand("zp")); addCycles(3); break;
      case 0xc5: compare(cpu.registers.a, readOperand("zp")); addCycles(3); break;
      case 0xc6: { const a = operandAddress("zp", true); writeByte(a, setNZ(readByte(a) - 1)); addCycles(5); break; }
      case 0xc8: cpu.registers.y = setNZ(cpu.registers.y + 1); addCycles(2); break;
      case 0xc9: compare(cpu.registers.a, readOperand("imm")); addCycles(2); break;
      case 0xca: cpu.registers.x = setNZ(cpu.registers.x - 1); addCycles(2); break;
      case 0xcc: compare(cpu.registers.y, readOperand("abs")); addCycles(4); break;
      case 0xcd: compare(cpu.registers.a, readOperand("abs")); addCycles(4); break;
      case 0xce: { const a = operandAddress("abs", true); writeByte(a, setNZ(readByte(a) - 1)); addCycles(6); break; }
      case 0xd0: branch(!getFlag(FLAG_Z)); addCycles(2); break;
      case 0xd1: compare(cpu.registers.a, readOperand("indy")); addCycles(5); break;
      case 0xd5: compare(cpu.registers.a, readOperand("zpx")); addCycles(4); break;
      case 0xd6: { const a = operandAddress("zpx", true); writeByte(a, setNZ(readByte(a) - 1)); addCycles(6); break; }
      case 0xd8: setFlag(FLAG_D, false); addCycles(2); break;
      case 0xd9: compare(cpu.registers.a, readOperand("absy")); addCycles(4); break;
      case 0xdd: compare(cpu.registers.a, readOperand("absx")); addCycles(4); break;
      case 0xde: { const a = operandAddress("absx", true); writeByte(a, setNZ(readByte(a) - 1)); addCycles(7); break; }
      case 0xe0: compare(cpu.registers.x, readOperand("imm")); addCycles(2); break;
      case 0xe1: sbc(readOperand("indx")); addCycles(6); break;
      case 0xe4: compare(cpu.registers.x, readOperand("zp")); addCycles(3); break;
      case 0xe5: sbc(readOperand("zp")); addCycles(3); break;
      case 0xe6: { const a = operandAddress("zp", true); writeByte(a, setNZ(readByte(a) + 1)); addCycles(5); break; }
      case 0xe8: cpu.registers.x = setNZ(cpu.registers.x + 1); addCycles(2); break;
      case 0xe9: sbc(readOperand("imm")); addCycles(2); break;
      case 0xea: addCycles(2); break;
      case 0xec: compare(cpu.registers.x, readOperand("abs")); addCycles(4); break;
      case 0xed: sbc(readOperand("abs")); addCycles(4); break;
      case 0xee: { const a = operandAddress("abs", true); writeByte(a, setNZ(readByte(a) + 1)); addCycles(6); break; }
      case 0xf0: branch(getFlag(FLAG_Z)); addCycles(2); break;
      case 0xf1: sbc(readOperand("indy")); addCycles(5); break;
      case 0xf5: sbc(readOperand("zpx")); addCycles(4); break;
      case 0xf6: { const a = operandAddress("zpx", true); writeByte(a, setNZ(readByte(a) + 1)); addCycles(6); break; }
      case 0xf8: setFlag(FLAG_D, true); addCycles(2); break;
      case 0xf9: sbc(readOperand("absy")); addCycles(4); break;
      case 0xfd: sbc(readOperand("absx")); addCycles(4); break;
      case 0xfe: { const a = operandAddress("absx", true); writeByte(a, setNZ(readByte(a) + 1)); addCycles(7); break; }
      case 0x03: unofficialSlo("indx"); addCycles(8); break;
      case 0x07: unofficialSlo("zp"); addCycles(5); break;
      case 0x0f: unofficialSlo("abs"); addCycles(6); break;
      case 0x13: unofficialSlo("indy"); addCycles(8); break;
      case 0x17: unofficialSlo("zpx"); addCycles(6); break;
      case 0x1b: unofficialSlo("absy"); addCycles(7); break;
      case 0x1f: unofficialSlo("absx"); addCycles(7); break;
      case 0x23: unofficialRla("indx"); addCycles(8); break;
      case 0x27: unofficialRla("zp"); addCycles(5); break;
      case 0x2f: unofficialRla("abs"); addCycles(6); break;
      case 0x33: unofficialRla("indy"); addCycles(8); break;
      case 0x37: unofficialRla("zpx"); addCycles(6); break;
      case 0x3b: unofficialRla("absy"); addCycles(7); break;
      case 0x3f: unofficialRla("absx"); addCycles(7); break;
      case 0x43: unofficialSre("indx"); addCycles(8); break;
      case 0x47: unofficialSre("zp"); addCycles(5); break;
      case 0x4f: unofficialSre("abs"); addCycles(6); break;
      case 0x53: unofficialSre("indy"); addCycles(8); break;
      case 0x57: unofficialSre("zpx"); addCycles(6); break;
      case 0x5b: unofficialSre("absy"); addCycles(7); break;
      case 0x5f: unofficialSre("absx"); addCycles(7); break;
      case 0x63: unofficialRra("indx"); addCycles(8); break;
      case 0x67: unofficialRra("zp"); addCycles(5); break;
      case 0x6f: unofficialRra("abs"); addCycles(6); break;
      case 0x73: unofficialRra("indy"); addCycles(8); break;
      case 0x77: unofficialRra("zpx"); addCycles(6); break;
      case 0x7b: unofficialRra("absy"); addCycles(7); break;
      case 0x7f: unofficialRra("absx"); addCycles(7); break;
      case 0x83: unofficialSax("indx"); addCycles(6); break;
      case 0x87: unofficialSax("zp"); addCycles(3); break;
      case 0x8f: unofficialSax("abs"); addCycles(4); break;
      case 0x97: unofficialSax("zpy"); addCycles(4); break;
      case 0xa3: unofficialLax("indx"); addCycles(6); break;
      case 0xa7: unofficialLax("zp"); addCycles(3); break;
      case 0xaf: unofficialLax("abs"); addCycles(4); break;
      case 0xb3: unofficialLax("indy"); addCycles(5); break;
      case 0xb7: unofficialLax("zpy"); addCycles(4); break;
      case 0xbf: unofficialLax("absy"); addCycles(4); break;
      case 0xc3: unofficialDcp("indx"); addCycles(8); break;
      case 0xc7: unofficialDcp("zp"); addCycles(5); break;
      case 0xcf: unofficialDcp("abs"); addCycles(6); break;
      case 0xd3: unofficialDcp("indy"); addCycles(8); break;
      case 0xd7: unofficialDcp("zpx"); addCycles(6); break;
      case 0xdb: unofficialDcp("absy"); addCycles(7); break;
      case 0xdf: unofficialDcp("absx"); addCycles(7); break;
      case 0xe3: unofficialIsc("indx"); addCycles(8); break;
      case 0xe7: unofficialIsc("zp"); addCycles(5); break;
      case 0xef: unofficialIsc("abs"); addCycles(6); break;
      case 0xf3: unofficialIsc("indy"); addCycles(8); break;
      case 0xf7: unofficialIsc("zpx"); addCycles(6); break;
      case 0xfb: unofficialIsc("absy"); addCycles(7); break;
      case 0xff: unofficialIsc("absx"); addCycles(7); break;
      case 0x80: case 0x82: case 0x89: case 0xc2: case 0xe2:
        unofficialNop("imm"); addCycles(2); break;
      case 0x04: case 0x44: case 0x64:
        unofficialNop("zp"); addCycles(3); break;
      case 0x14: case 0x34: case 0x54: case 0x74: case 0xd4: case 0xf4:
        unofficialNop("zpx"); addCycles(4); break;
      case 0x0c:
        unofficialNop("abs"); addCycles(4); break;
      case 0x1c: case 0x3c: case 0x5c: case 0x7c: case 0xdc: case 0xfc:
        unofficialNop("absx"); addCycles(4); break;
      case 0x1a: case 0x3a: case 0x5a: case 0x7a: case 0xda: case 0xfa:
        addCycles(2); break;
      case 0x0b:
      case 0x2b:
        cpu.registers.a = setNZ(cpu.registers.a & readOperand("imm"));
        setFlag(FLAG_C, (cpu.registers.a & 0x80) !== 0);
        addCycles(2);
        break;
      case 0x4b:
        cpu.registers.a &= readOperand("imm");
        setFlag(FLAG_C, (cpu.registers.a & 0x01) !== 0);
        cpu.registers.a = setNZ(cpu.registers.a >> 1);
        addCycles(2);
        break;
      case 0x6b: {
        cpu.registers.a &= readOperand("imm");
        const carry = getFlag(FLAG_C) ? 0x80 : 0;
        cpu.registers.a = setNZ((cpu.registers.a >> 1) | carry);
        setFlag(FLAG_C, (cpu.registers.a & 0x40) !== 0);
        setFlag(FLAG_V, ((cpu.registers.a >> 6) ^ (cpu.registers.a >> 5)) & 0x01);
        addCycles(2);
        break;
      }
      case 0xcb: {
        const result = (cpu.registers.a & cpu.registers.x) - readOperand("imm");
        setFlag(FLAG_C, result >= 0);
        cpu.registers.x = setNZ(result);
        addCycles(2);
        break;
      }
      case 0xeb:
        sbc(readOperand("imm"));
        addCycles(2);
        break;
      default: unsupported(opcode); break;
    }
  };

  const reset = (emuState = emu) => {
    if (emuState) emu = emuState;
    const next = initialRegisters();
    if (emu?.mmu) next.pc = readWord(0xfffc);
    if (next.pc === 0xffff) next.pc = u16(manifest.cpu?.initialPc ?? 0);
    for (const key of Object.keys(cpu.registers)) delete cpu.registers[key];
    Object.assign(cpu.registers, next);
    syncF();
    cpu.cycles = 0;
    runtime = resetRuntime();
    keyboardState.clear();
  };

  const disassemble = (address = cpu.registers.pc) => {
    const pc = u16(address);
    const op = safeReadByte(pc);
    const b1 = safeReadByte(pc + 1);
    const b2 = safeReadByte(pc + 2);
    const entry = OPCODES[op];
    if (!entry) return { address: pc, bytes: [op], mnemonic: "DB " + hex(op, 2), size: 1 };
    const [mnemonic, mode, size] = entry;
    const operand = MODE_FORMAT[mode]?.(b1, b2, pc) ?? "";
    return {
      address: pc,
      bytes: [op, b1, b2].slice(0, size),
      mnemonic: operand ? mnemonic + " " + operand : mnemonic,
      size,
    };
  };

  const captureHistory = () => {
    runtime.history.push(disassemble(runtime.lastAddress));
    if (runtime.history.length > 24) runtime.history.shift();
  };

  const step = (emuState = emu) => {
    if (emuState) emu = emuState;
    if (!emu) throw new Error("6510 CPU is not attached to an emulator");

    if (runtime.halted) {
      addCycles(2);
      runtime.lastOpCycles = 2;
      return runtime.haltedReason ? 1 : 0;
    }

    const beforeCycles = cpu.cycles;
    interruptBeforeInstruction();
    if (cpu.cycles !== beforeCycles) {
      runtime.lastOpCycles = cpu.cycles - beforeCycles;
      runtime.instructionCount += 1;
      return 0;
    }

    const pc = cpu.registers.pc;
    emu.debugHooks?.beforeInstruction?.(emu, pc, cpu);
    runtime.lastAddress = pc;
    const opcode = fetchByte();
    runtime.lastOpcode = opcode;

    try {
      executeOpcode(opcode);
    } catch (error) {
      runtime.halted = true;
      runtime.haltedReason = error?.message ?? String(error);
      runtime.warnings.push(runtime.haltedReason);
      if (runtime.warnings.length > 8) runtime.warnings.shift();
      emu.debugBreakRequested = true;
    }

    syncF();
    runtime.lastOpCycles = cpu.cycles - beforeCycles;
    runtime.instructionCount += 1;
    captureHistory();
    return runtime.halted && runtime.haltedReason ? 1 : 0;
  };

  const runUntilInterrupt = (emuState = emu, maxInstructions = manifest.cpu?.maxInstructionsPerFrame ?? 20000) => {
    const limit = Math.max(1, Number.parseInt(maxInstructions, 10) || 1);
    let count = 0;
    while (count < limit) {
      step(emuState);
      count += 1;
      if (emuState?.debugBreakRequested || runtime.halted) break;
    }
    return { instructions: count, cycleRollover: count >= limit, halted: runtime.halted };
  };

  const flagsForRegisters = (sourceRegisters) => [
    { name: "negative", mask: FLAG_N, set: (sourceRegisters.p & FLAG_N) !== 0 },
    { name: "overflow", mask: FLAG_V, set: (sourceRegisters.p & FLAG_V) !== 0 },
    { name: "break", mask: FLAG_B, set: (sourceRegisters.p & FLAG_B) !== 0 },
    { name: "decimal", mask: FLAG_D, set: (sourceRegisters.p & FLAG_D) !== 0 },
    { name: "interrupt", mask: FLAG_I, set: (sourceRegisters.p & FLAG_I) !== 0 },
    { name: "zero", mask: FLAG_Z, set: (sourceRegisters.p & FLAG_Z) !== 0 },
    { name: "carry", mask: FLAG_C, set: (sourceRegisters.p & FLAG_C) !== 0 },
  ];

  const cpu = {
    name: "MOS 6510",
    type: "cpu",
    registerDefs: REGISTER_DEFS,
    registers: initialRegisters(),
    flags: { carry: FLAG_C, zero: FLAG_Z, interrupt: FLAG_I, decimal: FLAG_D, break: FLAG_B, overflow: FLAG_V, negative: FLAG_N },
    cycles: 0,
    attach(emuState) { emu = emuState; },
    reset,
    step,
    runUntilInterrupt,
    disassemble,
    addCycles,
    getRegister(_emuState, name) {
      const key = String(name).toLowerCase();
      return key === "f" ? cpu.registers.p : (cpu.registers[key] ?? 0);
    },
    setRegister(_emuState, name, value) {
      const key = String(name).toLowerCase();
      if (key === "p" || key === "f") {
        cpu.registers.p = u8(value) | FLAG_U;
        syncF();
      } else if (key === "pc") {
        cpu.registers.pc = u16(value);
      } else if (key === "sp" || key === "a" || key === "x" || key === "y") {
        cpu.registers[key] = u8(value);
      }
    },
    setInput(input, pressed) {
      keyboardState.set(String(input).toLowerCase(), Boolean(pressed));
    },
    isInputPressed(input) {
      return Boolean(keyboardState.get(String(input).toLowerCase()));
    },
    keyboardSnapshot() {
      return Object.fromEntries(keyboardState.entries());
    },
    serializeState() {
      return {
        registers: { ...cpu.registers },
        cycles: cpu.cycles,
        runtime: {
          ...runtime,
          history: runtime.history.slice(),
          warnings: runtime.warnings.slice(),
        },
        keyboard: Object.fromEntries(keyboardState.entries()),
      };
    },
    restoreState(snapshot = {}) {
      const next = initialRegisters();
      Object.assign(next, snapshot.registers ?? {});
      for (const key of Object.keys(cpu.registers)) delete cpu.registers[key];
      Object.assign(cpu.registers, next);
      syncF();
      cpu.cycles = Number(snapshot.cycles) || 0;
      runtime = {
        ...resetRuntime(),
        ...(snapshot.runtime ?? {}),
        history: Array.isArray(snapshot.runtime?.history) ? snapshot.runtime.history : [],
        warnings: Array.isArray(snapshot.runtime?.warnings) ? snapshot.runtime.warnings : [],
      };
      keyboardState.clear();
      for (const [key, value] of Object.entries(snapshot.keyboard ?? {})) keyboardState.set(key, Boolean(value));
    },
    getDebugState(options = {}) {
      const debugRegisters = {};
      for (const def of REGISTER_DEFS) {
        const value = def.name === "f" ? cpu.registers.p : (cpu.registers[def.name] ?? 0);
        debugRegisters[def.name] = def.bits === 16 ? u16(value) : u8(value);
      }
      const historyLength = Math.max(0, Math.min(24, Number.parseInt(options.historyLength ?? 12, 10) || 0));
      const ports = emu?.mmu?.debugPorts?.(emu) ?? [0, 0, 0, 0, 0, 0, 0, 0];
      return {
        name: cpu.name,
        registers: debugRegisters,
        flags: flagsForRegisters(cpu.registers),
        cycles: cpu.cycles,
        totalCycles: cpu.cycles,
        lastOpCycles: runtime.lastOpCycles,
        lastOpcode: runtime.lastOpcode,
        lastAddress: runtime.lastAddress,
        instructionCount: runtime.instructionCount,
        interruptEnabled: !getFlag(FLAG_I),
        interruptVector: safeReadWord(0xfffe),
        ports,
        outputPorts: [],
        shiftRegister: 0,
        shiftOffset: 0,
        halted: runtime.halted,
        haltedReason: runtime.haltedReason,
        history: historyLength > 0 ? runtime.history.slice(-historyLength) : [],
        warnings: runtime.warnings.slice(-8),
        soundWrites: emu?.mmu?.soundWrites?.slice?.(-8) ?? [],
      };
    },
  };

  runtime = resetRuntime();
  return cpu;
};

export default create6510CPU;
