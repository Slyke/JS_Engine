// z80-decoder.js - basic instruction decoder for Z80

const createZ80Decoder = () => {

  const decode = (emuState, opcode) => {
    const cpu = emuState.cpu;
    const mmu = emuState.mmu;
    const flags = emuState.cpu.flags;
    const pc = cpu.getRegister(emuState, 'pc');
    const fetchByte = (address) => mmu.fetchByte ? mmu.fetchByte(emuState, address) : mmu.readByte(emuState, address);

    const readImmediate = () => {
      const pcImm = cpu.getRegister(emuState, 'pc');
      const value = fetchByte(pcImm);
      cpu.setRegister(emuState, 'pc', pcImm + 1);
      return value;
    };

    const regMap = ["b", "c", "d", "e", "h", "l", null, "a"];
    const high3 = (opcode >> 3) & 0b111;
    const low3 = opcode & 0b111;

    const readImmediateWord = () => {
      const lo = readImmediate();
      const hi = readImmediate();
      return (hi << 8) | lo;
    };
    const pairNames = { bc: ["b", "c"], de: ["d", "e"], hl: ["h", "l"], af: ["a", "f"] };
    const pairForOpcode = (pairs = ["bc", "de", "hl", "sp"]) => pairs[(opcode >> 4) & 0b11];
    const getPair = (pair) => pair === "sp" ? cpu.getRegister(emuState, "sp") : ((cpu.getRegister(emuState, pairNames[pair][0]) << 8) | cpu.getRegister(emuState, pairNames[pair][1]));
    const setPair = (pair, value) => {
      const word = value & 0xffff;
      if (pair === "sp") { cpu.setRegister(emuState, "sp", word); return; }
      cpu.setRegister(emuState, pairNames[pair][0], word >> 8);
      cpu.setRegister(emuState, pairNames[pair][1], word);
    };
    const hlAddress = () => getPair("hl");
    const readRegOrHL = (reg) => reg === null ? mmu.readByte(emuState, hlAddress()) : cpu.getRegister(emuState, reg);
    const writeRegOrHL = (reg, value) => { if (reg === null) mmu.writeByte(emuState, hlAddress(), value); else cpu.setRegister(emuState, reg, value); };
    const parityEven = (value) => { let bits = value & 0xff; bits ^= bits >> 4; bits ^= bits >> 2; bits ^= bits >> 1; return (bits & 1) === 0; };
    const setLogicFlags = (result, halfcarry = false) => {
      const value = result & 0xff;
      let f = 0;
      if (value & 0x80) f |= flags.sign;
      if (value === 0) f |= flags.zero;
      if (halfcarry) f |= flags.halfcarry;
      if (parityEven(value)) f |= flags.parity;
      cpu.setRegister(emuState, "f", f);
      return value;
    };
    const setIncFlags = (before, result) => {
      const carry = cpu.getRegister(emuState, "f") & flags.carry;
      const value = result & 0xff;
      let f = carry;
      if (value & 0x80) f |= flags.sign;
      if (value === 0) f |= flags.zero;
      if (((before ^ value) & 0x10) !== 0) f |= flags.halfcarry;
      if (before === 0x7f) f |= flags.parity;
      cpu.setRegister(emuState, "f", f);
      return value;
    };
    const setDecFlags = (before, result) => {
      const carry = cpu.getRegister(emuState, "f") & flags.carry;
      const value = result & 0xff;
      let f = carry | flags.subtract;
      if (value & 0x80) f |= flags.sign;
      if (value === 0) f |= flags.zero;
      if (((before ^ value) & 0x10) !== 0) f |= flags.halfcarry;
      if (before === 0x80) f |= flags.parity;
      cpu.setRegister(emuState, "f", f);
      return value;
    };
    const setCompareFlags = (lhs, rhs) => {
      const result = lhs - rhs;
      const value = result & 0xff;
      let f = flags.subtract;
      if (value & 0x80) f |= flags.sign;
      if (value === 0) f |= flags.zero;
      if (((lhs ^ rhs ^ value) & 0x10) !== 0) f |= flags.halfcarry;
      if ((((lhs ^ rhs) & (lhs ^ value)) & 0x80) !== 0) f |= flags.parity;
      if (result < 0) f |= flags.carry;
      cpu.setRegister(emuState, "f", f);
    };
    const conditionMet = (index) => {
      const f = cpu.getRegister(emuState, "f");
      switch (index & 0b111) {
        case 0: return (f & flags.zero) === 0;
        case 1: return (f & flags.zero) !== 0;
        case 2: return (f & flags.carry) === 0;
        case 3: return (f & flags.carry) !== 0;
        case 4: return (f & flags.parity) === 0;
        case 5: return (f & flags.parity) !== 0;
        case 6: return (f & flags.sign) === 0;
        case 7: return (f & flags.sign) !== 0;
        default: return false;
      }
    };
    const pushWord = (value) => { const sp = (cpu.getRegister(emuState, "sp") - 2) & 0xffff; mmu.writeByte(emuState, sp, value & 0xff); mmu.writeByte(emuState, sp + 1, (value >> 8) & 0xff); cpu.setRegister(emuState, "sp", sp); };
    const popWord = () => { const sp = cpu.getRegister(emuState, "sp"); const lo = mmu.readByte(emuState, sp); const hi = mmu.readByte(emuState, sp + 1); cpu.setRegister(emuState, "sp", sp + 2); return (hi << 8) | lo; };
    const readPort = (port) => emuState.io?.inByte ? emuState.io.inByte(emuState, port) : (emuState.io?.read?.(emuState, port) ?? 0xff);
    const writePort = (port, value) => { if (emuState.io?.outByte) emuState.io.outByte(emuState, port, value); else emuState.io?.write?.(emuState, port, value); };

    // Prefix handling
    if (opcode === 0xED) {
      const extOpcode = fetchByte(pc);
      cpu.setRegister(emuState, 'pc', pc + 1);
      return decodeED(emuState, extOpcode);
    }
  
    if (opcode === 0xDD) {
      const extOpcode = fetchByte(pc);
      cpu.setRegister(emuState, 'pc', pc + 1);
      return decodeDD(emuState, extOpcode);
    }
    
    if (opcode === 0xFD) {
      const extOpcode = fetchByte(pc);
      cpu.setRegister(emuState, 'pc', pc + 1);
      return decodeFD(emuState, extOpcode);
    }

    if (opcode === 0xCB) {
      const extOpcode = fetchByte(pc);
      cpu.setRegister(emuState, 'pc', pc + 1);
      return decodeCB(emuState, extOpcode);
    }

    switch (opcode) {
      // NOP
      case 0x00:
        return () => {
          cpu.setPins({ m1: true });
          cpu.addCycles(emuState, 4);
        };

      // LD dd, nn
      case 0x01: case 0x11: case 0x21: case 0x31:
        return () => { setPair(pairForOpcode(), readImmediateWord()); cpu.addCycles(emuState, 10); };

      // LD (BC/DE), A and LD A, (BC/DE)
      case 0x02: case 0x12:
        return () => { const pair = opcode === 0x02 ? "bc" : "de"; mmu.writeByte(emuState, getPair(pair), cpu.getRegister(emuState, "a")); cpu.addCycles(emuState, 7); };
      case 0x0A: case 0x1A:
        return () => { const pair = opcode === 0x0A ? "bc" : "de"; cpu.setRegister(emuState, "a", mmu.readByte(emuState, getPair(pair))); cpu.addCycles(emuState, 7); };

      // INC r / DEC r
      case 0x04: case 0x0C: case 0x14: case 0x1C:
      case 0x24: case 0x2C: case 0x3C:
        return () => { const reg = regMap[(opcode >> 3) & 0b111]; const before = cpu.getRegister(emuState, reg); cpu.setRegister(emuState, reg, setIncFlags(before, before + 1)); cpu.addCycles(emuState, 4); };
      case 0x34:
        return () => { const address = hlAddress(); const before = mmu.readByte(emuState, address); mmu.writeByte(emuState, address, setIncFlags(before, before + 1)); cpu.addCycles(emuState, 11); };
      case 0x05: case 0x0D: case 0x15: case 0x1D:
      case 0x25: case 0x2D: case 0x3D:
        return () => { const reg = regMap[(opcode >> 3) & 0b111]; const before = cpu.getRegister(emuState, reg); cpu.setRegister(emuState, reg, setDecFlags(before, before - 1)); cpu.addCycles(emuState, 4); };
      case 0x35:
        return () => { const address = hlAddress(); const before = mmu.readByte(emuState, address); mmu.writeByte(emuState, address, setDecFlags(before, before - 1)); cpu.addCycles(emuState, 11); };

      // INC dd / DEC dd / ADD HL,dd
      case 0x0B: case 0x1B: case 0x2B: case 0x3B:
        return () => { const pair = pairForOpcode(); setPair(pair, getPair(pair) - 1); cpu.addCycles(emuState, 6); };
      case 0x09: case 0x19: case 0x29: case 0x39:
        return () => { const result = getPair("hl") + getPair(pairForOpcode()); setPair("hl", result); cpu.setRegister(emuState, "f", (cpu.getRegister(emuState, "f") & (flags.sign | flags.zero | flags.parity)) | (result > 0xffff ? flags.carry : 0)); cpu.addCycles(emuState, 11); };

      // DJNZ/JR relative
      case 0x10:
        return () => { const offset = readImmediate(); const b = (cpu.getRegister(emuState, "b") - 1) & 0xff; cpu.setRegister(emuState, "b", b); if (b !== 0) cpu.setRegister(emuState, "pc", cpu.getRegister(emuState, "pc") + (offset << 24 >> 24)); cpu.addCycles(emuState, b !== 0 ? 13 : 8); };
      case 0x18: case 0x20: case 0x28: case 0x30: case 0x38:
        return () => { const offset = readImmediate(); const shouldJump = opcode === 0x18 || conditionMet((opcode >> 3) & 0b11); if (shouldJump) cpu.setRegister(emuState, "pc", cpu.getRegister(emuState, "pc") + (offset << 24 >> 24)); cpu.addCycles(emuState, shouldJump ? 12 : 7); };

      // LD (nn),HL / LD HL,(nn) / LD A,(nn)
      case 0x22:
        return () => { const address = readImmediateWord(); const hl = getPair("hl"); mmu.writeByte(emuState, address, hl & 0xff); mmu.writeByte(emuState, address + 1, hl >> 8); cpu.addCycles(emuState, 16); };
      case 0x2A:
        return () => { const address = readImmediateWord(); setPair("hl", mmu.readByte(emuState, address) | (mmu.readByte(emuState, address + 1) << 8)); cpu.addCycles(emuState, 16); };
      case 0x3A:
        return () => { cpu.setRegister(emuState, "a", mmu.readByte(emuState, readImmediateWord())); cpu.addCycles(emuState, 13); };


      // LD r, n
      case 0x06: case 0x0E: case 0x16: case 0x1E:
      case 0x26: case 0x2E: case 0x3E:
        return () => {
          const value = readImmediate();
          const dest = regMap[high3];
          cpu.setRegister(emuState, dest, value);
          cpu.addCycles(emuState, 7);
        };

      // LD (DE), A
      case 0x12:
        return () => {
          const addr = (cpu.getRegister(emuState, 'd') << 8) | cpu.getRegister(emuState, 'e');
          const value = cpu.getRegister(emuState, 'a');
          mmu.writeByte(emuState, addr, value);
          cpu.addCycles(emuState, 7);
        };

      // LD r, r'
      case 0x40: case 0x41: case 0x42: case 0x43: case 0x44: case 0x45: case 0x47:
      case 0x48: case 0x49: case 0x4A: case 0x4B: case 0x4C: case 0x4D: case 0x4F:
      case 0x50: case 0x51: case 0x52: case 0x53: case 0x54: case 0x55: case 0x57:
      case 0x58: case 0x59: case 0x5A: case 0x5B: case 0x5C: case 0x5D: case 0x5F:
      case 0x60: case 0x61: case 0x62: case 0x63: case 0x64: case 0x65: case 0x67:
      case 0x68: case 0x69: case 0x6A: case 0x6B: case 0x6C: case 0x6D: case 0x6F:
      case 0x78: case 0x79: case 0x7A: case 0x7B: case 0x7C: case 0x7D: case 0x7F:
        return () => {
          const src = regMap[low3];
          const dest = regMap[high3];
          const value = cpu.getRegister(emuState, src);
          cpu.setRegister(emuState, dest, value);
          cpu.addCycles(emuState, 4);
        };

      // LD (nn), A
      case 0x32:
        return () => {
          const low = readImmediate();
          const high = readImmediate();
          const addr = (high << 8) | low;
          const value = cpu.getRegister(emuState, 'a');
          mmu.writeByte(emuState, addr, value);
          cpu.addCycles(emuState, 13);
        };

      // LD r, (HL)
      case 0x46: case 0x4E: case 0x56: case 0x5E:
      case 0x66: case 0x6E: case 0x7E:
        return () => {
          const dest = regMap[high3];
          const addr = (cpu.getRegister(emuState, 'h') << 8) | cpu.getRegister(emuState, 'l');
          const value = mmu.readByte(emuState, addr);
          cpu.setRegister(emuState, dest, value);
          cpu.addCycles(emuState, 7);
        };

      // ADD A, r
      case 0x80: case 0x81: case 0x82: case 0x83:
      case 0x84: case 0x85: case 0x87:
        return () => {
          const src = regMap[low3];
          const rhs = cpu.getRegister(emuState, src);
          const result = cpu.alu.add8(emuState, 'a', rhs, 'f');
          cpu.setRegister(emuState, 'a', result);
          cpu.addCycles(emuState, 4);
        };

      // ADD A, n
      case 0xC6:
        return () => {
          const n = readImmediate();
          const result = cpu.alu.add8(emuState, 'a', n, 'f');
          cpu.setRegister(emuState, 'a', result);
          cpu.addCycles(emuState, 7);
        };

      // ADC A, r
      case 0x88: case 0x89: case 0x8A: case 0x8B:
      case 0x8C: case 0x8D: case 0x8F:
        return () => {
          const src = regMap[low3];
          const rhs = cpu.getRegister(emuState, src);
          const result = cpu.alu.adc8(emuState, 'a', rhs, 'f');
          cpu.setRegister(emuState, 'a', result);
          cpu.addCycles(emuState, 4);
        };

      // ADC A, n
      case 0xCE:
        return () => {
          const n = readImmediate();
          const result = cpu.alu.adc8(emuState, 'a', n, 'f');
          cpu.setRegister(emuState, 'a', result);
          cpu.addCycles(emuState, 7);
        };

      // SUB r
      case 0x90: case 0x91: case 0x92: case 0x93:
      case 0x94: case 0x95: case 0x97:
        return () => {
          const src = regMap[low3];
          const rhs = cpu.getRegister(emuState, src);
          const result = cpu.alu.sub8(emuState, 'a', rhs, 'f');
          cpu.setRegister(emuState, 'a', result);
          cpu.addCycles(emuState, 4);
        };

      // SUB n
      case 0xD6:
        return () => {
          const n = readImmediate();
          const result = cpu.alu.sub8(emuState, 'a', n, 'f');
          cpu.setRegister(emuState, 'a', result);
          cpu.addCycles(emuState, 7);
        };

      // SBC A, r
      case 0x98: case 0x99: case 0x9A: case 0x9B:
      case 0x9C: case 0x9D: case 0x9F:
        return () => {
          const src = regMap[low3];
          const rhs = cpu.getRegister(emuState, src);
          const result = cpu.alu.sbc8(emuState, 'a', rhs, 'f');
          cpu.setRegister(emuState, 'a', result);
          cpu.addCycles(emuState, 4);
        };

      // SBC A, n
      case 0xDE:
        return () => {
          const n = readImmediate();
          const result = cpu.alu.sbc8(emuState, 'a', n, 'f');
          cpu.setRegister(emuState, 'a', result);
          cpu.addCycles(emuState, 7);
        };

      // AND r
      case 0xA0: case 0xA1: case 0xA2: case 0xA3:
      case 0xA4: case 0xA5: case 0xA7:
        return () => {
          const src = regMap[low3];
          const rhs = cpu.getRegister(emuState, src);
          const result = cpu.alu.and8(emuState, 'a', rhs, 'f');
          cpu.setRegister(emuState, 'a', result);
          cpu.addCycles(emuState, 4);
        };

      // AND n
      case 0xE6:
        return () => {
          const n = readImmediate();
          const result = cpu.alu.and8(emuState, 'a', n, 'f');
          cpu.setRegister(emuState, 'a', result);
          cpu.addCycles(emuState, 7);
        };

      // OR n
      case 0xF6:
        return () => {
          const n = readImmediate();
          const result = cpu.alu.or8(emuState, 'a', n, 'f');
          cpu.setRegister(emuState, 'a', result);
          cpu.addCycles(emuState, 7);
        };


      // EX DE, HL
      case 0xEB:
        return () => {
          const de = (cpu.getRegister(emuState, 'd') << 8) | cpu.getRegister(emuState, 'e');
          const hl = (cpu.getRegister(emuState, 'h') << 8) | cpu.getRegister(emuState, 'l');
          cpu.setRegister(emuState, 'd', (hl >> 8) & 0xFF);
          cpu.setRegister(emuState, 'e', hl & 0xFF);
          cpu.setRegister(emuState, 'h', (de >> 8) & 0xFF);
          cpu.setRegister(emuState, 'l', de & 0xFF);
          cpu.addCycles(emuState, 4);
        };

      // EX AF, AF'
      case 0x08:
        return () => {
          const af = (cpu.getRegister(emuState, 'a') << 8) | cpu.getRegister(emuState, 'f');
          const af2 = cpu.getAltAF?.(emuState) ?? 0;
          cpu.setAltAF?.(emuState, af);
          cpu.setRegister(emuState, 'a', (af2 >> 8) & 0xFF);
          cpu.setRegister(emuState, 'f', af2 & 0xFF);
          cpu.addCycles(emuState, 4);
        };

      // EXX
      case 0xD9:
        return () => {
          cpu.exx?.(emuState);
          cpu.addCycles(emuState, 4);
        };

      // EX (SP), HL
      case 0xE3:
        return () => {
          const sp = cpu.getRegister(emuState, 'sp');
          const memL = mmu.readByte(emuState, sp);
          const memH = mmu.readByte(emuState, sp + 1);
          const h = cpu.getRegister(emuState, 'h');
          const l = cpu.getRegister(emuState, 'l');
          mmu.writeByte(emuState, sp, l);
          mmu.writeByte(emuState, sp + 1, h);
          cpu.setRegister(emuState, 'h', memH);
          cpu.setRegister(emuState, 'l', memL);
          cpu.addCycles(emuState, 19);
        };

      // INC ss
      case 0x03: case 0x13: case 0x23: case 0x33:
        return () => {
          const pair = pairForOpcode();
          setPair(pair, getPair(pair) + 1);
          cpu.addCycles(emuState, 6);
        };

      // RST p
      case 0xC7: case 0xCF: case 0xD7: case 0xDF:
      case 0xE7: case 0xEF: case 0xF7: case 0xFF:
        return () => {
          const pc = cpu.getRegister(emuState, 'pc');
          const sp = cpu.getRegister(emuState, 'sp') - 2;
          const target = opcode & 0x38;

          mmu.writeByte(emuState, sp + 1, (pc >> 8) & 0xFF);
          mmu.writeByte(emuState, sp, pc & 0xFF);
          cpu.setRegister(emuState, 'sp', sp);
          cpu.setRegister(emuState, 'pc', target);
          cpu.addCycles(emuState, 11);
        };

      // IN A, (n)
      case 0xDB:
        return () => {
          const port = ((cpu.getRegister(emuState, "a") << 8) | readImmediate()) & 0xffff;
          const value = readPort(port);
          cpu.setRegister(emuState, 'a', value);
          cpu.addCycles(emuState, 11);
        };

      // IN r, (C)
      case 0x40: case 0x48: case 0x50: case 0x58:
      case 0x60: case 0x68: case 0x78:
        return () => {
          const rMap = ['b', 'c', 'd', 'e', 'h', 'l', 'a'];
          const reg = rMap[(opcode - 0x40) >> 3];
          const port = cpu.getRegister(emuState, 'c');
          const top = cpu.getRegister(emuState, 'b') << 8;
          const value = readPort((top | port) & 0xFFFF);
          cpu.setRegister(emuState, reg, value);
      
          const flags = (value === 0 ? 0x40 : 0) | (value & 0x80 ? 0x80 : 0) | (parityEven(value) ? 0x04 : 0);
          cpu.setRegister(emuState, 'f', flags);
          cpu.addCycles(emuState, 12);
        };

      // INI
      case 0xA2:
        return () => {
          const c = cpu.getRegister(emuState, 'c');
          const port = ((cpu.getRegister(emuState, 'b') << 8) | c) & 0xFFFF;
          const hl = (cpu.getRegister(emuState, 'h') << 8) | cpu.getRegister(emuState, 'l');

          const val = readPort(port);
          mmu.writeByte(emuState, hl, val);

          const b = (cpu.getRegister(emuState, 'b') - 1) & 0xFF;
          const hlNew = (hl + 1) & 0xFFFF;

          cpu.setRegister(emuState, 'b', b);
          cpu.setRegister(emuState, 'h', (hlNew >> 8) & 0xFF);
          cpu.setRegister(emuState, 'l', hlNew & 0xFF);

          const z = b === 0;
          cpu.setRegister(emuState, 'f', (z ? 0x40 : 0x00) | 0x02);
          cpu.addCycles(emuState, 16);
        };




      // LD (HL), r and LD (HL), n
      case 0x70: case 0x71: case 0x72: case 0x73:
      case 0x74: case 0x75: case 0x77:
        return () => { mmu.writeByte(emuState, hlAddress(), cpu.getRegister(emuState, regMap[low3])); cpu.addCycles(emuState, 7); };
      case 0x36:
        return () => { mmu.writeByte(emuState, hlAddress(), readImmediate()); cpu.addCycles(emuState, 10); };
      case 0x76:
        return () => {
          cpu.setPins?.({ hlt: true });
          const vector = emuState.manifest?.cpu?.interruptOnHalt
            ? Number(emuState.manifest?.cpu?.haltInterruptVector ?? 0x38)
            : (emuState.manifest?.cpu?.nmiOnHalt ? Number(emuState.manifest?.cpu?.haltNmiVector ?? 0x66) : null);
          if (Number.isFinite(vector)) {
            pushWord(cpu.getRegister(emuState, "pc"));
            cpu.setRegister(emuState, "pc", vector & 0xffff);
            cpu.addCycles(emuState, 11);
          } else {
            cpu.halt?.(emuState);
            cpu.addCycles(emuState, 4);
          }
        };

      // JP/CALL/RET
      case 0xC3:
        return () => { cpu.setRegister(emuState, "pc", readImmediateWord()); cpu.addCycles(emuState, 10); };
      case 0xC2: case 0xCA: case 0xD2: case 0xDA:
      case 0xE2: case 0xEA: case 0xF2: case 0xFA:
        return () => { const address = readImmediateWord(); if (conditionMet((opcode >> 3) & 0b111)) cpu.setRegister(emuState, "pc", address); cpu.addCycles(emuState, 10); };
      case 0xCD:
        return () => { const address = readImmediateWord(); pushWord(cpu.getRegister(emuState, "pc")); cpu.setRegister(emuState, "pc", address); cpu.addCycles(emuState, 17); };
      case 0xC4: case 0xCC: case 0xD4: case 0xDC:
      case 0xE4: case 0xEC: case 0xF4: case 0xFC:
        return () => { const address = readImmediateWord(); const shouldCall = conditionMet((opcode >> 3) & 0b111); if (shouldCall) { pushWord(cpu.getRegister(emuState, "pc")); cpu.setRegister(emuState, "pc", address); } cpu.addCycles(emuState, shouldCall ? 17 : 10); };
      case 0xC9:
        return () => { cpu.setRegister(emuState, "pc", popWord()); cpu.addCycles(emuState, 10); };
      case 0xC0: case 0xC8: case 0xD0: case 0xD8:
      case 0xE0: case 0xE8: case 0xF0: case 0xF8:
        return () => { const shouldReturn = conditionMet((opcode >> 3) & 0b111); if (shouldReturn) cpu.setRegister(emuState, "pc", popWord()); cpu.addCycles(emuState, shouldReturn ? 11 : 5); };
      case 0xE9:
        return () => { cpu.setRegister(emuState, "pc", getPair("hl")); cpu.addCycles(emuState, 4); };

      // PUSH/POP qq
      case 0xC5: case 0xD5: case 0xE5: case 0xF5:
        return () => { pushWord(getPair(pairForOpcode(["bc", "de", "hl", "af"]))); cpu.addCycles(emuState, 11); };
      case 0xC1: case 0xD1: case 0xE1: case 0xF1:
        return () => { setPair(pairForOpcode(["bc", "de", "hl", "af"]), popWord()); cpu.addCycles(emuState, 10); };

      // LD SP,HL and LD (nn),A
      case 0xF9:
        return () => { cpu.setRegister(emuState, "sp", getPair("hl")); cpu.addCycles(emuState, 6); };
      case 0xD3:
        return () => { const port = readImmediate(); writePort((cpu.getRegister(emuState, "a") << 8) | port, cpu.getRegister(emuState, "a")); cpu.addCycles(emuState, 11); };
      case 0xF3:
        return () => { cpu.setInterruptEnabled?.(emuState, false); cpu.addCycles(emuState, 4); };
      case 0xFB:
        return () => { cpu.setInterruptEnabled?.(emuState, true); cpu.addCycles(emuState, 4); };

      // ALU groups not covered above
      case 0x86:
        return () => { const result = cpu.alu.add8(emuState, "a", mmu.readByte(emuState, hlAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 7); };
      case 0x8E:
        return () => { const result = cpu.alu.adc8(emuState, "a", mmu.readByte(emuState, hlAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 7); };
      case 0x96:
        return () => { const result = cpu.alu.sub8(emuState, "a", mmu.readByte(emuState, hlAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 7); };
      case 0x9E:
        return () => { const result = cpu.alu.sbc8(emuState, "a", mmu.readByte(emuState, hlAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 7); };
      case 0xA6:
        return () => { cpu.setRegister(emuState, "a", setLogicFlags(cpu.getRegister(emuState, "a") & mmu.readByte(emuState, hlAddress()), true)); cpu.addCycles(emuState, 7); };
      case 0xA8: case 0xA9: case 0xAA: case 0xAB:
      case 0xAC: case 0xAD: case 0xAE: case 0xAF:
        return () => { cpu.setRegister(emuState, "a", setLogicFlags(cpu.getRegister(emuState, "a") ^ readRegOrHL(regMap[low3]))); cpu.addCycles(emuState, low3 === 6 ? 7 : 4); };
      case 0xB0: case 0xB1: case 0xB2: case 0xB3:
      case 0xB4: case 0xB5: case 0xB6: case 0xB7:
        return () => { cpu.setRegister(emuState, "a", setLogicFlags(cpu.getRegister(emuState, "a") | readRegOrHL(regMap[low3]))); cpu.addCycles(emuState, low3 === 6 ? 7 : 4); };
      case 0xB8: case 0xB9: case 0xBA: case 0xBB:
      case 0xBC: case 0xBD: case 0xBE: case 0xBF:
        return () => { setCompareFlags(cpu.getRegister(emuState, "a"), readRegOrHL(regMap[low3])); cpu.addCycles(emuState, low3 === 6 ? 7 : 4); };
      case 0xFE:
        return () => { setCompareFlags(cpu.getRegister(emuState, "a"), readImmediate()); cpu.addCycles(emuState, 7); };
      case 0xEE:
        return () => { cpu.setRegister(emuState, "a", setLogicFlags(cpu.getRegister(emuState, "a") ^ readImmediate())); cpu.addCycles(emuState, 7); };
      case 0x07:
        return () => { const a = cpu.getRegister(emuState, "a"); const carry = (a >> 7) & 1; cpu.setRegister(emuState, "a", ((a << 1) | carry) & 0xff); cpu.setRegister(emuState, "f", (cpu.getRegister(emuState, "f") & (flags.sign | flags.zero | flags.parity)) | (carry ? flags.carry : 0)); cpu.addCycles(emuState, 4); };
      case 0x0F:
        return () => { const a = cpu.getRegister(emuState, "a"); const carry = a & 1; cpu.setRegister(emuState, "a", ((carry << 7) | (a >> 1)) & 0xff); cpu.setRegister(emuState, "f", (cpu.getRegister(emuState, "f") & (flags.sign | flags.zero | flags.parity)) | (carry ? flags.carry : 0)); cpu.addCycles(emuState, 4); };
      case 0x17:
        return () => { const a = cpu.getRegister(emuState, "a"); const carryIn = (cpu.getRegister(emuState, "f") & flags.carry) ? 1 : 0; const carry = (a >> 7) & 1; cpu.setRegister(emuState, "a", ((a << 1) | carryIn) & 0xff); cpu.setRegister(emuState, "f", (cpu.getRegister(emuState, "f") & (flags.sign | flags.zero | flags.parity)) | (carry ? flags.carry : 0)); cpu.addCycles(emuState, 4); };
      case 0x1F:
        return () => { const a = cpu.getRegister(emuState, "a"); const carryIn = (cpu.getRegister(emuState, "f") & flags.carry) ? 1 : 0; const carry = a & 1; cpu.setRegister(emuState, "a", ((carryIn << 7) | (a >> 1)) & 0xff); cpu.setRegister(emuState, "f", (cpu.getRegister(emuState, "f") & (flags.sign | flags.zero | flags.parity)) | (carry ? flags.carry : 0)); cpu.addCycles(emuState, 4); };
      case 0x27:
        return () => { const a = cpu.getRegister(emuState, "a"); const f = cpu.getRegister(emuState, "f"); let correction = 0; let carry = (f & flags.carry) !== 0; if ((f & flags.halfcarry) || (!(f & flags.subtract) && (a & 0x0f) > 9)) correction |= 0x06; if (carry || (!(f & flags.subtract) && a > 0x99)) { correction |= 0x60; carry = true; } const result = (f & flags.subtract) ? (a - correction) & 0xff : (a + correction) & 0xff; let nextF = f & flags.subtract; if (result & 0x80) nextF |= flags.sign; if (result === 0) nextF |= flags.zero; if (parityEven(result)) nextF |= flags.parity; if (carry) nextF |= flags.carry; cpu.setRegister(emuState, "a", result); cpu.setRegister(emuState, "f", nextF); cpu.addCycles(emuState, 4); };
      case 0x2F:
        return () => { cpu.alu.cpl(emuState, "a"); cpu.setRegister(emuState, "f", cpu.getRegister(emuState, "f") | flags.halfcarry | flags.subtract); cpu.addCycles(emuState, 4); };
      case 0x37:
        return () => { cpu.setRegister(emuState, "f", (cpu.getRegister(emuState, "f") & (flags.sign | flags.zero | flags.parity)) | flags.carry); cpu.addCycles(emuState, 4); };
      case 0x3F:
        return () => { const f = cpu.getRegister(emuState, "f"); const next = (f & (flags.sign | flags.zero | flags.parity)) | ((f & flags.carry) ? flags.halfcarry : flags.carry); cpu.setRegister(emuState, "f", next); cpu.addCycles(emuState, 4); };


      // Unimplemented opcode
      default:
        return () => {
          console.log({ emuState, opcode });
          throw new Error(`Unimplemented opcode: 0x${opcode.toString(16)}`);
        };
    }
  };

  const updateFlagsFromValue = (cpu, emuState, value) => {
    const iff2 = cpu.getIFF2?.(emuState) ?? 0;
    let f = 0;
    if (value & 0x80) f |= 0x80;         // S
    if (value === 0) f |= 0x40;          // Z
    if (iff2) f |= 0x04;                 // P/V
    // H = 0, N = 0, C = not affected
    cpu.setRegister(emuState, 'f', (cpu.getRegister(emuState, 'f') & 0x01) | f);
  };

  const decodeCB = (emuState, opcode) => {
    const cpu = emuState.cpu;
    const mmu = emuState.mmu;
    const flags = cpu.flags;
    const regMap = ["b", "c", "d", "e", "h", "l", null, "a"];
    const bit = (opcode >> 3) & 0b111;
    const reg = regMap[opcode & 0b111];
    const hlAddress = () => (cpu.getRegister(emuState, "h") << 8) | cpu.getRegister(emuState, "l");
    const readTarget = () => reg === null ? mmu.readByte(emuState, hlAddress()) : cpu.getRegister(emuState, reg);
    const writeTarget = (value) => { if (reg === null) mmu.writeByte(emuState, hlAddress(), value & 0xff); else cpu.setRegister(emuState, reg, value & 0xff); };
    const parityEven = (value) => { let bits = value & 0xff; bits ^= bits >> 4; bits ^= bits >> 2; bits ^= bits >> 1; return (bits & 1) === 0; };
    const setRotateFlags = (value, carry) => {
      const next = value & 0xff;
      let f = carry ? flags.carry : 0;
      if (next & 0x80) f |= flags.sign;
      if (next === 0) f |= flags.zero;
      if (parityEven(next)) f |= flags.parity;
      cpu.setRegister(emuState, "f", f);
      return next;
    };
  
    switch (opcode & 0xC0) {
      case 0x00:
        return () => {
          const value = readTarget();
          const carryIn = (cpu.getRegister(emuState, "f") & flags.carry) ? 1 : 0;
          let result = value;
          let carry = 0;
          switch ((opcode >> 3) & 0b111) {
            case 0: carry = (value >> 7) & 1; result = ((value << 1) | carry) & 0xff; break;
            case 1: carry = value & 1; result = ((carry << 7) | (value >> 1)) & 0xff; break;
            case 2: carry = (value >> 7) & 1; result = ((value << 1) | carryIn) & 0xff; break;
            case 3: carry = value & 1; result = ((carryIn << 7) | (value >> 1)) & 0xff; break;
            case 4: carry = (value >> 7) & 1; result = (value << 1) & 0xff; break;
            case 5: carry = value & 1; result = (value & 0x80) | (value >> 1); break;
            case 6: carry = (value >> 7) & 1; result = ((value << 1) | 1) & 0xff; break;
            case 7: carry = value & 1; result = value >> 1; break;
            default: break;
          }
          writeTarget(setRotateFlags(result, carry));
          cpu.addCycles(emuState, reg === null ? 15 : 8);
        };
      case 0x40:
        return () => {
          const value = readTarget();
          const zero = (value & (1 << bit)) === 0;
          let f = (cpu.getRegister(emuState, "f") & flags.carry) | flags.halfcarry;
          if (zero) f |= flags.zero | flags.parity;
          if (bit === 7 && !zero) f |= flags.sign;
          cpu.setRegister(emuState, "f", f);
          cpu.addCycles(emuState, reg === null ? 12 : 8);
        };
      case 0x80:
        return () => {
          writeTarget(readTarget() & ~(1 << bit));
          cpu.addCycles(emuState, reg === null ? 15 : 8);
        };
      case 0xC0:
        return () => {
          writeTarget(readTarget() | (1 << bit));
          cpu.addCycles(emuState, reg === null ? 15 : 8);
        };
      default:
        return () => {
          throw new Error("Unimplemented CB-prefixed opcode: 0xCB" + opcode.toString(16));
        };
    }
  };
  

  const decodeDD = (emuState, opcode) => {
    const cpu = emuState.cpu;
    const mmu = emuState.mmu;
    const flags = cpu.flags;
    const indexReg = "ix";
    const fetchByte = (address) => mmu.fetchByte ? mmu.fetchByte(emuState, address) : mmu.readByte(emuState, address);
    const readImmediate = () => {
      const pc = cpu.getRegister(emuState, "pc");
      const value = fetchByte(pc);
      cpu.setRegister(emuState, "pc", pc + 1);
      return value;
    };
    const regMap = ["b", "c", "d", "e", "h", "l", null, "a"];
    const indexedAddress = () => (cpu.getRegister(emuState, indexReg) + (readImmediate() << 24 >> 24)) & 0xffff;
    const readImmediateWord = () => readImmediate() | (readImmediate() << 8);
    const getPairValue = (pair) => {
      if (pair === "sp" || pair === indexReg) return cpu.getRegister(emuState, pair);
      return (cpu.getRegister(emuState, pair) << 8) | cpu.getRegister(emuState, String.fromCharCode(pair.charCodeAt(0) + 1));
    };
    const setIndexedIncFlags = (before, result) => {
      const carry = cpu.getRegister(emuState, "f") & flags.carry;
      const value = result & 0xff;
      let f = carry;
      if (value & 0x80) f |= flags.sign;
      if (value === 0) f |= flags.zero;
      if (((before ^ value) & 0x10) !== 0) f |= flags.halfcarry;
      if (before === 0x7f) f |= flags.parity;
      cpu.setRegister(emuState, "f", f);
      return value;
    };
    const setIndexedDecFlags = (before, result) => {
      const carry = cpu.getRegister(emuState, "f") & flags.carry;
      const value = result & 0xff;
      let f = carry | flags.subtract;
      if (value & 0x80) f |= flags.sign;
      if (value === 0) f |= flags.zero;
      if (((before ^ value) & 0x10) !== 0) f |= flags.halfcarry;
      if (before === 0x80) f |= flags.parity;
      cpu.setRegister(emuState, "f", f);
      return value;
    };
  
    switch (opcode) {
      case 0x21:
        return () => { cpu.setRegister(emuState, indexReg, readImmediateWord()); cpu.addCycles(emuState, 14); };
      case 0x22:
        return () => { const address = readImmediateWord(); const value = cpu.getRegister(emuState, indexReg); mmu.writeByte(emuState, address, value & 0xff); mmu.writeByte(emuState, address + 1, value >> 8); cpu.addCycles(emuState, 20); };
      case 0x2A:
        return () => { const address = readImmediateWord(); cpu.setRegister(emuState, indexReg, mmu.readByte(emuState, address) | (mmu.readByte(emuState, address + 1) << 8)); cpu.addCycles(emuState, 20); };
      case 0x36:
        return () => { const address = indexedAddress(); const value = readImmediate(); mmu.writeByte(emuState, address, value); cpu.addCycles(emuState, 19); };
      case 0x34:
        return () => { const address = indexedAddress(); const before = mmu.readByte(emuState, address); mmu.writeByte(emuState, address, setIndexedIncFlags(before, before + 1)); cpu.addCycles(emuState, 23); };
      case 0x35:
        return () => { const address = indexedAddress(); const before = mmu.readByte(emuState, address); mmu.writeByte(emuState, address, setIndexedDecFlags(before, before - 1)); cpu.addCycles(emuState, 23); };
      case 0x70: case 0x71: case 0x72: case 0x73:
      case 0x74: case 0x75: case 0x77:
        return () => { const address = indexedAddress(); mmu.writeByte(emuState, address, cpu.getRegister(emuState, regMap[opcode & 0b111])); cpu.addCycles(emuState, 19); };
      case 0x46: case 0x4E: case 0x56: case 0x5E:
      case 0x66: case 0x6E: case 0x7E:
        return () => { const address = indexedAddress(); cpu.setRegister(emuState, regMap[(opcode >> 3) & 0b111], mmu.readByte(emuState, address)); cpu.addCycles(emuState, 19); };
      case 0xE1:
        return () => { const sp = cpu.getRegister(emuState, "sp"); const low = mmu.readByte(emuState, sp); const high = mmu.readByte(emuState, sp + 1); cpu.setRegister(emuState, indexReg, (high << 8) | low); cpu.setRegister(emuState, "sp", sp + 2); cpu.addCycles(emuState, 14); };
      case 0xE5:
        return () => { const value = cpu.getRegister(emuState, indexReg); const sp = (cpu.getRegister(emuState, "sp") - 2) & 0xffff; mmu.writeByte(emuState, sp, value & 0xff); mmu.writeByte(emuState, sp + 1, value >> 8); cpu.setRegister(emuState, "sp", sp); cpu.addCycles(emuState, 15); };
      case 0xE9:
        return () => { cpu.setRegister(emuState, "pc", cpu.getRegister(emuState, indexReg)); cpu.addCycles(emuState, 8); };
      case 0xF9:
        return () => { cpu.setRegister(emuState, "sp", cpu.getRegister(emuState, indexReg)); cpu.addCycles(emuState, 10); };

      // EX (SP), IX
      case 0xE3:
        return () => {
          const sp = cpu.getRegister(emuState, 'sp');
          const memL = mmu.readByte(emuState, sp);
          const memH = mmu.readByte(emuState, sp + 1);
          const ix = cpu.getRegister(emuState, 'ix');
          mmu.writeByte(emuState, sp, ix & 0xFF);
          mmu.writeByte(emuState, sp + 1, (ix >> 8) & 0xFF);
          cpu.setRegister(emuState, 'ix', (memH << 8) | memL);
          cpu.addCycles(emuState, 23);
        };

      // ADD IX, pp
      case 0x09: case 0x19: case 0x29: case 0x39:
        return () => {
          const ix = cpu.getRegister(emuState, 'ix');
          const regMap = ['b', 'd', 'ix', 'sp'];
          const pairIndex = (opcode >> 4) & 0b11;
          const pair = regMap[pairIndex];
          const val = getPairValue(pair);
          const result = ix + val;

          cpu.setRegister(emuState, 'ix', result & 0xFFFF);
          const f = (result > 0xFFFF ? 0x01 : 0);
          cpu.setRegister(emuState, 'f', cpu.getRegister(emuState, 'f') & 0xC4 | f);
          cpu.addCycles(emuState, 15);
        };

      // INC IX
      case 0x23:
        return () => {
          const ix = cpu.getRegister(emuState, 'ix');
          cpu.setRegister(emuState, 'ix', (ix + 1) & 0xFFFF);
          cpu.addCycles(emuState, 6);
        };

      case 0x2B:
        return () => { const ix = cpu.getRegister(emuState, "ix"); cpu.setRegister(emuState, "ix", (ix - 1) & 0xFFFF); cpu.addCycles(emuState, 6); };

      case 0x86:
        return () => { const result = cpu.alu.add8(emuState, "a", mmu.readByte(emuState, indexedAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 19); };
      case 0x8E:
        return () => { const result = cpu.alu.adc8(emuState, "a", mmu.readByte(emuState, indexedAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 19); };
      case 0x96:
        return () => { const result = cpu.alu.sub8(emuState, "a", mmu.readByte(emuState, indexedAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 19); };
      case 0x9E:
        return () => { const result = cpu.alu.sbc8(emuState, "a", mmu.readByte(emuState, indexedAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 19); };
      case 0xA6:
        return () => { const result = cpu.alu.and8(emuState, "a", mmu.readByte(emuState, indexedAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 19); };
      case 0xAE:
        return () => { const result = cpu.alu.xor8(emuState, "a", mmu.readByte(emuState, indexedAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 19); };
      case 0xB6:
        return () => { const result = cpu.alu.or8(emuState, "a", mmu.readByte(emuState, indexedAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 19); };
      case 0xBE:
        return () => { const left = cpu.getRegister(emuState, "a"); const right = mmu.readByte(emuState, indexedAddress()); const result = left - right; const value = result & 0xff; let f = flags.subtract; if (value & 0x80) f |= flags.sign; if (value === 0) f |= flags.zero; if (((left ^ right ^ value) & 0x10) !== 0) f |= flags.halfcarry; if ((((left ^ right) & (left ^ value)) & 0x80) !== 0) f |= flags.parity; if (result < 0) f |= flags.carry; cpu.setRegister(emuState, "f", f); cpu.addCycles(emuState, 19); };

      case 0xCB:
        return () => {
          const pc = cpu.getRegister(emuState, 'pc');
          const d = fetchByte(pc);
          const cbOpcode = fetchByte(pc + 1);
          cpu.setRegister(emuState, 'pc', pc + 2);
          const base = cpu.getRegister(emuState, indexReg);
          const addr = (base + (d << 24 >> 24)) & 0xFFFF;
          const val = mmu.readByte(emuState, addr);
          const bit = (cbOpcode >> 3) & 0b111;
          const mask = 1 << bit;
          if ((cbOpcode & 0xc0) === 0x40) {
            const z = (val & mask) === 0;
            let nextFlags = (cpu.getRegister(emuState, 'f') & flags.carry) | flags.halfcarry;
            if (z) nextFlags |= flags.zero | flags.parity;
            if (bit === 7 && !z) nextFlags |= flags.sign;
            cpu.setRegister(emuState, 'f', nextFlags);
            cpu.addCycles(emuState, 20);
          } else if ((cbOpcode & 0xc0) === 0x80) {
            mmu.writeByte(emuState, addr, val & ~mask);
            cpu.addCycles(emuState, 23);
          } else if ((cbOpcode & 0xc0) === 0xc0) {
            mmu.writeByte(emuState, addr, val | mask);
            cpu.addCycles(emuState, 23);
          } else {
            throw new Error(`Unimplemented indexed CB opcode: 0x${cbOpcode.toString(16)}`);
          }
        };
      
      default:
        return () => {
          throw new Error(`Unimplemented DD-prefixed opcode: 0xDD${opcode.toString(16)}`);
        };

    };
  };

  const decodeFD = (emuState, opcode) => {
    const cpu = emuState.cpu;
    const mmu = emuState.mmu;
    const flags = cpu.flags;
    const indexReg = "iy";
    const fetchByte = (address) => mmu.fetchByte ? mmu.fetchByte(emuState, address) : mmu.readByte(emuState, address);
    const readImmediate = () => {
      const pc = cpu.getRegister(emuState, "pc");
      const value = fetchByte(pc);
      cpu.setRegister(emuState, "pc", pc + 1);
      return value;
    };
    const regMap = ["b", "c", "d", "e", "h", "l", null, "a"];
    const indexedAddress = () => (cpu.getRegister(emuState, indexReg) + (readImmediate() << 24 >> 24)) & 0xffff;
    const readImmediateWord = () => readImmediate() | (readImmediate() << 8);
    const getPairValue = (pair) => {
      if (pair === "sp" || pair === indexReg) return cpu.getRegister(emuState, pair);
      return (cpu.getRegister(emuState, pair) << 8) | cpu.getRegister(emuState, String.fromCharCode(pair.charCodeAt(0) + 1));
    };
    const setIndexedIncFlags = (before, result) => {
      const carry = cpu.getRegister(emuState, "f") & flags.carry;
      const value = result & 0xff;
      let f = carry;
      if (value & 0x80) f |= flags.sign;
      if (value === 0) f |= flags.zero;
      if (((before ^ value) & 0x10) !== 0) f |= flags.halfcarry;
      if (before === 0x7f) f |= flags.parity;
      cpu.setRegister(emuState, "f", f);
      return value;
    };
    const setIndexedDecFlags = (before, result) => {
      const carry = cpu.getRegister(emuState, "f") & flags.carry;
      const value = result & 0xff;
      let f = carry | flags.subtract;
      if (value & 0x80) f |= flags.sign;
      if (value === 0) f |= flags.zero;
      if (((before ^ value) & 0x10) !== 0) f |= flags.halfcarry;
      if (before === 0x80) f |= flags.parity;
      cpu.setRegister(emuState, "f", f);
      return value;
    };
  
    switch (opcode) {
      case 0x21:
        return () => {
          cpu.setRegister(emuState, indexReg, readImmediateWord());
          cpu.addCycles(emuState, 14);
        };
      case 0x22:
        return () => {
          const address = readImmediateWord();
          const value = cpu.getRegister(emuState, indexReg);
          mmu.writeByte(emuState, address, value & 0xff);
          mmu.writeByte(emuState, address + 1, value >> 8);
          cpu.addCycles(emuState, 20);
        };
      case 0x2A:
        return () => {
          const address = readImmediateWord();
          cpu.setRegister(emuState, indexReg, mmu.readByte(emuState, address) | (mmu.readByte(emuState, address + 1) << 8));
          cpu.addCycles(emuState, 20);
        };
      case 0x36:
        return () => {
          const address = indexedAddress();
          const value = readImmediate();
          mmu.writeByte(emuState, address, value);
          cpu.addCycles(emuState, 19);
        };
      case 0x34:
        return () => {
          const address = indexedAddress();
          const before = mmu.readByte(emuState, address);
          mmu.writeByte(emuState, address, setIndexedIncFlags(before, before + 1));
          cpu.addCycles(emuState, 23);
        };
      case 0x35:
        return () => {
          const address = indexedAddress();
          const before = mmu.readByte(emuState, address);
          mmu.writeByte(emuState, address, setIndexedDecFlags(before, before - 1));
          cpu.addCycles(emuState, 23);
        };
      case 0x70: case 0x71: case 0x72: case 0x73:
      case 0x74: case 0x75: case 0x77:
        return () => {
          const address = indexedAddress();
          mmu.writeByte(emuState, address, cpu.getRegister(emuState, regMap[opcode & 0b111]));
          cpu.addCycles(emuState, 19);
        };
      case 0x46: case 0x4E: case 0x56: case 0x5E:
      case 0x66: case 0x6E: case 0x7E:
        return () => {
          const address = indexedAddress();
          cpu.setRegister(emuState, regMap[(opcode >> 3) & 0b111], mmu.readByte(emuState, address));
          cpu.addCycles(emuState, 19);
        };
      // POP IY
      case 0xE1:
        return () => {
          const sp = cpu.getRegister(emuState, 'sp');
          const low = mmu.readByte(emuState, sp);
          const high = mmu.readByte(emuState, sp + 1);
          cpu.setRegister(emuState, 'iy', (high << 8) | low);
          cpu.setRegister(emuState, 'sp', sp + 2);
          cpu.addCycles(emuState, 14);
        };
  
      case 0xE5:
        return () => { const value = cpu.getRegister(emuState, indexReg); const sp = (cpu.getRegister(emuState, "sp") - 2) & 0xffff; mmu.writeByte(emuState, sp, value & 0xff); mmu.writeByte(emuState, sp + 1, value >> 8); cpu.setRegister(emuState, "sp", sp); cpu.addCycles(emuState, 15); };
      case 0xE9:
        return () => { cpu.setRegister(emuState, "pc", cpu.getRegister(emuState, indexReg)); cpu.addCycles(emuState, 8); };
      case 0xF9:
        return () => { cpu.setRegister(emuState, "sp", cpu.getRegister(emuState, indexReg)); cpu.addCycles(emuState, 10); };

      // EX (SP), IY
      case 0xE3:
        return () => {
          const sp = cpu.getRegister(emuState, 'sp');
          const memL = mmu.readByte(emuState, sp);
          const memH = mmu.readByte(emuState, sp + 1);
          const iy = cpu.getRegister(emuState, 'iy');
          mmu.writeByte(emuState, sp, iy & 0xFF);
          mmu.writeByte(emuState, sp + 1, (iy >> 8) & 0xFF);
          cpu.setRegister(emuState, 'iy', (memH << 8) | memL);
          cpu.addCycles(emuState, 23);
        };

      // ADD IY, rr
      case 0x09: case 0x19: case 0x29: case 0x39:
        return () => {
          const iy = cpu.getRegister(emuState, 'iy');
          const regMap = ['b', 'd', 'iy', 'sp'];
          const pairIndex = (opcode >> 4) & 0b11;
          const pair = regMap[pairIndex];
          const val = getPairValue(pair);
          const result = iy + val;

          cpu.setRegister(emuState, 'iy', result & 0xFFFF);
          const f = (result > 0xFFFF ? 0x01 : 0);
          cpu.setRegister(emuState, 'f', cpu.getRegister(emuState, 'f') & 0xC4 | f);
          cpu.addCycles(emuState, 15);
        };

      // INC IY
      case 0x23:
        return () => {
          const iy = cpu.getRegister(emuState, 'iy');
          cpu.setRegister(emuState, 'iy', (iy + 1) & 0xFFFF);
          cpu.addCycles(emuState, 6);
        };

      case 0x2B:
        return () => { const iy = cpu.getRegister(emuState, "iy"); cpu.setRegister(emuState, "iy", (iy - 1) & 0xFFFF); cpu.addCycles(emuState, 6); };

      case 0x86:
        return () => { const result = cpu.alu.add8(emuState, "a", mmu.readByte(emuState, indexedAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 19); };
      case 0x8E:
        return () => { const result = cpu.alu.adc8(emuState, "a", mmu.readByte(emuState, indexedAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 19); };
      case 0x96:
        return () => { const result = cpu.alu.sub8(emuState, "a", mmu.readByte(emuState, indexedAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 19); };
      case 0x9E:
        return () => { const result = cpu.alu.sbc8(emuState, "a", mmu.readByte(emuState, indexedAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 19); };
      case 0xA6:
        return () => { const result = cpu.alu.and8(emuState, "a", mmu.readByte(emuState, indexedAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 19); };
      case 0xAE:
        return () => { const result = cpu.alu.xor8(emuState, "a", mmu.readByte(emuState, indexedAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 19); };
      case 0xB6:
        return () => { const result = cpu.alu.or8(emuState, "a", mmu.readByte(emuState, indexedAddress()), "f"); cpu.setRegister(emuState, "a", result); cpu.addCycles(emuState, 19); };
      case 0xBE:
        return () => { const left = cpu.getRegister(emuState, "a"); const right = mmu.readByte(emuState, indexedAddress()); const result = left - right; const value = result & 0xff; let f = flags.subtract; if (value & 0x80) f |= flags.sign; if (value === 0) f |= flags.zero; if (((left ^ right ^ value) & 0x10) !== 0) f |= flags.halfcarry; if ((((left ^ right) & (left ^ value)) & 0x80) !== 0) f |= flags.parity; if (result < 0) f |= flags.carry; cpu.setRegister(emuState, "f", f); cpu.addCycles(emuState, 19); };

      case 0xCB:
        return () => {
          const pc = cpu.getRegister(emuState, 'pc');
          const d = fetchByte(pc);
          const cbOpcode = fetchByte(pc + 1);
          cpu.setRegister(emuState, 'pc', pc + 2);
          const base = cpu.getRegister(emuState, indexReg);
          const addr = (base + (d << 24 >> 24)) & 0xFFFF;
          const val = mmu.readByte(emuState, addr);
          const bit = (cbOpcode >> 3) & 0b111;
          const mask = 1 << bit;
          if ((cbOpcode & 0xc0) === 0x40) {
            const z = (val & mask) === 0;
            let nextFlags = (cpu.getRegister(emuState, 'f') & flags.carry) | flags.halfcarry;
            if (z) nextFlags |= flags.zero | flags.parity;
            if (bit === 7 && !z) nextFlags |= flags.sign;
            cpu.setRegister(emuState, 'f', nextFlags);
            cpu.addCycles(emuState, 20);
          } else if ((cbOpcode & 0xc0) === 0x80) {
            mmu.writeByte(emuState, addr, val & ~mask);
            cpu.addCycles(emuState, 23);
          } else if ((cbOpcode & 0xc0) === 0xc0) {
            mmu.writeByte(emuState, addr, val | mask);
            cpu.addCycles(emuState, 23);
          } else {
            throw new Error(`Unimplemented indexed CB opcode: 0x${cbOpcode.toString(16)}`);
          }
        };


  
      default:
        return () => {
          throw new Error(`Unimplemented FD-prefixed opcode: 0xFD${opcode.toString(16)}`);
        };
    }
  };
  
  

  const decodeED = (emuState, opcode) => {
    const cpu = emuState.cpu;
    const mmu = emuState.mmu;
    const flags = cpu.flags;
    const fetchByte = (address) => mmu.fetchByte ? mmu.fetchByte(emuState, address) : mmu.readByte(emuState, address);
    const readImmediate = () => { const pc = cpu.getRegister(emuState, "pc"); const value = fetchByte(pc); cpu.setRegister(emuState, "pc", pc + 1); return value; };
    const readImmediateWord = () => readImmediate() | (readImmediate() << 8);
    const pairNames = ["bc", "de", "hl", "sp"];
    const getPair = (pair) => pair === "sp" ? cpu.getRegister(emuState, "sp") : (cpu.getRegister(emuState, pair[0]) << 8) | cpu.getRegister(emuState, pair[1]);
    const setPair = (pair, value) => { const word = value & 0xffff; if (pair === "sp") { cpu.setRegister(emuState, "sp", word); return; } cpu.setRegister(emuState, pair[0], word >> 8); cpu.setRegister(emuState, pair[1], word); };
    const readWord = (address) => mmu.readByte(emuState, address) | (mmu.readByte(emuState, address + 1) << 8);
    const writeWord = (address, value) => { mmu.writeByte(emuState, address, value & 0xff); mmu.writeByte(emuState, address + 1, value >> 8); };
    const readPort = (port) => emuState.io?.inByte ? emuState.io.inByte(emuState, port) : (emuState.io?.read?.(emuState, port) ?? 0xff);
    const parityEven = (value) => { let bits = value & 0xff; bits ^= bits >> 4; bits ^= bits >> 2; bits ^= bits >> 1; return (bits & 1) === 0; };
    const setInputFlags = (value) => {
      const next = value & 0xff;
      let f = cpu.getRegister(emuState, "f") & flags.carry;
      if (next & 0x80) f |= flags.sign;
      if (next === 0) f |= flags.zero;
      if (parityEven(next)) f |= flags.parity;
      cpu.setRegister(emuState, "f", f);
      return next;
    };
    const setHLMathFlags = (left, right, result, subtract) => { const value = result & 0xffff; let f = subtract ? flags.subtract : 0; if (value & 0x8000) f |= flags.sign; if (value === 0) f |= flags.zero; if (((left ^ right ^ value) & 0x1000) !== 0) f |= flags.halfcarry; const overflow = subtract ? (((left ^ right) & (left ^ value) & 0x8000) !== 0) : (((~(left ^ right)) & (left ^ value) & 0x8000) !== 0); if (overflow) f |= flags.parity; if (subtract ? result < 0 : result > 0xffff) f |= flags.carry; cpu.setRegister(emuState, "f", f); setPair("hl", value); };
    const setBlockTransferFlags = (bc) => {
      const preserved = cpu.getRegister(emuState, "f") & (flags.sign | flags.zero | flags.carry);
      cpu.setRegister(emuState, "f", preserved | (bc !== 0 ? flags.parity : 0));
    };
    const blockTransfer = (direction, repeat) => () => {
      const hl = getPair("hl");
      const de = getPair("de");
      const value = mmu.readByte(emuState, hl);
      mmu.writeByte(emuState, de, value);
      const bc = (getPair("bc") - 1) & 0xffff;
      setPair("hl", hl + direction);
      setPair("de", de + direction);
      setPair("bc", bc);
      setBlockTransferFlags(bc);
      if (repeat && bc !== 0) {
        cpu.setRegister(emuState, "pc", cpu.getRegister(emuState, "pc") - 2);
        cpu.addCycles(emuState, 21);
      } else {
        cpu.addCycles(emuState, 16);
      }
    };
  
    switch (opcode) {
      // Block transfer
      case 0xA0:
        return blockTransfer(1, false);
      case 0xA8:
        return blockTransfer(-1, false);
      case 0xB0:
        return blockTransfer(1, true);
      case 0xB8:
        return blockTransfer(-1, true);

      // IN r,(C)
      case 0x40: case 0x48: case 0x50: case 0x58:
      case 0x60: case 0x68: case 0x78:
        return () => {
          const reg = ["b", "c", "d", "e", "h", "l", null, "a"][(opcode >> 3) & 0x07];
          const port = ((cpu.getRegister(emuState, "b") << 8) | cpu.getRegister(emuState, "c")) & 0xffff;
          const value = setInputFlags(readPort(port));
          if (reg) cpu.setRegister(emuState, reg, value);
          cpu.addCycles(emuState, 12);
        };

      // IM 0/1/2
      case 0x46: case 0x4E: case 0x66: case 0x6E:
        return () => {
          cpu.setInterruptMode?.(emuState, 0);
          cpu.addCycles(emuState, 8);
        };
      case 0x56: case 0x76:
        return () => {
          cpu.setInterruptMode?.(emuState, 1);
          cpu.addCycles(emuState, 8);
        };
      case 0x5E: case 0x7E:
        return () => {
          cpu.setInterruptMode?.(emuState, 2);
          cpu.addCycles(emuState, 8);
        };

      // LD (nn),ss / LD ss,(nn)
      case 0x43: case 0x53: case 0x63: case 0x73:
        return () => { const address = readImmediateWord(); writeWord(address, getPair(pairNames[(opcode >> 4) & 0b11])); cpu.addCycles(emuState, 20); };
      case 0x4B: case 0x5B: case 0x6B: case 0x7B:
        return () => { const address = readImmediateWord(); setPair(pairNames[(opcode >> 4) & 0b11], readWord(address)); cpu.addCycles(emuState, 20); };

      // ADC HL,ss
      case 0x4A: case 0x5A: case 0x6A: case 0x7A:
        return () => { const left = getPair("hl"); const right = getPair(pairNames[(opcode >> 4) & 0b11]); const carry = (cpu.getRegister(emuState, "f") & flags.carry) ? 1 : 0; setHLMathFlags(left, right, left + right + carry, false); cpu.addCycles(emuState, 15); };

      // NEG
      case 0x44: case 0x4C: case 0x54: case 0x5C: case 0x64: case 0x6C: case 0x74: case 0x7C:
        return () => { const a = cpu.getRegister(emuState, "a"); const result = (0 - a) & 0xff; let f = flags.subtract; if (result & 0x80) f |= flags.sign; if (result === 0) f |= flags.zero; if (((0 ^ a ^ result) & 0x10) !== 0) f |= flags.halfcarry; if (a === 0x80) f |= flags.parity; if (a !== 0) f |= flags.carry; cpu.setRegister(emuState, "a", result); cpu.setRegister(emuState, "f", f); cpu.addCycles(emuState, 8); };

      // RETN / RETI
      case 0x45: case 0x4D: case 0x55: case 0x5D: case 0x65: case 0x6D: case 0x75: case 0x7D:
        return () => { const sp = cpu.getRegister(emuState, "sp"); const address = mmu.readByte(emuState, sp) | (mmu.readByte(emuState, sp + 1) << 8); cpu.setRegister(emuState, "sp", sp + 2); cpu.setRegister(emuState, "pc", address); cpu.addCycles(emuState, 14); };

      // LD A, I
      case 0x57:
        return () => {
          const i = cpu.getRegister(emuState, 'i');
          cpu.setRegister(emuState, 'a', i);
          updateFlagsFromValue(cpu, emuState, i);
          cpu.addCycles(emuState, 9);
        };
  
      // LD A, R
      case 0x5F:
        return () => {
          const r = cpu.getRegister(emuState, 'r');
          cpu.setRegister(emuState, 'a', r);
          updateFlagsFromValue(cpu, emuState, r);
          cpu.addCycles(emuState, 9);
        };
  
      // LD I, A
      case 0x47:
        return () => {
          const a = cpu.getRegister(emuState, 'a');
          cpu.setRegister(emuState, 'i', a);
          cpu.addCycles(emuState, 9);
        };
  
      // LD R, A
      case 0x4F:
        return () => {
          const a = cpu.getRegister(emuState, 'a');
          cpu.setRegister(emuState, 'r', a);
          cpu.addCycles(emuState, 9);
        };
  
      // POP IY
      case 0xE1:
        return () => {
          const sp = cpu.getRegister(emuState, 'sp');
          const low = mmu.readByte(emuState, sp);
          const high = mmu.readByte(emuState, sp + 1);
          cpu.setRegister(emuState, 'iy', (high << 8) | low);
          cpu.setRegister(emuState, 'sp', sp + 2);
          cpu.addCycles(emuState, 14);
        };

      // SBC HL, ss
      case 0x42: case 0x52: case 0x62: case 0x72:
        return () => {
          const hl = (cpu.getRegister(emuState, 'h') << 8) | cpu.getRegister(emuState, 'l');
          const sp = cpu.getRegister(emuState, 'sp');
          const regPairs = ['b', 'd', 'h', 'sp'];
          const pair = regPairs[(opcode >> 4) & 0b11];
          const high = pair === 'sp' ? (sp >> 8) & 0xFF : cpu.getRegister(emuState, pair);
          const low  = pair === 'sp' ? sp & 0xFF       : cpu.getRegister(emuState, String.fromCharCode(pair.charCodeAt(0) + 1));
          const ss = (high << 8) | low;

          const carry = cpu.getRegister(emuState, 'f') & 0x01 ? 1 : 0;
          const result = hl - ss - carry;

          const res16 = result & 0xFFFF;
          cpu.setRegister(emuState, 'h', (res16 >> 8) & 0xFF);
          cpu.setRegister(emuState, 'l', res16 & 0xFF);

          // TODO: implement 16-bit flag handling eventually. For now:
          // Sign, Zero, Halfcarry, Overflow, Subtract, Carry
          const f = (res16 === 0 ? 0x40 : 0) | 0x02 | (result < 0 ? 0x01 : 0);
          cpu.setRegister(emuState, 'f', f);

          cpu.addCycles(emuState, 15);
        };

        // OUTI
        case 0xA3: 
          return () => {
            const hl = (cpu.getRegister(emuState, 'h') << 8) | cpu.getRegister(emuState, 'l');
            const val = mmu.readByte(emuState, hl);
            const c = cpu.getRegister(emuState, 'c');
            const port = ((cpu.getRegister(emuState, 'b') << 8) | c) & 0xFFFF;
        
            emuState.io?.write(port, val, cpu.getRegister(emuState, 'a'));
        
            const b = (cpu.getRegister(emuState, 'b') - 1) & 0xFF;
            const hlNew = (hl + 1) & 0xFFFF;
        
            cpu.setRegister(emuState, 'b', b);
            cpu.setRegister(emuState, 'h', (hlNew >> 8) & 0xFF);
            cpu.setRegister(emuState, 'l', hlNew & 0xFF);
            cpu.setRegister(emuState, 'f', (b === 0 ? 0x40 : 0x00) | 0x02);
        
            cpu.addCycles(emuState, 16);
          };

        // OTIR
        case 0xB3: 
          return () => {
            const hl = (cpu.getRegister(emuState, 'h') << 8) | cpu.getRegister(emuState, 'l');
            const val = mmu.readByte(emuState, hl);
            const c = cpu.getRegister(emuState, 'c');
            const port = ((cpu.getRegister(emuState, 'b') << 8) | c) & 0xFFFF;

            emuState.io?.write(port, val, cpu.getRegister(emuState, 'a'));

            const b = (cpu.getRegister(emuState, 'b') - 1) & 0xFF;
            const hlNew = (hl + 1) & 0xFFFF;

            cpu.setRegister(emuState, 'b', b);
            cpu.setRegister(emuState, 'h', (hlNew >> 8) & 0xFF);
            cpu.setRegister(emuState, 'l', hlNew & 0xFF);
            cpu.setRegister(emuState, 'f', 0x42);

            if (b !== 0) {
              const pc = cpu.getRegister(emuState, 'pc');
              cpu.setRegister(emuState, 'pc', (pc - 2) & 0xFFFF);
              cpu.addCycles(emuState, 21);
            } else {
              cpu.addCycles(emuState, 16);
            }
          };

          // OUTD
          case 0xAB:
            return () => {
              const hl = (cpu.getRegister(emuState, 'h') << 8) | cpu.getRegister(emuState, 'l');
              const val = mmu.readByte(emuState, hl);
              const c = cpu.getRegister(emuState, 'c');
              const port = ((cpu.getRegister(emuState, 'b') << 8) | c) & 0xFFFF;
          
              emuState.io?.write(port, val, cpu.getRegister(emuState, 'a'));
          
              const b = (cpu.getRegister(emuState, 'b') - 1) & 0xFF;
              const hlNew = (hl - 1) & 0xFFFF;
          
              cpu.setRegister(emuState, 'b', b);
              cpu.setRegister(emuState, 'h', (hlNew >> 8) & 0xFF);
              cpu.setRegister(emuState, 'l', hlNew & 0xFF);
              cpu.setRegister(emuState, 'f', (b === 0 ? 0x40 : 0x00) | 0x02);
          
              cpu.addCycles(emuState, 16);
            };

          // OTDR
          case 0xBB:
            return () => {
              const hl = (cpu.getRegister(emuState, 'h') << 8) | cpu.getRegister(emuState, 'l');
              const val = mmu.readByte(emuState, hl);
              const c = cpu.getRegister(emuState, 'c');
              const port = ((cpu.getRegister(emuState, 'b') << 8) | c) & 0xFFFF;
          
              emuState.io?.write(port, val, cpu.getRegister(emuState, 'a'));
          
              const b = (cpu.getRegister(emuState, 'b') - 1) & 0xFF;
              const hlNew = (hl - 1) & 0xFFFF;
          
              cpu.setRegister(emuState, 'b', b);
              cpu.setRegister(emuState, 'h', (hlNew >> 8) & 0xFF);
              cpu.setRegister(emuState, 'l', hlNew & 0xFF);
              cpu.setRegister(emuState, 'f', 0x42);
          
              if (b !== 0) {
                const pc = cpu.getRegister(emuState, 'pc');
                cpu.setRegister(emuState, 'pc', (pc - 2) & 0xFFFF);
                cpu.addCycles(emuState, 21);
              } else {
                cpu.addCycles(emuState, 16);
              }
            };
          
      default:
        return () => {
          throw new Error(`Unimplemented ED-prefixed opcode: 0xED${opcode.toString(16)}`);
        };
    }
  };

  return {
    decode
  };
};

export default createZ80Decoder;
