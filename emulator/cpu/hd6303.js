import createHD6303ALU from "./alu/hd6303.js";
import createHD6303Decoder from "./decoder/hd6303.js";
import { REGISTER_DEFS, createHD6303InitialRegisters } from "./registers/hd6303.js";

const u8 = (value) => value & 0xff;
const u16 = (value) => value & 0xffff;
const hex = (value, width) => "0x" + (value >>> 0).toString(16).toUpperCase().padStart(width, "0");

const createHD6303CPU = async (manifest = {}) => {
  let emu = null;
  let runtime = null;
  const keyboardState = new Map();

  const initialRegisters = () => createHD6303InitialRegisters(manifest);

  const resetRuntime = () => ({
    halted: false,
    haltedReason: "",
    lastOpCycles: 0,
    lastOpcode: 0,
    lastAddress: 0,
    instructionCount: 0,
    history: [],
    warnings: [],
  });

  const safeReadByte = (address) => {
    try {
      return emu?.mmu ? emu.mmu.readByte(emu, u16(address)) & 0xff : 0xff;
    } catch {
      return 0xff;
    }
  };

  const readWordBE = (address) => (safeReadByte(address) << 8) | safeReadByte(address + 1);

  const resetVector = () => {
    const vectorAddress = manifest.cpu?.resetVectorAddress;
    if (vectorAddress == null || !emu?.mmu) return null;
    const value = readWordBE(vectorAddress);
    return value === 0xffff ? null : u16(value);
  };

  const reset = (emuState = emu) => {
    if (emuState) emu = emuState;
    const next = initialRegisters();
    const vectorPc = resetVector();
    if (vectorPc != null) next.pc = vectorPc;
    for (const key of Object.keys(cpu.registers)) delete cpu.registers[key];
    Object.assign(cpu.registers, next);
    cpu.cycles = 0;
    runtime = resetRuntime();
    keyboardState.clear();
  };

  const decoder = createHD6303Decoder({ getPc: () => cpu.registers.pc, safeReadByte });
  const { disassemble } = decoder;

  const addCycles = (count) => {
    const cycles = Number(count) || 0;
    cpu.cycles += cycles;
    runtime.lastOpCycles = cycles;
  };

  const readByte = (address) => {
    if (!emu?.mmu) throw new Error("HD6303 CPU is not attached to an emulator MMU");
    return emu.mmu.readByte(emu, u16(address)) & 0xff;
  };

  const writeByte = (address, value) => {
    if (!emu?.mmu) throw new Error("HD6303 CPU is not attached to an emulator MMU");
    emu.mmu.writeByte(emu, u16(address), u8(value));
  };

  const fetchByte = () => {
    const value = readByte(cpu.registers.pc);
    cpu.registers.pc = u16(cpu.registers.pc + 1);
    return value;
  };

  const fetchWordBE = () => {
    const hi = fetchByte();
    const lo = fetchByte();
    return (hi << 8) | lo;
  };

  const writeWordBE = (address, value) => {
    writeByte(address, value >> 8);
    writeByte(address + 1, value);
  };

  const directAddress = () => fetchByte();
  const indexedAddress = () => u16(cpu.registers.x + (fetchByte() << 24 >> 24));
  const branchRelative = (enabled) => {
    const offset = fetchByte() << 24 >> 24;
    if (enabled) cpu.registers.pc = u16(cpu.registers.pc + offset);
  };

  const alu = createHD6303ALU({ getCpu: () => cpu, readByte, writeByte });
  const {
    FLAG_N, FLAG_Z, FLAG_V, FLAG_C,
    setFlag, setNZ8, setNZ16, getD, setD, compare8, subtractD, compare16,
    updateLogical8, updateLogical16, add8, subtract8, addD, binaryA, binaryB,
    branchCondition, setZ16Only, neg8, com8, lsr8, ror8, asr8, asl8, rol8,
    dec8, inc8, tst8, clr8, lsrD, aslD, updateMemoryByte, bitModify, bitTest,
  } = alu;

  const pushByte = (value) => {
    writeByte(cpu.registers.sp, value);
    cpu.registers.sp = u16(cpu.registers.sp - 1);
  };

  const pullByte = () => {
    cpu.registers.sp = u16(cpu.registers.sp + 1);
    return readByte(cpu.registers.sp);
  };

  const unsupported = (opcode) => {
    runtime.halted = true;
    runtime.haltedReason = "Unsupported HD6303 opcode " + hex(opcode, 2) + " at " + hex(runtime.lastAddress, 4);
    runtime.warnings.push(runtime.haltedReason);
    if (runtime.warnings.length > 16) runtime.warnings.shift();
    if (emu) emu.debugBreakRequested = true;
  };

  const executeOpcode = (opcode) => {
    switch (opcode) {
      case 0x01:
        addCycles(2);
        break;
      case 0x04:
        lsrD();
        addCycles(3);
        break;
      case 0x05:
        aslD();
        addCycles(3);
        break;
      case 0x20:
        branchRelative(true);
        addCycles(3);
        break;
      case 0x7e:
        cpu.registers.pc = fetchWordBE();
        addCycles(3);
        break;
      case 0xbe:
        cpu.registers.sp = setNZ16(readWordBE(fetchWordBE()));
        addCycles(6);
        break;
      case 0xbf:
        writeWordBE(fetchWordBE(), cpu.registers.sp);
        setNZ16(cpu.registers.sp);
        addCycles(7);
        break;
      case 0xbd: {
        const address = fetchWordBE();
        const returnAddress = cpu.registers.pc;
        pushByte(returnAddress & 0xff);
        pushByte(returnAddress >> 8);
        cpu.registers.pc = address;
        addCycles(8);
        break;
      }
      case 0x39: {
        const hi = pullByte();
        const lo = pullByte();
        cpu.registers.pc = (hi << 8) | lo;
        addCycles(5);
        break;
      }
      case 0x30:
        cpu.registers.x = u16(cpu.registers.sp + 1);
        addCycles(3);
        break;
      case 0x31:
        cpu.registers.sp = u16(cpu.registers.sp + 1);
        addCycles(3);
        break;
      case 0x32:
        cpu.registers.a = pullByte();
        addCycles(4);
        break;
      case 0x33:
        cpu.registers.b = pullByte();
        addCycles(4);
        break;
      case 0x34:
        cpu.registers.sp = u16(cpu.registers.sp - 1);
        addCycles(3);
        break;
      case 0x35:
        cpu.registers.sp = u16(cpu.registers.x - 1);
        addCycles(3);
        break;
      case 0x36:
        pushByte(cpu.registers.a);
        addCycles(4);
        break;
      case 0x37:
        pushByte(cpu.registers.b);
        addCycles(4);
        break;
      case 0x38: {
        const hi = pullByte();
        const lo = pullByte();
        cpu.registers.x = (hi << 8) | lo;
        addCycles(5);
        break;
      }
      case 0x3a:
        cpu.registers.x = u16(cpu.registers.x + cpu.registers.b);
        addCycles(3);
        break;
      case 0x3b: {
        cpu.registers.cc = pullByte();
        cpu.registers.b = pullByte();
        cpu.registers.a = pullByte();
        const xHi = pullByte();
        const xLo = pullByte();
        const pcHi = pullByte();
        const pcLo = pullByte();
        cpu.registers.x = (xHi << 8) | xLo;
        cpu.registers.pc = (pcHi << 8) | pcLo;
        addCycles(10);
        break;
      }
      case 0x3c:
        pushByte(cpu.registers.x & 0xff);
        pushByte(cpu.registers.x >> 8);
        addCycles(5);
        break;
      case 0x3d:
        setD(cpu.registers.a * cpu.registers.b);
        setFlag(FLAG_C, (cpu.registers.b & 0x80) !== 0);
        addCycles(7);
        break;
      case 0x3e:
        addCycles(9);
        break;
      case 0x3f: {
        const returnAddress = cpu.registers.pc;
        pushByte(returnAddress & 0xff);
        pushByte(returnAddress >> 8);
        pushByte(cpu.registers.x & 0xff);
        pushByte(cpu.registers.x >> 8);
        pushByte(cpu.registers.a);
        pushByte(cpu.registers.b);
        pushByte(cpu.registers.cc);
        cpu.registers.pc = readWordBE(0xfffa);
        addCycles(12);
        break;
      }
      case 0x06:
        cpu.registers.cc = cpu.registers.a;
        addCycles(2);
        break;
      case 0x07:
        cpu.registers.a = cpu.registers.cc;
        addCycles(2);
        break;
      case 0x08:
        cpu.registers.x = setZ16Only(cpu.registers.x + 1);
        addCycles(4);
        break;
      case 0x09:
        cpu.registers.x = setZ16Only(cpu.registers.x - 1);
        addCycles(4);
        break;
      case 0x0a:
        setFlag(FLAG_V, false);
        addCycles(2);
        break;
      case 0x0b:
        setFlag(FLAG_V, true);
        addCycles(2);
        break;
      case 0x0c:
        setFlag(FLAG_C, false);
        addCycles(2);
        break;
      case 0x0d:
        setFlag(FLAG_C, true);
        addCycles(2);
        break;
      case 0x0e:
        cpu.registers.cc = u8(cpu.registers.cc & ~0x10);
        addCycles(2);
        break;
      case 0x0f:
        cpu.registers.cc = u8(cpu.registers.cc | 0x10);
        addCycles(2);
        break;
      case 0x17:
        cpu.registers.a = setNZ8(cpu.registers.b);
        addCycles(2);
        break;
      case 0x18: {
        const d = getD();
        const x = cpu.registers.x;
        cpu.registers.a = u8(x >> 8);
        cpu.registers.b = u8(x);
        cpu.registers.x = u16(d);
        addCycles(3);
        break;
      }
      case 0x1a:
        addCycles(4);
        break;
      case 0x20:
        branchRelative(true);
        addCycles(3);
        break;
      case 0x26:
        branchRelative((cpu.registers.cc & FLAG_Z) === 0);
        addCycles(3);
        break;
      case 0x27:
        branchRelative((cpu.registers.cc & FLAG_Z) !== 0);
        addCycles(3);
        break;
      case 0x2b:
        branchRelative((cpu.registers.cc & FLAG_N) !== 0);
        addCycles(3);
        break;
      case 0x40:
        cpu.registers.a = neg8(cpu.registers.a);
        addCycles(2);
        break;
      case 0x43:
        cpu.registers.a = com8(cpu.registers.a);
        addCycles(2);
        break;
      case 0x44:
        cpu.registers.a = lsr8(cpu.registers.a);
        addCycles(2);
        break;
      case 0x46:
        cpu.registers.a = ror8(cpu.registers.a);
        addCycles(2);
        break;
      case 0x47:
        cpu.registers.a = asr8(cpu.registers.a);
        addCycles(2);
        break;
      case 0x48:
        cpu.registers.a = asl8(cpu.registers.a);
        addCycles(2);
        break;
      case 0x49:
        cpu.registers.a = rol8(cpu.registers.a);
        addCycles(2);
        break;
      case 0x4a:
        cpu.registers.a = dec8(cpu.registers.a);
        addCycles(2);
        break;
      case 0x4d:
        tst8(cpu.registers.a);
        addCycles(2);
        break;
      case 0x4f:
        cpu.registers.a = clr8();
        addCycles(2);
        break;
      case 0x50:
        cpu.registers.b = neg8(cpu.registers.b);
        addCycles(2);
        break;
      case 0x53:
        cpu.registers.b = com8(cpu.registers.b);
        addCycles(2);
        break;
      case 0x54:
        cpu.registers.b = lsr8(cpu.registers.b);
        addCycles(2);
        break;
      case 0x56:
        cpu.registers.b = ror8(cpu.registers.b);
        addCycles(2);
        break;
      case 0x57:
        cpu.registers.b = asr8(cpu.registers.b);
        addCycles(2);
        break;
      case 0x58:
        cpu.registers.b = asl8(cpu.registers.b);
        addCycles(2);
        break;
      case 0x59:
        cpu.registers.b = rol8(cpu.registers.b);
        addCycles(2);
        break;
      case 0x5a:
        cpu.registers.b = dec8(cpu.registers.b);
        addCycles(2);
        break;
      case 0x5d:
        tst8(cpu.registers.b);
        addCycles(2);
        break;
      case 0x5f:
        cpu.registers.b = clr8();
        addCycles(2);
        break;
      case 0x60:
        updateMemoryByte(indexedAddress(), neg8);
        addCycles(6);
        break;
      case 0x61: {
        const mask = fetchByte();
        bitModify(indexedAddress(), mask, "and");
        addCycles(7);
        break;
      }
      case 0x62: {
        const mask = fetchByte();
        bitModify(indexedAddress(), mask, "or");
        addCycles(7);
        break;
      }
      case 0x63:
        updateMemoryByte(indexedAddress(), com8);
        addCycles(6);
        break;
      case 0x64:
        updateMemoryByte(indexedAddress(), lsr8);
        addCycles(6);
        break;
      case 0x65: {
        const mask = fetchByte();
        bitModify(indexedAddress(), mask, "xor");
        addCycles(7);
        break;
      }
      case 0x66:
        updateMemoryByte(indexedAddress(), ror8);
        addCycles(6);
        break;
      case 0x67:
        updateMemoryByte(indexedAddress(), asr8);
        addCycles(6);
        break;
      case 0x68:
        updateMemoryByte(indexedAddress(), asl8);
        addCycles(6);
        break;
      case 0x69:
        updateMemoryByte(indexedAddress(), rol8);
        addCycles(6);
        break;
      case 0x6a:
        updateMemoryByte(indexedAddress(), dec8);
        addCycles(6);
        break;
      case 0x6b: {
        const mask = fetchByte();
        bitTest(indexedAddress(), mask);
        addCycles(5);
        break;
      }
      case 0x6c:
        updateMemoryByte(indexedAddress(), inc8);
        addCycles(6);
        break;
      case 0x6d:
        tst8(readByte(indexedAddress()));
        addCycles(4);
        break;
      case 0x6e:
        cpu.registers.pc = indexedAddress();
        addCycles(3);
        break;
      case 0x6f:
        updateMemoryByte(indexedAddress(), clr8);
        addCycles(6);
        break;
      case 0x70:
        updateMemoryByte(fetchWordBE(), neg8);
        addCycles(6);
        break;
      case 0x71: {
        const mask = fetchByte();
        const address = directAddress();
        bitModify(address, mask, "and");
        addCycles(6);
        break;
      }
      case 0x72: {
        const mask = fetchByte();
        const address = directAddress();
        bitModify(address, mask, "or");
        addCycles(6);
        break;
      }
      case 0x73:
        updateMemoryByte(fetchWordBE(), com8);
        addCycles(6);
        break;
      case 0x74:
        updateMemoryByte(fetchWordBE(), lsr8);
        addCycles(6);
        break;
      case 0x75: {
        const mask = fetchByte();
        const address = directAddress();
        bitModify(address, mask, "xor");
        addCycles(6);
        break;
      }
      case 0x76:
        updateMemoryByte(fetchWordBE(), ror8);
        addCycles(6);
        break;
      case 0x77:
        updateMemoryByte(fetchWordBE(), asr8);
        addCycles(6);
        break;
      case 0x78:
        updateMemoryByte(fetchWordBE(), asl8);
        addCycles(6);
        break;
      case 0x79:
        updateMemoryByte(fetchWordBE(), rol8);
        addCycles(6);
        break;
      case 0x7a:
        updateMemoryByte(fetchWordBE(), dec8);
        addCycles(6);
        break;
      case 0x7b: {
        const mask = fetchByte();
        const address = directAddress();
        bitTest(address, mask);
        addCycles(4);
        break;
      }
      case 0x7c:
        updateMemoryByte(fetchWordBE(), inc8);
        addCycles(6);
        break;
      case 0x7d:
        tst8(readByte(fetchWordBE()));
        addCycles(6);
        break;
      case 0x7e:
        cpu.registers.pc = fetchWordBE();
        addCycles(3);
        break;
      case 0x7f:
        updateMemoryByte(fetchWordBE(), clr8);
        addCycles(6);
        break;
      case 0x10:
        cpu.registers.a = subtract8(cpu.registers.a, cpu.registers.b);
        addCycles(2);
        break;
      case 0x11:
        compare8(cpu.registers.a, cpu.registers.b);
        addCycles(2);
        break;
      case 0x16:
        cpu.registers.b = updateLogical8(cpu.registers.a);
        addCycles(2);
        break;
      case 0x19:
        addCycles(2);
        break;
      case 0x1b:
        cpu.registers.a = add8(cpu.registers.a, cpu.registers.b);
        addCycles(2);
        break;
      case 0x21: case 0x22: case 0x23: case 0x24: case 0x25:
      case 0x28: case 0x29: case 0x2a: case 0x2c: case 0x2d: case 0x2e: case 0x2f:
        branchRelative(branchCondition(opcode));
        addCycles(3);
        break;
      case 0x4c:
        cpu.registers.a = inc8(cpu.registers.a);
        addCycles(2);
        break;
      case 0x5c:
        cpu.registers.b = inc8(cpu.registers.b);
        addCycles(2);
        break;
      case 0x80:
        binaryA(fetchByte(), "sub");
        addCycles(2);
        break;
      case 0x81:
        binaryA(fetchByte(), "cmp");
        addCycles(2);
        break;
      case 0x82:
        binaryA(fetchByte(), "sbc");
        addCycles(2);
        break;
      case 0x83:
        subtractD(fetchWordBE());
        addCycles(4);
        break;
      case 0x84:
        binaryA(fetchByte(), "and");
        addCycles(2);
        break;
      case 0x85:
        binaryA(fetchByte(), "bit");
        addCycles(2);
        break;
      case 0x88:
        binaryA(fetchByte(), "eor");
        addCycles(2);
        break;
      case 0x89:
        binaryA(fetchByte(), "adc");
        addCycles(2);
        break;
      case 0x8a:
        binaryA(fetchByte(), "ora");
        addCycles(2);
        break;
      case 0x8b:
        binaryA(fetchByte(), "add");
        addCycles(2);
        break;
      case 0x90:
        binaryA(readByte(directAddress()), "sub");
        addCycles(3);
        break;
      case 0x91:
        binaryA(readByte(directAddress()), "cmp");
        addCycles(3);
        break;
      case 0x92:
        binaryA(readByte(directAddress()), "sbc");
        addCycles(3);
        break;
      case 0x93:
        subtractD(readWordBE(directAddress()));
        addCycles(5);
        break;
      case 0x94:
        binaryA(readByte(directAddress()), "and");
        addCycles(3);
        break;
      case 0x95:
        binaryA(readByte(directAddress()), "bit");
        addCycles(3);
        break;
      case 0x96:
        binaryA(readByte(directAddress()), "lda");
        addCycles(3);
        break;
      case 0x97: {
        const address = directAddress();
        writeByte(address, cpu.registers.a);
        updateLogical8(cpu.registers.a);
        addCycles(4);
        break;
      }
      case 0x98:
        binaryA(readByte(directAddress()), "eor");
        addCycles(3);
        break;
      case 0x99:
        binaryA(readByte(directAddress()), "adc");
        addCycles(3);
        break;
      case 0x9a:
        binaryA(readByte(directAddress()), "ora");
        addCycles(3);
        break;
      case 0x9b:
        binaryA(readByte(directAddress()), "add");
        addCycles(3);
        break;
      case 0x9c:
        compare16(cpu.registers.x, readWordBE(directAddress()));
        addCycles(5);
        break;
      case 0x9d: {
        const address = directAddress();
        const returnAddress = cpu.registers.pc;
        pushByte(returnAddress & 0xff);
        pushByte(returnAddress >> 8);
        cpu.registers.pc = address;
        addCycles(7);
        break;
      }
      case 0x9e:
        cpu.registers.sp = updateLogical16(readWordBE(directAddress()));
        addCycles(4);
        break;
      case 0x9f:
        writeWordBE(directAddress(), cpu.registers.sp);
        updateLogical16(cpu.registers.sp);
        addCycles(5);
        break;
      case 0xa0:
        binaryA(readByte(indexedAddress()), "sub");
        addCycles(4);
        break;
      case 0xa2:
        binaryA(readByte(indexedAddress()), "sbc");
        addCycles(4);
        break;
      case 0xa4:
        binaryA(readByte(indexedAddress()), "and");
        addCycles(4);
        break;
      case 0xa5:
        binaryA(readByte(indexedAddress()), "bit");
        addCycles(4);
        break;
      case 0xa6:
        binaryA(readByte(indexedAddress()), "lda");
        addCycles(4);
        break;
      case 0xa8:
        binaryA(readByte(indexedAddress()), "eor");
        addCycles(4);
        break;
      case 0xa9:
        binaryA(readByte(indexedAddress()), "adc");
        addCycles(4);
        break;
      case 0xaa:
        binaryA(readByte(indexedAddress()), "ora");
        addCycles(4);
        break;
      case 0xab:
        binaryA(readByte(indexedAddress()), "add");
        addCycles(4);
        break;
      case 0xac:
        compare16(cpu.registers.x, readWordBE(indexedAddress()));
        addCycles(5);
        break;
      case 0xad: {
        const address = indexedAddress();
        const returnAddress = cpu.registers.pc;
        pushByte(returnAddress & 0xff);
        pushByte(returnAddress >> 8);
        cpu.registers.pc = address;
        addCycles(7);
        break;
      }
      case 0xae:
        cpu.registers.sp = updateLogical16(readWordBE(indexedAddress()));
        addCycles(5);
        break;
      case 0xaf:
        writeWordBE(indexedAddress(), cpu.registers.sp);
        updateLogical16(cpu.registers.sp);
        addCycles(6);
        break;
      case 0xb0:
        binaryA(readByte(fetchWordBE()), "sub");
        addCycles(4);
        break;
      case 0xb1:
        binaryA(readByte(fetchWordBE()), "cmp");
        addCycles(4);
        break;
      case 0xb2:
        binaryA(readByte(fetchWordBE()), "sbc");
        addCycles(4);
        break;
      case 0xb3:
        subtractD(readWordBE(fetchWordBE()));
        addCycles(6);
        break;
      case 0xb4:
        binaryA(readByte(fetchWordBE()), "and");
        addCycles(4);
        break;
      case 0xb5:
        binaryA(readByte(fetchWordBE()), "bit");
        addCycles(4);
        break;
      case 0xb6:
        binaryA(readByte(fetchWordBE()), "lda");
        addCycles(4);
        break;
      case 0xb8:
        binaryA(readByte(fetchWordBE()), "eor");
        addCycles(4);
        break;
      case 0xb9:
        binaryA(readByte(fetchWordBE()), "adc");
        addCycles(4);
        break;
      case 0xba:
        binaryA(readByte(fetchWordBE()), "ora");
        addCycles(4);
        break;
      case 0xbb:
        binaryA(readByte(fetchWordBE()), "add");
        addCycles(4);
        break;
      case 0xbc:
        compare16(cpu.registers.x, readWordBE(fetchWordBE()));
        addCycles(6);
        break;
      case 0xc0:
        binaryB(fetchByte(), "sub");
        addCycles(2);
        break;
      case 0xc1:
        binaryB(fetchByte(), "cmp");
        addCycles(2);
        break;
      case 0xc2:
        binaryB(fetchByte(), "sbc");
        addCycles(2);
        break;
      case 0xc3:
        addD(fetchWordBE());
        addCycles(4);
        break;
      case 0xc4:
        binaryB(fetchByte(), "and");
        addCycles(2);
        break;
      case 0xc5:
        binaryB(fetchByte(), "bit");
        addCycles(2);
        break;
      case 0xc8:
        binaryB(fetchByte(), "eor");
        addCycles(2);
        break;
      case 0xc9:
        binaryB(fetchByte(), "adc");
        addCycles(2);
        break;
      case 0xca:
        binaryB(fetchByte(), "orb");
        addCycles(2);
        break;
      case 0xcb:
        binaryB(fetchByte(), "add");
        addCycles(2);
        break;
      case 0xd0:
        binaryB(readByte(directAddress()), "sub");
        addCycles(3);
        break;
      case 0xd1:
        binaryB(readByte(directAddress()), "cmp");
        addCycles(3);
        break;
      case 0xd2:
        binaryB(readByte(directAddress()), "sbc");
        addCycles(3);
        break;
      case 0xd3:
        addD(readWordBE(directAddress()));
        addCycles(5);
        break;
      case 0xd4:
        binaryB(readByte(directAddress()), "and");
        addCycles(3);
        break;
      case 0xd5:
        binaryB(readByte(directAddress()), "bit");
        addCycles(3);
        break;
      case 0xd8:
        binaryB(readByte(directAddress()), "eor");
        addCycles(3);
        break;
      case 0xd9:
        binaryB(readByte(directAddress()), "adc");
        addCycles(3);
        break;
      case 0xda:
        binaryB(readByte(directAddress()), "orb");
        addCycles(3);
        break;
      case 0xdb:
        binaryB(readByte(directAddress()), "add");
        addCycles(3);
        break;
      case 0xdc:
        setD(readWordBE(directAddress()));
        addCycles(4);
        break;
      case 0xde:
        cpu.registers.x = updateLogical16(readWordBE(directAddress()));
        addCycles(4);
        break;
      case 0xe0:
        binaryB(readByte(indexedAddress()), "sub");
        addCycles(4);
        break;
      case 0xe2:
        binaryB(readByte(indexedAddress()), "sbc");
        addCycles(4);
        break;
      case 0xe3:
        addD(readWordBE(indexedAddress()));
        addCycles(5);
        break;
      case 0xe4:
        binaryB(readByte(indexedAddress()), "and");
        addCycles(4);
        break;
      case 0xe5:
        binaryB(readByte(indexedAddress()), "bit");
        addCycles(4);
        break;
      case 0xe6:
        binaryB(readByte(indexedAddress()), "ldb");
        addCycles(4);
        break;
      case 0xe8:
        binaryB(readByte(indexedAddress()), "eor");
        addCycles(4);
        break;
      case 0xe9:
        binaryB(readByte(indexedAddress()), "adc");
        addCycles(4);
        break;
      case 0xea:
        binaryB(readByte(indexedAddress()), "orb");
        addCycles(4);
        break;
      case 0xeb:
        binaryB(readByte(indexedAddress()), "add");
        addCycles(4);
        break;
      case 0xee:
        cpu.registers.x = updateLogical16(readWordBE(indexedAddress()));
        addCycles(5);
        break;
      case 0xef:
        writeWordBE(indexedAddress(), cpu.registers.x);
        updateLogical16(cpu.registers.x);
        addCycles(6);
        break;
      case 0xf0:
        binaryB(readByte(fetchWordBE()), "sub");
        addCycles(4);
        break;
      case 0xf1:
        binaryB(readByte(fetchWordBE()), "cmp");
        addCycles(4);
        break;
      case 0xf2:
        binaryB(readByte(fetchWordBE()), "sbc");
        addCycles(4);
        break;
      case 0xf3:
        addD(readWordBE(fetchWordBE()));
        addCycles(6);
        break;
      case 0xf4:
        binaryB(readByte(fetchWordBE()), "and");
        addCycles(4);
        break;
      case 0xf5:
        binaryB(readByte(fetchWordBE()), "bit");
        addCycles(4);
        break;
      case 0xf6:
        binaryB(readByte(fetchWordBE()), "ldb");
        addCycles(4);
        break;
      case 0xf7: {
        const address = fetchWordBE();
        writeByte(address, cpu.registers.b);
        updateLogical8(cpu.registers.b);
        addCycles(5);
        break;
      }
      case 0xf8:
        binaryB(readByte(fetchWordBE()), "eor");
        addCycles(4);
        break;
      case 0xf9:
        binaryB(readByte(fetchWordBE()), "adc");
        addCycles(4);
        break;
      case 0xfa:
        binaryB(readByte(fetchWordBE()), "orb");
        addCycles(4);
        break;
      case 0xfb:
        binaryB(readByte(fetchWordBE()), "add");
        addCycles(4);
        break;
      case 0xfc:
        setD(readWordBE(fetchWordBE()));
        addCycles(5);
        break;
      case 0xfd:
        writeWordBE(fetchWordBE(), getD());
        updateLogical16(getD());
        addCycles(6);
        break;
      case 0x86:
        cpu.registers.a = setNZ8(fetchByte());
        addCycles(2);
        break;
      case 0x8c:
        compare16(cpu.registers.x, fetchWordBE());
        addCycles(4);
        break;
      case 0x8d: {
        const offset = fetchByte() << 24 >> 24;
        const returnAddress = cpu.registers.pc;
        pushByte(returnAddress & 0xff);
        pushByte(returnAddress >> 8);
        cpu.registers.pc = u16(cpu.registers.pc + offset);
        addCycles(7);
        break;
      }
      case 0x8e:
        cpu.registers.sp = setNZ16(fetchWordBE());
        addCycles(3);
        break;
      case 0x96:
        cpu.registers.a = setNZ8(readByte(directAddress()));
        addCycles(3);
        break;
      case 0x97:
        writeByte(directAddress(), cpu.registers.a);
        setNZ8(cpu.registers.a);
        addCycles(4);
        break;
      case 0xa3:
        subtractD(readWordBE(indexedAddress()));
        addCycles(5);
        break;
      case 0xa1:
        compare8(cpu.registers.a, readByte(indexedAddress()));
        addCycles(4);
        break;
      case 0xa7:
        writeByte(indexedAddress(), cpu.registers.a);
        setNZ8(cpu.registers.a);
        addCycles(4);
        break;
      case 0xb7:
        writeByte(fetchWordBE(), cpu.registers.a);
        setNZ8(cpu.registers.a);
        addCycles(5);
        break;
      case 0xbd: {
        const address = fetchWordBE();
        const returnAddress = cpu.registers.pc;
        pushByte(returnAddress & 0xff);
        pushByte(returnAddress >> 8);
        cpu.registers.pc = address;
        addCycles(8);
        break;
      }
      case 0xc6:
        cpu.registers.b = setNZ8(fetchByte());
        addCycles(2);
        break;
      case 0xcc:
        setD(fetchWordBE());
        addCycles(3);
        break;
      case 0xce:
        cpu.registers.x = setNZ16(fetchWordBE());
        addCycles(3);
        break;
      case 0xd6:
        cpu.registers.b = setNZ8(readByte(directAddress()));
        addCycles(3);
        break;
      case 0xd7:
        writeByte(directAddress(), cpu.registers.b);
        setNZ8(cpu.registers.b);
        addCycles(4);
        break;
      case 0xdd:
        writeWordBE(directAddress(), getD());
        setNZ16(getD());
        addCycles(5);
        break;
      case 0xdf:
        writeWordBE(directAddress(), cpu.registers.x);
        setNZ16(cpu.registers.x);
        addCycles(5);
        break;
      case 0xfe:
        cpu.registers.x = setNZ16(readWordBE(fetchWordBE()));
        addCycles(6);
        break;
      case 0xff:
        writeWordBE(fetchWordBE(), cpu.registers.x);
        setNZ16(cpu.registers.x);
        addCycles(7);
        break;
      case 0xec:
        setD(readWordBE(indexedAddress()));
        addCycles(5);
        break;
      case 0xed:
        writeWordBE(indexedAddress(), getD());
        setNZ16(getD());
        addCycles(5);
        break;
      case 0xe1:
        compare8(cpu.registers.b, readByte(indexedAddress()));
        addCycles(4);
        break;
      case 0xe7:
        writeByte(indexedAddress(), cpu.registers.b);
        setNZ8(cpu.registers.b);
        addCycles(4);
        break;
      default:
        unsupported(opcode);
        addCycles(1);
        break;
    }
  };

  const captureHistory = () => {
    runtime.history.push(disassemble(runtime.lastAddress));
    if (runtime.history.length > 24) runtime.history.shift();
  };

  const step = (emuState = emu) => {
    if (emuState) emu = emuState;
    if (!emu) throw new Error("HD6303 CPU is not attached to an emulator");

    if (runtime.halted) {
      addCycles(1);
      return runtime.haltedReason ? 1 : 0;
    }

    emu.debugHooks?.beforeInstruction?.(emu, cpu.registers.pc, cpu);
    runtime.lastAddress = cpu.registers.pc;
    const opcode = fetchByte();
    runtime.lastOpcode = opcode;
    executeOpcode(opcode);
    runtime.instructionCount += 1;
    captureHistory();
    return runtime.halted && runtime.haltedReason ? 1 : 0;
  };

  const runUntilInterrupt = (emuState = emu, maxInstructions = manifest.cpu?.maxInstructionsPerFrame ?? 5000) => {
    const limit = Math.max(1, Number.parseInt(maxInstructions, 10) || 1);
    let count = 0;
    while (count < limit) {
      step(emuState);
      count += 1;
      if (emuState?.debugBreakRequested || runtime.halted) break;
    }
    return { instructions: count, cycleRollover: count >= limit, halted: runtime.halted };
  };

  const cpu = {
    name: "Hitachi HD6303",
    type: "cpu",
    registerDefs: REGISTER_DEFS,
    registers: initialRegisters(),
    cycles: 0,
    attach(emuState) { emu = emuState; },
    reset,
    step,
    runUntilInterrupt,
    disassemble,
    getRegister(_emuState, register) {
      const name = String(register).toLowerCase();
      if (!(name in cpu.registers)) throw new Error("Unknown register: " + register);
      return name === "pc" || name === "sp" || name === "x" ? u16(cpu.registers[name]) : u8(cpu.registers[name]);
    },
    setRegister(_emuState, register, value) {
      const name = String(register).toLowerCase();
      if (!(name in cpu.registers)) throw new Error("Unknown register: " + register);
      cpu.registers[name] = name === "pc" || name === "sp" || name === "x" ? u16(Number(value)) : u8(Number(value));
    },
    setInput(input, pressed) {
      keyboardState.set(String(input), Boolean(pressed));
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
      const registers = {};
      for (const def of REGISTER_DEFS) {
        const value = cpu.registers[def.name] ?? 0;
        registers[def.name] = def.bits === 16 ? u16(value) : u8(value);
      }
      const historyLength = Math.max(0, Math.min(24, Number.parseInt(options.historyLength ?? 12, 10) || 0));
      return {
        name: cpu.name,
        registers,
        flags: [
          { name: "carry", mask: 0x01, set: (registers.cc & 0x01) !== 0 },
          { name: "zero", mask: 0x04, set: (registers.cc & 0x04) !== 0 },
          { name: "negative", mask: 0x08, set: (registers.cc & 0x08) !== 0 },
          { name: "interrupt", mask: 0x10, set: (registers.cc & 0x10) !== 0 },
        ],
        cycles: cpu.cycles,
        totalCycles: cpu.cycles,
        lastOpCycles: runtime.lastOpCycles,
        lastOpcode: runtime.lastOpcode,
        lastAddress: runtime.lastAddress,
        instructionCount: runtime.instructionCount,
        interruptEnabled: (registers.cc & 0x10) === 0,
        interruptVector: 0,
        ports: [],
        outputPorts: [],
        shiftRegister: 0,
        shiftOffset: 0,
        halted: runtime.halted,
        haltedReason: runtime.haltedReason,
        history: historyLength > 0 ? runtime.history.slice(-historyLength) : [],
        warnings: runtime.warnings.slice(-8),
        soundWrites: [],
        keyboard: Object.fromEntries(keyboardState.entries()),
      };
    },
  };

  runtime = resetRuntime();
  return cpu;
};

export default createHD6303CPU;
