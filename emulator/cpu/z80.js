const REGISTER_DEFS = Object.freeze([
  { name: "pc", bits: 16 },
  { name: "sp", bits: 16 },
  { name: "a", bits: 8 },
  { name: "f", bits: 8 },
  { name: "b", bits: 8 },
  { name: "c", bits: 8 },
  { name: "d", bits: 8 },
  { name: "e", bits: 8 },
  { name: "h", bits: 8 },
  { name: "l", bits: 8 },
  { name: "ix", bits: 16 },
  { name: "iy", bits: 16 },
  { name: "i", bits: 8 },
  { name: "r", bits: 8 },
]);

const u8 = (value) => value & 0xff;
const u16 = (value) => value & 0xffff;
const hex = (value, width) => "0x" + (value >>> 0).toString(16).toUpperCase().padStart(width, "0");

const createZ80CPU = async (config, configBaseDir = ".") => {
  const loadModule = async (relativePath) => {
    if (typeof window !== "undefined") {
      const base = typeof configBaseDir === "string"
        ? new URL(configBaseDir, import.meta.url)
        : new URL("./", import.meta.url);
      const href = new URL(relativePath, base).href;
      return (await import(href)).default;
    }

    const path = await import("path");
    const { pathToFileURL } = await import("url");
    const full = pathToFileURL(path.join(configBaseDir, relativePath)).href;
    return (await import(full)).default;
  };

  const flagDefs = () => ({
    sign: 0x80,
    zero: 0x40,
    halfcarry: 0x10,
    parity: 0x04,
    subtract: 0x02,
    carry: 0x01,
  });

  const [aluMod, regMod, controlMod, decoderMod] = await Promise.all([
    loadModule(config.cpu.alu),
    loadModule(config.cpu.registers),
    loadModule(config.cpu.control),
    loadModule(config.cpu.decoder),
  ]);

  const registers = regMod();
  const control = controlMod();
  const alu = aluMod({
    getRegister: registers.getRegister,
    setRegister: registers.setRegister,
    flagDefs: flagDefs(),
  });
  const decoder = decoderMod();

  let emu = null;
  let runtime = null;
  const keyboardState = new Map();

  const initialRegisters = () => ({
    ...registers.registerBank(),
    pc: u16(config.cpu?.initialPc ?? 0),
    sp: u16(config.cpu?.initialSp ?? 0),
  });

  const resetRuntime = () => ({
    halted: false,
    haltedReason: "",
    interruptEnabled: false,
    interruptVector: 0,
    interruptMode: 0,
    lastOpCycles: 0,
    lastOpcode: 0,
    lastAddress: 0,
    instructionCount: 0,
    history: [],
    warnings: [],
  });

  const flagsForRegisters = (sourceRegisters) => Object.entries(flagDefs()).map(([name, mask]) => ({
    name,
    mask,
    set: (sourceRegisters.f & mask) === mask,
  }));

  const readByte = (emuState, address) => {
    const fetch = emuState.mmu.fetchByte ?? emuState.mmu.readByte;
    return fetch(emuState, u16(address));
  };

  const fetchRedirectFor = (address) => {
    for (const redirect of config.cpu?.fetchRedirects ?? []) {
      const start = u16(redirect.start ?? 0);
      const end = u16(redirect.end ?? start);
      const pc = u16(address);
      if (pc >= start && pc <= end) return u16(redirect.target ?? pc);
    }
    return null;
  };

  const readByteForDisassembly = (address) => {
    try {
      return emu?.mmu ? readByte(emu, address) : 0xff;
    } catch {
      return 0xff;
    }
  };

  const disassemble = (address = cpu.registers.pc) => {
    const pc = u16(address);
    const op = readByteForDisassembly(pc);
    const p1 = readByteForDisassembly(pc + 1);
    const p2 = readByteForDisassembly(pc + 2);
    const p3 = readByteForDisassembly(pc + 3);
    const word = (p2 << 8) | p1;
    let size = 1;
    let mnemonic = "DB " + hex(op, 2);

    const signed8 = (value) => (value & 0x80) ? value - 0x100 : value;
    const imm8 = () => hex(p1, 2);
    const imm16 = () => hex(word, 4);
    const relTarget = () => hex(u16(pc + 2 + signed8(p1)), 4);
    const regNames = ["B", "C", "D", "E", "H", "L", "(HL)", "A"];
    const rpNames = ["BC", "DE", "HL", "SP"];
    const rp2Names = ["BC", "DE", "HL", "AF"];
    const conditionNames = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"];
    const reg = (index) => regNames[index & 7];
    const rp = (index) => rpNames[index & 3];
    const rp2 = (index) => rp2Names[index & 3];
    const indexedDisp = (indexName, displacement) => {
      const offset = signed8(displacement);
      if (offset === 0) return "(" + indexName + ")";
      return "(" + indexName + (offset < 0 ? "-" + hex(-offset, 2) : "+" + hex(offset, 2)) + ")";
    };

    if (op === 0x00) mnemonic = "NOP";
    else if ([0x01, 0x11, 0x21, 0x31].includes(op)) { size = 3; mnemonic = "LD " + rp(op >> 4) + "," + imm16(); }
    else if (op === 0x02 || op === 0x12) mnemonic = "LD (" + (op === 0x02 ? "BC" : "DE") + "),A";
    else if (op === 0x0A || op === 0x1A) mnemonic = "LD A,(" + (op === 0x0A ? "BC" : "DE") + ")";
    else if ([0x03, 0x13, 0x23, 0x33].includes(op)) mnemonic = "INC " + rp(op >> 4);
    else if ([0x0B, 0x1B, 0x2B, 0x3B].includes(op)) mnemonic = "DEC " + rp(op >> 4);
    else if ([0x09, 0x19, 0x29, 0x39].includes(op)) mnemonic = "ADD HL," + rp(op >> 4);
    else if ((op & 0xC7) === 0x04) mnemonic = "INC " + reg(op >> 3);
    else if ((op & 0xC7) === 0x05) mnemonic = "DEC " + reg(op >> 3);
    else if ((op & 0xC7) === 0x06) { size = 2; mnemonic = "LD " + reg(op >> 3) + "," + imm8(); }
    else if (op === 0x07) mnemonic = "RLCA";
    else if (op === 0x0F) mnemonic = "RRCA";
    else if (op === 0x17) mnemonic = "RLA";
    else if (op === 0x1F) mnemonic = "RRA";
    else if (op === 0x10) { size = 2; mnemonic = "DJNZ " + relTarget(); }
    else if (op === 0x18) { size = 2; mnemonic = "JR " + relTarget(); }
    else if ([0x20, 0x28, 0x30, 0x38].includes(op)) { size = 2; mnemonic = "JR " + conditionNames[(op >> 3) & 3] + "," + relTarget(); }
    else if (op === 0x22) { size = 3; mnemonic = "LD (" + imm16() + "),HL"; }
    else if (op === 0x2A) { size = 3; mnemonic = "LD HL,(" + imm16() + ")"; }
    else if (op === 0x32) { size = 3; mnemonic = "LD (" + imm16() + "),A"; }
    else if (op === 0x3A) { size = 3; mnemonic = "LD A,(" + imm16() + ")"; }
    else if (op === 0x27) mnemonic = "DAA";
    else if (op === 0x2F) mnemonic = "CPL";
    else if (op === 0x37) mnemonic = "SCF";
    else if (op === 0x3F) mnemonic = "CCF";
    else if ((op & 0xC0) === 0x40) mnemonic = op === 0x76 ? "HALT" : "LD " + reg(op >> 3) + "," + reg(op);
    else if ((op & 0xC0) === 0x80) {
      const ops = ["ADD A,", "ADC A,", "SUB ", "SBC A,", "AND ", "XOR ", "OR ", "CP "];
      mnemonic = ops[(op >> 3) & 7] + reg(op);
    } else if ((op & 0xC7) === 0xC0) mnemonic = "RET " + conditionNames[(op >> 3) & 7];
    else if ((op & 0xC7) === 0xC2) { size = 3; mnemonic = "JP " + conditionNames[(op >> 3) & 7] + "," + imm16(); }
    else if ((op & 0xC7) === 0xC4) { size = 3; mnemonic = "CALL " + conditionNames[(op >> 3) & 7] + "," + imm16(); }
    else if ((op & 0xC7) === 0xC7) mnemonic = "RST " + hex(op & 0x38, 2);
    else if ((op & 0xCF) === 0xC1) mnemonic = "POP " + rp2(op >> 4);
    else if ((op & 0xCF) === 0xC5) mnemonic = "PUSH " + rp2(op >> 4);
    else if (op === 0xC3) { size = 3; mnemonic = "JP " + imm16(); }
    else if (op === 0xC9) mnemonic = "RET";
    else if (op === 0xCD) { size = 3; mnemonic = "CALL " + imm16(); }
    else if (op === 0xD3) { size = 2; mnemonic = "OUT (" + imm8() + "),A"; }
    else if (op === 0xDB) { size = 2; mnemonic = "IN A,(" + imm8() + ")"; }
    else if (op === 0xE3) mnemonic = "EX (SP),HL";
    else if (op === 0xE9) mnemonic = "JP (HL)";
    else if (op === 0xEB) mnemonic = "EX DE,HL";
    else if (op === 0xF3) mnemonic = "DI";
    else if (op === 0xF9) mnemonic = "LD SP,HL";
    else if (op === 0xFB) mnemonic = "EI";
    else if ([0xC6, 0xCE, 0xD6, 0xDE, 0xE6, 0xEE, 0xF6, 0xFE].includes(op)) {
      size = 2;
      mnemonic = ({ 0xC6: "ADD A,", 0xCE: "ADC A,", 0xD6: "SUB ", 0xDE: "SBC A,", 0xE6: "AND ", 0xEE: "XOR ", 0xF6: "OR ", 0xFE: "CP " })[op] + imm8();
    } else if (op === 0xED) {
      const edWord = (p3 << 8) | p2;
      const edPair = rp((p1 >> 4) & 3);
      size = 2;
      mnemonic = "DB 0xED," + hex(p1, 2);
      if ([0x43, 0x53, 0x63, 0x73].includes(p1)) { size = 4; mnemonic = "LD (" + hex(edWord, 4) + ")," + edPair; }
      else if ([0x4B, 0x5B, 0x6B, 0x7B].includes(p1)) { size = 4; mnemonic = "LD " + edPair + ",(" + hex(edWord, 4) + ")"; }
      else if ([0x42, 0x52, 0x62, 0x72].includes(p1)) mnemonic = "SBC HL," + edPair;
      else if ([0x4A, 0x5A, 0x6A, 0x7A].includes(p1)) mnemonic = "ADC HL," + edPair;
      else if (p1 === 0x47) mnemonic = "LD I,A";
      else if (p1 === 0x4F) mnemonic = "LD R,A";
      else if (p1 === 0x57) mnemonic = "LD A,I";
      else if (p1 === 0x5F) mnemonic = "LD A,R";
      else if ([0x46, 0x4E, 0x66, 0x6E].includes(p1)) mnemonic = "IM 0";
      else if ([0x56, 0x76].includes(p1)) mnemonic = "IM 1";
      else if ([0x5E, 0x7E].includes(p1)) mnemonic = "IM 2";
      else if ([0x45, 0x4D, 0x55, 0x5D, 0x65, 0x6D, 0x75, 0x7D].includes(p1)) mnemonic = p1 === 0x4D ? "RETI" : "RETN";
      else if ([0xA0, 0xA8, 0xB0, 0xB8].includes(p1)) mnemonic = ({ 0xA0: "LDI", 0xA8: "LDD", 0xB0: "LDIR", 0xB8: "LDDR" })[p1];
      else if ([0xA3, 0xAB, 0xB3, 0xBB].includes(p1)) mnemonic = ({ 0xA3: "OUTI", 0xAB: "OUTD", 0xB3: "OTIR", 0xBB: "OTDR" })[p1];
    } else if (op === 0xDD || op === 0xFD) {
      const indexName = op === 0xDD ? "IX" : "IY";
      const indexAddress = indexedDisp(indexName, p2);
      const indexWord = (p3 << 8) | p2;
      size = 2;
      mnemonic = "DB " + hex(op, 2) + "," + hex(p1, 2);
      if (p1 === 0x21) { size = 4; mnemonic = "LD " + indexName + "," + hex(indexWord, 4); }
      else if (p1 === 0x22) { size = 4; mnemonic = "LD (" + hex(indexWord, 4) + ")," + indexName; }
      else if (p1 === 0x2A) { size = 4; mnemonic = "LD " + indexName + ",(" + hex(indexWord, 4) + ")"; }
      else if (p1 === 0x34) { size = 3; mnemonic = "INC " + indexAddress; }
      else if (p1 === 0x35) { size = 3; mnemonic = "DEC " + indexAddress; }
      else if (p1 === 0x36) { size = 4; mnemonic = "LD " + indexAddress + "," + hex(p3, 2); }
      else if ([0x46, 0x4E, 0x56, 0x5E, 0x66, 0x6E, 0x7E].includes(p1)) { size = 3; mnemonic = "LD " + reg(p1 >> 3) + "," + indexAddress; }
      else if ([0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x77].includes(p1)) { size = 3; mnemonic = "LD " + indexAddress + "," + reg(p1); }
      else if ([0x86, 0x8E, 0x96, 0x9E, 0xA6, 0xAE, 0xB6, 0xBE].includes(p1)) { size = 3; mnemonic = ({ 0x86: "ADD A,", 0x8E: "ADC A,", 0x96: "SUB ", 0x9E: "SBC A,", 0xA6: "AND ", 0xAE: "XOR ", 0xB6: "OR ", 0xBE: "CP " })[p1] + indexAddress; }
      else if ([0x09, 0x19, 0x29, 0x39].includes(p1)) mnemonic = "ADD " + indexName + "," + (p1 === 0x29 ? indexName : rp(p1 >> 4));
      else if (p1 === 0x23) mnemonic = "INC " + indexName;
      else if (p1 === 0x2B) mnemonic = "DEC " + indexName;
      else if (p1 === 0xE1) mnemonic = "POP " + indexName;
      else if (p1 === 0xE3) mnemonic = "EX (SP)," + indexName;
      else if (p1 === 0xE5) mnemonic = "PUSH " + indexName;
      else if (p1 === 0xE9) mnemonic = "JP (" + indexName + ")";
      else if (p1 === 0xF9) mnemonic = "LD SP," + indexName;
      else if (p1 === 0xCB) { size = 4; mnemonic = "CB " + indexAddress + "," + hex(p3, 2); }
    } else if (op === 0xCB) {
      size = 2;
      const bit = (p1 >> 3) & 7;
      if ((p1 & 0xC0) === 0x40) mnemonic = "BIT " + bit + "," + reg(p1);
      else if ((p1 & 0xC0) === 0x80) mnemonic = "RES " + bit + "," + reg(p1);
      else if ((p1 & 0xC0) === 0xC0) mnemonic = "SET " + bit + "," + reg(p1);
      else mnemonic = ["RLC", "RRC", "RL", "RR", "SLA", "SRA", "SLL", "SRL"][(p1 >> 3) & 7] + " " + reg(p1);
    }

    return { address: pc, bytes: [op, p1, p2, p3].slice(0, size), mnemonic, size };
  };

  const addCycles = (emuState, count) => {
    const target = emuState?.cpu ?? cpu;
    target.cycles = (target.cycles ?? 0) + (Number(count) || 0);
  };

  const reset = () => {
    const next = initialRegisters();
    for (const key of Object.keys(cpu.registers)) delete cpu.registers[key];
    Object.assign(cpu.registers, next);
    cpu.cycles = 0;
    runtime = resetRuntime();
    keyboardState.clear();
  };

  const captureHistory = () => {
    runtime.history.push(disassemble(runtime.lastAddress));
    if (runtime.history.length > 24) runtime.history.shift();
  };

  const step = (emuState = emu) => {
    if (emuState) emu = emuState;
    if (!emu) throw new Error("Z80 CPU is not attached to an emulator");

    if (runtime.halted) {
      const beforeHaltCycles = cpu.cycles;
      addCycles(emu, 4);
      runtime.lastOpCycles = cpu.cycles - beforeHaltCycles;
      return runtime.haltedReason ? 1 : 0;
    }

    let pc = cpu.getRegister(emu, "pc");
    const redirectPc = fetchRedirectFor(pc);
    if (redirectPc != null) {
      cpu.setRegister(emu, "pc", redirectPc);
      pc = redirectPc;
    }
    emu.debugHooks?.beforeInstruction?.(emu, pc, cpu);
    runtime.lastAddress = pc;
    const opcode = readByte(emu, pc);
    runtime.lastOpcode = opcode;
    cpu.registers.r = ((cpu.registers.r ?? 0) + 1) & 0x7f;
    cpu.setRegister(emu, "pc", pc + 1);

    const beforeCycles = cpu.cycles;
    try {
      const instruction = decoder.decode(emu, opcode);
      instruction(emu);
    } catch (error) {
      runtime.halted = true;
      runtime.haltedReason = error?.message ?? String(error);
      runtime.warnings.push(runtime.haltedReason);
      if (runtime.warnings.length > 8) runtime.warnings.shift();
      emu.debugBreakRequested = true;
    }

    if (cpu.cycles === beforeCycles) addCycles(emu, 4);
    runtime.lastOpCycles = cpu.cycles - beforeCycles;
    runtime.instructionCount += 1;
    captureHistory();
    return runtime.halted && runtime.haltedReason ? 1 : 0;
  };

  const runUntilInterrupt = (emuState = emu, maxInstructions = config.cpu?.maxInstructionsPerFrame ?? 50000) => {
    const limit = Math.max(1, Number.parseInt(maxInstructions, 10) || 1);
    let count = 0;
    while (count < limit) {
      step(emuState);
      count += 1;
      if (emuState?.debugBreakRequested || runtime.halted) break;
    }
    return { instructions: count, cycleRollover: count >= limit, halted: runtime.halted };
  };

  const exx = () => {
    for (const [left, right] of [["b", "b_"], ["c", "c_"], ["d", "d_"], ["e", "e_"], ["h", "h_"], ["l", "l_"]]) {
      const tmp = cpu.registers[left];
      cpu.registers[left] = cpu.registers[right] ?? 0;
      cpu.registers[right] = tmp ?? 0;
    }
  };

  const cpu = {
    name: "Z80",
    type: "cpu",
    registerDefs: REGISTER_DEFS,
    registers: initialRegisters(),
    getRegister: registers.getRegister,
    setRegister: registers.setRegister,
    pins: control.pins,
    setPins: control.setPins,
    clearPins: control.clearPins,
    alu,
    flags: flagDefs(),
    decoder,
    addCycles,
    cycles: 0,
    attach(emuState) { emu = emuState; },
    reset,
    step,
    runUntilInterrupt,
    disassemble,
    exx,
    getAltAF() {
      return ((cpu.registers.a_ ?? 0) << 8) | (cpu.registers.f_ ?? 0);
    },
    setAltAF(_emuState, value) {
      cpu.registers.a_ = u8(value >> 8);
      cpu.registers.f_ = u8(value);
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
    setInterruptMode(_emuState, mode) {
      runtime.interruptMode = Number(mode) || 0;
    },
    setInterruptEnabled(_emuState, enabled) {
      runtime.interruptEnabled = Boolean(enabled);
    },
    halt(_emuState, reason = "") {
      runtime.halted = true;
      runtime.haltedReason = reason;
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
      const debugRegisters = {};
      for (const def of REGISTER_DEFS) {
        const value = cpu.registers[def.name] ?? 0;
        debugRegisters[def.name] = def.bits === 16 ? u16(value) : u8(value);
      }
      const historyLength = Math.max(0, Math.min(24, Number.parseInt(options.historyLength ?? 12, 10) || 0));
      const rawPorts = emu?.io?.raw ? Array.from(emu.io.raw.slice(0, 8)) : Array(8).fill(0);
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
        interruptEnabled: runtime.interruptEnabled,
        interruptVector: runtime.interruptVector,
        ports: rawPorts,
        outputPorts: [],
        shiftRegister: 0,
        shiftOffset: 0,
        halted: runtime.halted,
        haltedReason: runtime.haltedReason,
        history: historyLength > 0 ? runtime.history.slice(-historyLength) : [],
        warnings: runtime.warnings.slice(-8),
        soundWrites: [],
      };
    },
  };

  runtime = resetRuntime();
  return cpu;
};

export default createZ80CPU;
