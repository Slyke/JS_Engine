import createI8080ALU from './alu/i8080.js';
import createI8080Decoder from './decoder/i8080.js';
import {
  DEFAULT_DEBUG_SAMPLE_INSTRUCTION_INTERVAL,
  FLAG,
  INTERRUPT_INTERVAL,
  REG_NAMES,
  REGISTER_DEFS,
  RP_NAMES,
  createI8080State,
  flagsForRegisters,
} from './registers/i8080.js';

const u8 = (value) => value & 0xff;
const u16 = (value) => value & 0xffff;
const hex = (value, width) => '0x' + u16(value).toString(16).toUpperCase().padStart(width, '0');

const createI8080CPU = async (manifest = {}) => {
  let emu;
  let state;

  const resetState = () => createI8080State(manifest);

  const applyInputDefaults = () => {
    state.ports[0x01] = manifest.cpu?.inputDefaults?.port1 ?? 0x08;
    state.ports[0x02] = manifest.cpu?.inputDefaults?.port2 ?? 0x00;
  };

  state = resetState();
  applyInputDefaults();

  const debugSampleInstructionInterval = Math.max(1, Number.parseInt(manifest.cpu?.debugSampleInstructionInterval ?? DEFAULT_DEBUG_SAMPLE_INSTRUCTION_INTERVAL, 10) || DEFAULT_DEBUG_SAMPLE_INSTRUCTION_INTERVAL);
  const debugSampleIgnoredPcs = new Set((manifest.cpu?.debugSampleIgnorePcs ?? [0x08, 0x10]).map((address) => u16(address)));

  const snapshotDebugSample = (pcOverride = null) => {
    const registers = { ...state.registers };
    if (pcOverride != null) registers.pc = u16(pcOverride);
    return {
      registers,
      cycles: state.cycles,
      totalCycles: state.totalCycles,
      lastOpCycles: state.lastOpCycles,
      lastOpcode: state.lastOpcode,
      lastAddress: state.lastAddress,
      instructionCount: state.instructionCount,
      interruptEnabled: state.interruptEnabled,
      interruptVector: state.interruptVector,
      ports: Array.from(state.ports.slice(0, 8)),
      outputPorts: Array.from(state.outputPorts.slice(0, 8)),
      shiftRegister: state.shiftRegister,
      shiftOffset: state.shiftOffset,
      halted: state.halted,
      haltedReason: state.haltedReason,
    };
  };

  const captureDebugSample = (pcOverride = null) => {
    state.debugSample = snapshotDebugSample(pcOverride);
    state.nextDebugSampleInstruction = state.instructionCount + debugSampleInstructionInterval;
  };

  const captureStackSample = () => {
    state.stackSample = {
      sp: u16(state.registers.sp),
      pc: u16(state.lastAddress ?? state.registers.pc),
      totalCycles: state.totalCycles,
      instructionCount: state.instructionCount,
    };
  };

  const shouldCaptureDebugSample = (pc) => {
    if (debugSampleIgnoredPcs.has(u16(pc))) return false;
    return state.debugSample == null || state.instructionCount >= state.nextDebugSampleInstruction;
  };

  const mmu = () => {
    if (!emu?.mmu) throw new Error('i8080 CPU is not attached to an emulator MMU');
    return emu.mmu;
  };

  const readByte = (address) => mmu().readByte(emu, u16(address));
  const writeByte = (address, value) => mmu().writeByte(emu, u16(address), u8(value));
  const readWord = (address) => readByte(address) | (readByte(address + 1) << 8);
  const writeWord = (address, value) => {
    writeByte(address, value);
    writeByte(address + 1, value >> 8);
  };

  const getHL = () => (state.registers.h << 8) | state.registers.l;
  const setHL = (value) => {
    state.registers.h = (value >> 8) & 0xff;
    state.registers.l = value & 0xff;
  };

  const getPair = (pair) => {
    switch (pair) {
      case 'bc': return (state.registers.b << 8) | state.registers.c;
      case 'de': return (state.registers.d << 8) | state.registers.e;
      case 'hl': return getHL();
      case 'sp': return state.registers.sp;
      case 'psw': return (state.registers.a << 8) | (state.registers.f | 0x02);
      default: throw new Error('Unknown register pair: ' + pair);
    }
  };

  const setPair = (pair, value) => {
    const next = u16(value);
    switch (pair) {
      case 'bc':
        state.registers.b = (next >> 8) & 0xff;
        state.registers.c = next & 0xff;
        break;
      case 'de':
        state.registers.d = (next >> 8) & 0xff;
        state.registers.e = next & 0xff;
        break;
      case 'hl':
        setHL(next);
        break;
      case 'sp':
        state.registers.sp = next;
        captureStackSample();
        break;
      case 'psw':
        state.registers.a = (next >> 8) & 0xff;
        state.registers.f = (next & 0xd7) | 0x02;
        break;
      default:
        throw new Error('Unknown register pair: ' + pair);
    }
  };

  const getReg = (index) => {
    const name = REG_NAMES[index];
    return name === 'm' ? readByte(getHL()) : state.registers[name];
  };

  const setReg = (index, value) => {
    const name = REG_NAMES[index];
    if (name === 'm') writeByte(getHL(), value);
    else state.registers[name] = u8(value);
  };

  const setFlag = (mask, set) => {
    if (set) state.registers.f |= mask;
    else state.registers.f &= (~mask) & 0xff;
    state.registers.f |= 0x02;
  };

  const getFlag = (mask) => (state.registers.f & mask) === mask;

  const alu = createI8080ALU({
    getState: () => state,
    getHL,
    setHL,
    setFlag,
    getFlag,
    flagDefs: FLAG,
  });
  const { setSZP, add, sub, ana, xra, ora, inr, dcr, dad } = alu;

  const push = (value) => {
    const next = u16(value);
    state.registers.sp = u16(state.registers.sp - 1);
    writeByte(state.registers.sp, next >> 8);
    state.registers.sp = u16(state.registers.sp - 1);
    writeByte(state.registers.sp, next);
    captureStackSample();
  };

  const pop = () => {
    const lo = readByte(state.registers.sp);
    state.registers.sp = u16(state.registers.sp + 1);
    const hi = readByte(state.registers.sp);
    state.registers.sp = u16(state.registers.sp + 1);
    captureStackSample();
    return (hi << 8) | lo;
  };

  const call = (address) => {
    push(state.registers.pc);
    state.registers.pc = u16(address);
  };

  const ret = () => {
    state.registers.pc = pop();
  };

  const condition = (index) => {
    switch (index) {
      case 0: return !getFlag(FLAG.zero);
      case 1: return getFlag(FLAG.zero);
      case 2: return !getFlag(FLAG.carry);
      case 3: return getFlag(FLAG.carry);
      case 4: return !getFlag(FLAG.parity);
      case 5: return getFlag(FLAG.parity);
      case 6: return !getFlag(FLAG.sign);
      case 7: return getFlag(FLAG.sign);
      default: return false;
    }
  };

  const fetchByte = () => {
    const value = readByte(state.registers.pc);
    state.registers.pc = u16(state.registers.pc + 1);
    return value;
  };

  const fetchWord = () => {
    const lo = fetchByte();
    const hi = fetchByte();
    return (hi << 8) | lo;
  };

  const readPort = (port) => {
    const p = port & 0xff;
    switch (p) {
      case 0x01: return state.ports[0x01];
      case 0x02: return state.ports[0x02];
      case 0x03: return (state.shiftRegister >> (8 - state.shiftOffset)) & 0xff;
      default: return state.ports[p];
    }
  };

  const writePort = (port, value) => {
    const p = port & 0xff;
    const v = value & 0xff;
    const previousValue = state.outputPorts[p];
    state.outputPorts[p] = v;
    emu?.audio?.writePort?.(emu, p, v, {
      cycle: state.totalCycles,
      previousValue,
    });
    switch (p) {
      case 0x02:
        state.shiftOffset = v & 0x07;
        break;
      case 0x04:
        state.shiftRegister = ((v << 8) | (state.shiftRegister >> 8)) & 0xffff;
        break;
      case 0x03:
      case 0x05:
        state.soundWrites.push({ port: p, value: v, cycle: state.totalCycles });
        if (state.soundWrites.length > 64) state.soundWrites.shift();
        break;
      default:
        break;
    }
  };

  const addCycles = (cycles) => {
    state.lastOpCycles = cycles;
    state.cycles += cycles;
    state.totalCycles += cycles;
    state.interruptCounter += cycles;
  };

  const serviceInterruptClock = () => {
    if (state.interruptCounter < INTERRUPT_INTERVAL) return;
    state.interruptCounter -= INTERRUPT_INTERVAL;
    state.cycleRollover = true;
    const vector = state.interruptVector;
    state.interruptVector = vector === 0x08 ? 0x10 : 0x08;
    if (state.interruptEnabled) {
      state.interruptEnabled = false;
      state.halted = false;
      push(state.registers.pc);
      state.registers.pc = vector;
    }
  };

  const unsupported = (opcode) => {
    state.halted = true;
    state.haltedReason = 'Unsupported 8080 opcode ' + hex(opcode, 2) + ' at ' + hex(state.lastAddress, 4);
    state.warnings.push(state.haltedReason);
    if (state.warnings.length > 32) state.warnings.shift();
  };

  const executeOpcode = (opcode) => {
    if ((opcode & 0xc0) === 0x40) {
      if (opcode === 0x76) {
        state.halted = true;
        addCycles(7);
        return;
      }
      const dst = (opcode >> 3) & 0x07;
      const src = opcode & 0x07;
      setReg(dst, getReg(src));
      addCycles(dst === 6 || src === 6 ? 7 : 5);
      return;
    }

    if ((opcode & 0xc7) === 0x06) {
      const dst = (opcode >> 3) & 0x07;
      setReg(dst, fetchByte());
      addCycles(dst === 6 ? 10 : 7);
      return;
    }

    if ((opcode & 0xc7) === 0x04) {
      const dst = (opcode >> 3) & 0x07;
      setReg(dst, inr(getReg(dst)));
      addCycles(dst === 6 ? 10 : 5);
      return;
    }

    if ((opcode & 0xc7) === 0x05) {
      const dst = (opcode >> 3) & 0x07;
      setReg(dst, dcr(getReg(dst)));
      addCycles(dst === 6 ? 10 : 5);
      return;
    }

    if ((opcode & 0xc0) === 0x80) {
      const op = (opcode >> 3) & 0x07;
      const src = opcode & 0x07;
      const value = getReg(src);
      switch (op) {
        case 0: add(value); break;
        case 1: add(value, getFlag(FLAG.carry) ? 1 : 0); break;
        case 2: sub(value); break;
        case 3: sub(value, getFlag(FLAG.carry) ? 1 : 0); break;
        case 4: ana(value); break;
        case 5: xra(value); break;
        case 6: ora(value); break;
        case 7: sub(value, 0, true); break;
        default: break;
      }
      addCycles(src === 6 ? 7 : 4);
      return;
    }

    switch (opcode) {
      case 0x00: case 0x08: case 0x10: case 0x18:
      case 0x20: case 0x28: case 0x30: case 0x38:
        addCycles(4);
        break;
      case 0x01: case 0x11: case 0x21: case 0x31:
        setPair(RP_NAMES[(opcode >> 4) & 0x03], fetchWord());
        addCycles(10);
        break;
      case 0x02:
        writeByte(getPair('bc'), state.registers.a);
        addCycles(7);
        break;
      case 0x12:
        writeByte(getPair('de'), state.registers.a);
        addCycles(7);
        break;
      case 0x0a:
        state.registers.a = readByte(getPair('bc'));
        addCycles(7);
        break;
      case 0x1a:
        state.registers.a = readByte(getPair('de'));
        addCycles(7);
        break;
      case 0x03: case 0x13: case 0x23: case 0x33: {
        const pair = RP_NAMES[(opcode >> 4) & 0x03];
        setPair(pair, getPair(pair) + 1);
        addCycles(5);
        break;
      }
      case 0x0b: case 0x1b: case 0x2b: case 0x3b: {
        const pair = RP_NAMES[(opcode >> 4) & 0x03];
        setPair(pair, getPair(pair) - 1);
        addCycles(5);
        break;
      }
      case 0x09: case 0x19: case 0x29: case 0x39:
        dad(getPair(RP_NAMES[(opcode >> 4) & 0x03]));
        addCycles(10);
        break;
      case 0x07: {
        const carry = (state.registers.a >> 7) & 1;
        state.registers.a = ((state.registers.a << 1) | carry) & 0xff;
        setFlag(FLAG.carry, carry === 1);
        addCycles(4);
        break;
      }
      case 0x0f: {
        const carry = state.registers.a & 1;
        state.registers.a = ((carry << 7) | (state.registers.a >> 1)) & 0xff;
        setFlag(FLAG.carry, carry === 1);
        addCycles(4);
        break;
      }
      case 0x17: {
        const carryIn = getFlag(FLAG.carry) ? 1 : 0;
        const carryOut = (state.registers.a >> 7) & 1;
        state.registers.a = ((state.registers.a << 1) | carryIn) & 0xff;
        setFlag(FLAG.carry, carryOut === 1);
        addCycles(4);
        break;
      }
      case 0x1f: {
        const carryIn = getFlag(FLAG.carry) ? 0x80 : 0;
        const carryOut = state.registers.a & 1;
        state.registers.a = (carryIn | (state.registers.a >> 1)) & 0xff;
        setFlag(FLAG.carry, carryOut === 1);
        addCycles(4);
        break;
      }
      case 0x22: {
        const address = fetchWord();
        writeByte(address, state.registers.l);
        writeByte(address + 1, state.registers.h);
        addCycles(16);
        break;
      }
      case 0x2a: {
        const address = fetchWord();
        state.registers.l = readByte(address);
        state.registers.h = readByte(address + 1);
        addCycles(16);
        break;
      }
      case 0x32:
        writeByte(fetchWord(), state.registers.a);
        addCycles(13);
        break;
      case 0x3a:
        state.registers.a = readByte(fetchWord());
        addCycles(13);
        break;
      case 0x27: {
        let correction = 0;
        let carry = getFlag(FLAG.carry);
        const before = state.registers.a;
        if ((before & 0x0f) > 9 || getFlag(FLAG.halfcarry)) correction |= 0x06;
        if (before > 0x99 || carry) {
          correction |= 0x60;
          carry = true;
        }
        const out = before + correction;
        state.registers.a = out & 0xff;
        setSZP(state.registers.a);
        setFlag(FLAG.carry, carry);
        setFlag(FLAG.halfcarry, ((before ^ correction ^ out) & 0x10) !== 0);
        addCycles(4);
        break;
      }
      case 0x2f:
        state.registers.a ^= 0xff;
        addCycles(4);
        break;
      case 0x37:
        setFlag(FLAG.carry, true);
        addCycles(4);
        break;
      case 0x3f:
        setFlag(FLAG.carry, !getFlag(FLAG.carry));
        addCycles(4);
        break;
      case 0xc1: case 0xd1: case 0xe1:
        setPair(RP_NAMES[(opcode >> 4) & 0x03], pop());
        addCycles(10);
        break;
      case 0xf1:
        setPair('psw', pop());
        addCycles(10);
        break;
      case 0xc5: case 0xd5: case 0xe5:
        push(getPair(RP_NAMES[(opcode >> 4) & 0x03]));
        addCycles(11);
        break;
      case 0xf5:
        push(getPair('psw'));
        addCycles(11);
        break;
      case 0xc0: case 0xc8: case 0xd0: case 0xd8:
      case 0xe0: case 0xe8: case 0xf0: case 0xf8: {
        const taken = condition((opcode >> 3) & 0x07);
        if (taken) ret();
        addCycles(taken ? 11 : 5);
        break;
      }
      case 0xc9: case 0xd9:
        ret();
        addCycles(10);
        break;
      case 0xc2: case 0xca: case 0xd2: case 0xda:
      case 0xe2: case 0xea: case 0xf2: case 0xfa: {
        const address = fetchWord();
        if (condition((opcode >> 3) & 0x07)) state.registers.pc = address;
        addCycles(10);
        break;
      }
      case 0xc3: case 0xcb:
        state.registers.pc = fetchWord();
        addCycles(10);
        break;
      case 0xc4: case 0xcc: case 0xd4: case 0xdc:
      case 0xe4: case 0xec: case 0xf4: case 0xfc: {
        const address = fetchWord();
        const taken = condition((opcode >> 3) & 0x07);
        if (taken) call(address);
        addCycles(taken ? 17 : 11);
        break;
      }
      case 0xcd: case 0xdd: case 0xed: case 0xfd:
        call(fetchWord());
        addCycles(17);
        break;
      case 0xc6:
        add(fetchByte());
        addCycles(7);
        break;
      case 0xce:
        add(fetchByte(), getFlag(FLAG.carry) ? 1 : 0);
        addCycles(7);
        break;
      case 0xd6:
        sub(fetchByte());
        addCycles(7);
        break;
      case 0xde:
        sub(fetchByte(), getFlag(FLAG.carry) ? 1 : 0);
        addCycles(7);
        break;
      case 0xe6:
        ana(fetchByte());
        addCycles(7);
        break;
      case 0xee:
        xra(fetchByte());
        addCycles(7);
        break;
      case 0xf6:
        ora(fetchByte());
        addCycles(7);
        break;
      case 0xfe:
        sub(fetchByte(), 0, true);
        addCycles(7);
        break;
      case 0xc7: case 0xcf: case 0xd7: case 0xdf:
      case 0xe7: case 0xef: case 0xf7: case 0xff:
        call(opcode & 0x38);
        addCycles(11);
        break;
      case 0xd3:
        writePort(fetchByte(), state.registers.a);
        addCycles(10);
        break;
      case 0xdb:
        state.registers.a = readPort(fetchByte());
        addCycles(10);
        break;
      case 0xe3: {
        const lo = readByte(state.registers.sp);
        const hi = readByte(state.registers.sp + 1);
        writeByte(state.registers.sp, state.registers.l);
        writeByte(state.registers.sp + 1, state.registers.h);
        state.registers.l = lo;
        state.registers.h = hi;
        addCycles(18);
        break;
      }
      case 0xe9:
        state.registers.pc = getHL();
        addCycles(5);
        break;
      case 0xeb: {
        const de = getPair('de');
        setPair('de', getHL());
        setHL(de);
        addCycles(5);
        break;
      }
      case 0xf3:
        state.interruptEnabled = false;
        addCycles(4);
        break;
      case 0xf9:
        state.registers.sp = getHL();
        captureStackSample();
        addCycles(5);
        break;
      case 0xfb:
        state.interruptEnabled = true;
        addCycles(4);
        break;
      default:
        unsupported(opcode);
        addCycles(4);
        break;
    }
  };

  const decoder = createI8080Decoder({ getState: () => state, readByte });
  const { disassemble } = decoder;

  const step = (emuState = emu) => {
    if (emuState) emu = emuState;
    if (state.halted) {
      addCycles(4);
      captureDebugSample(state.registers.pc);
      serviceInterruptClock();
      return 0;
    }
    emuState?.debugHooks?.beforeInstruction?.(emuState, state.registers.pc, cpu);
    state.lastAddress = state.registers.pc;
    if (shouldCaptureDebugSample(state.lastAddress)) captureDebugSample(state.lastAddress);
    const opcode = fetchByte();
    state.lastOpcode = opcode;
    const beforeCycles = state.totalCycles;
    executeOpcode(opcode);
    state.instructionCount += 1;
    state.history.push(disassemble(state.lastAddress));
    if (state.history.length > 24) state.history.shift();
    if (state.totalCycles === beforeCycles) addCycles(4);
    serviceInterruptClock();
    return state.halted && state.haltedReason ? 1 : 0;
  };

  const runUntilInterrupt = (emuState = emu, maxInstructions = 50000) => {
    state.cycleRollover = false;
    let count = 0;
    while (!state.cycleRollover && count < maxInstructions) {
      step(emuState);
      count += 1;
      if (emuState?.debugBreakRequested || (state.halted && state.haltedReason)) break;
    }
    return { instructions: count, cycleRollover: state.cycleRollover, halted: state.halted };
  };

  const cpu = {
    name: 'Intel 8080',
    type: 'cpu',
    flags: FLAG,
    registerDefs: REGISTER_DEFS,
    attach(emuState) { emu = emuState; },
    reset() { state = resetState(); applyInputDefaults(); },
    step,
    runUntilInterrupt,
    disassemble,
    getRegister(_emuState, register) {
      const name = String(register).toLowerCase();
      if (!(name in state.registers)) throw new Error('Unknown register: ' + register);
      return name === 'pc' || name === 'sp' ? state.registers[name] & 0xffff : state.registers[name] & 0xff;
    },
    setRegister(_emuState, register, value) {
      const name = String(register).toLowerCase();
      if (!(name in state.registers)) throw new Error('Unknown register: ' + register);
      if (name === 'pc' || name === 'sp') state.registers[name] = u16(Number(value));
      else if (name === 'f') state.registers.f = (u8(Number(value)) & 0xd7) | 0x02;
      else state.registers[name] = u8(Number(value));
    },
    setInput(input, pressed) {
      const bit = { coin: 0x01, start2: 0x02, start1: 0x04, shoot: 0x10, left: 0x20, right: 0x40 }[input];
      if (!bit) return;
      if (pressed) state.ports[0x01] |= bit;
      else state.ports[0x01] &= (0xff - bit);
    },
    serializeState() {
      return {
        registers: { ...state.registers },
        halted: state.halted,
        interruptEnabled: state.interruptEnabled,
        cycles: state.cycles,
        totalCycles: state.totalCycles,
        lastOpCycles: state.lastOpCycles,
        lastOpcode: state.lastOpcode,
        lastAddress: state.lastAddress,
        instructionCount: state.instructionCount,
        interruptCounter: state.interruptCounter,
        interruptVector: state.interruptVector,
        cycleRollover: state.cycleRollover,
        lastOpcode: state.lastOpcode,
        lastAddress: state.lastAddress,
        history: state.history.slice(),
        ports: Array.from(state.ports),
        outputPorts: Array.from(state.outputPorts),
        shiftRegister: state.shiftRegister,
        shiftOffset: state.shiftOffset,
        soundWrites: state.soundWrites.slice(),
        warnings: state.warnings.slice(),
        haltedReason: state.haltedReason,
      };
    },
    restoreState(snapshot) {
      if (!snapshot || typeof snapshot !== "object") throw new Error("Invalid CPU state snapshot");
      const base = resetState();
      state = {
        ...base,
        ...snapshot,
        registers: { ...base.registers, ...(snapshot.registers ?? {}) },
        ports: new Uint8Array(snapshot.ports ?? 0x100),
        outputPorts: new Uint8Array(snapshot.outputPorts ?? 0x100),
        history: Array.isArray(snapshot.history) ? snapshot.history : [],
        soundWrites: Array.isArray(snapshot.soundWrites) ? snapshot.soundWrites : [],
        warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings : [],
      };
    },
    getDebugState(options = {}) {
      const sample = options?.preferSample ? state.debugSample : null;
      const stackSample = options?.preferSample ? state.stackSample : null;
      const sourceRegisters = sample?.registers ?? state.registers;
      const registers = {};
      for (const def of REGISTER_DEFS) {
        const value = def.name === 'sp' && stackSample ? stackSample.sp : (sourceRegisters[def.name] ?? 0);
        registers[def.name] = def.bits === 16 ? u16(value) : u8(value);
      }
      return {
        name: cpu.name,
        registers,
        flags: flagsForRegisters(sourceRegisters),
        cycles: sample?.cycles ?? state.cycles,
        totalCycles: sample?.totalCycles ?? state.totalCycles,
        lastOpCycles: sample?.lastOpCycles ?? state.lastOpCycles,
        lastOpcode: sample?.lastOpcode ?? state.lastOpcode,
        lastAddress: sample?.lastAddress ?? state.lastAddress,
        instructionCount: sample?.instructionCount ?? state.instructionCount,
        interruptEnabled: sample?.interruptEnabled ?? state.interruptEnabled,
        interruptVector: sample?.interruptVector ?? state.interruptVector,
        ports: sample?.ports ?? Array.from(state.ports.slice(0, 8)),
        outputPorts: sample?.outputPorts ?? Array.from(state.outputPorts.slice(0, 8)),
        shiftRegister: sample?.shiftRegister ?? state.shiftRegister,
        shiftOffset: sample?.shiftOffset ?? state.shiftOffset,
        halted: sample?.halted ?? state.halted,
        haltedReason: sample?.haltedReason ?? state.haltedReason,
        history: (() => {
          const length = Math.max(0, Math.min(24, Number.parseInt(options?.historyLength ?? 12, 10) || 0));
          return length > 0 ? state.history.slice(-length) : [];
        })(),
        warnings: state.warnings.slice(-8),
        soundWrites: state.soundWrites.slice(-8),
        stackSample: stackSample ? { ...stackSample } : null,
      };
    },
  };

  return cpu;
};

export default createI8080CPU;
