import { CONDITION_NAMES, REG_NAMES, RP_NAMES } from "../registers/i8080.js";

const u16 = (value) => value & 0xffff;
const hex = (value, width) => "0x" + u16(value).toString(16).toUpperCase().padStart(width, "0");

const createI8080Decoder = ({ getState, readByte }) => {
  const disassemble = (address = getState().registers.pc) => {
    const pc = u16(address);
    const op = readByte(pc);
    const p1 = readByte(pc + 1);
    const p2 = readByte(pc + 2);
    const word = p1 | (p2 << 8);
    let size = 1;
    let mnemonic = "NOP";

    if ((op & 0xc0) === 0x40) {
      if (op === 0x76) mnemonic = "HLT";
      else mnemonic = "MOV " + REG_NAMES[(op >> 3) & 7].toUpperCase() + "," + REG_NAMES[op & 7].toUpperCase();
    } else if ((op & 0xc7) === 0x06) {
      size = 2;
      mnemonic = "MVI " + REG_NAMES[(op >> 3) & 7].toUpperCase() + "," + hex(p1, 2);
    } else if ((op & 0xc7) === 0x04) {
      mnemonic = "INR " + REG_NAMES[(op >> 3) & 7].toUpperCase();
    } else if ((op & 0xc7) === 0x05) {
      mnemonic = "DCR " + REG_NAMES[(op >> 3) & 7].toUpperCase();
    } else if ((op & 0xc0) === 0x80) {
      const names = ["ADD", "ADC", "SUB", "SBB", "ANA", "XRA", "ORA", "CMP"];
      mnemonic = names[(op >> 3) & 7] + " " + REG_NAMES[op & 7].toUpperCase();
    } else {
      const rp = RP_NAMES[(op >> 4) & 3].toUpperCase();
      switch (op) {
        case 0x00: mnemonic = "NOP"; break;
        case 0x01: case 0x11: case 0x21: case 0x31: size = 3; mnemonic = "LXI " + rp + "," + hex(word, 4); break;
        case 0x02: mnemonic = "STAX B"; break;
        case 0x12: mnemonic = "STAX D"; break;
        case 0x0a: mnemonic = "LDAX B"; break;
        case 0x1a: mnemonic = "LDAX D"; break;
        case 0x03: case 0x13: case 0x23: case 0x33: mnemonic = "INX " + rp; break;
        case 0x0b: case 0x1b: case 0x2b: case 0x3b: mnemonic = "DCX " + rp; break;
        case 0x09: case 0x19: case 0x29: case 0x39: mnemonic = "DAD " + rp; break;
        case 0x07: mnemonic = "RLC"; break;
        case 0x0f: mnemonic = "RRC"; break;
        case 0x17: mnemonic = "RAL"; break;
        case 0x1f: mnemonic = "RAR"; break;
        case 0x22: size = 3; mnemonic = "SHLD " + hex(word, 4); break;
        case 0x2a: size = 3; mnemonic = "LHLD " + hex(word, 4); break;
        case 0x32: size = 3; mnemonic = "STA " + hex(word, 4); break;
        case 0x3a: size = 3; mnemonic = "LDA " + hex(word, 4); break;
        case 0x27: mnemonic = "DAA"; break;
        case 0x2f: mnemonic = "CMA"; break;
        case 0x37: mnemonic = "STC"; break;
        case 0x3f: mnemonic = "CMC"; break;
        case 0xc3: size = 3; mnemonic = "JMP " + hex(word, 4); break;
        case 0xcd: size = 3; mnemonic = "CALL " + hex(word, 4); break;
        case 0xc9: mnemonic = "RET"; break;
        case 0xd3: size = 2; mnemonic = "OUT " + hex(p1, 2); break;
        case 0xdb: size = 2; mnemonic = "IN " + hex(p1, 2); break;
        case 0xe3: mnemonic = "XTHL"; break;
        case 0xe9: mnemonic = "PCHL"; break;
        case 0xeb: mnemonic = "XCHG"; break;
        case 0xf3: mnemonic = "DI"; break;
        case 0xf9: mnemonic = "SPHL"; break;
        case 0xfb: mnemonic = "EI"; break;
        case 0xc6: size = 2; mnemonic = "ADI " + hex(p1, 2); break;
        case 0xce: size = 2; mnemonic = "ACI " + hex(p1, 2); break;
        case 0xd6: size = 2; mnemonic = "SUI " + hex(p1, 2); break;
        case 0xde: size = 2; mnemonic = "SBI " + hex(p1, 2); break;
        case 0xe6: size = 2; mnemonic = "ANI " + hex(p1, 2); break;
        case 0xee: size = 2; mnemonic = "XRI " + hex(p1, 2); break;
        case 0xf6: size = 2; mnemonic = "ORI " + hex(p1, 2); break;
        case 0xfe: size = 2; mnemonic = "CPI " + hex(p1, 2); break;
        default:
          if ((op & 0xc7) === 0xc0) mnemonic = "R" + CONDITION_NAMES[(op >> 3) & 7];
          else if ((op & 0xc7) === 0xc2) { size = 3; mnemonic = "J" + CONDITION_NAMES[(op >> 3) & 7] + " " + hex(word, 4); }
          else if ((op & 0xc7) === 0xc4) { size = 3; mnemonic = "C" + CONDITION_NAMES[(op >> 3) & 7] + " " + hex(word, 4); }
          else if ((op & 0xc7) === 0xc7) mnemonic = "RST " + ((op >> 3) & 7);
          else if ((op & 0xcf) === 0xc1) mnemonic = "POP " + (op === 0xf1 ? "PSW" : rp);
          else if ((op & 0xcf) === 0xc5) mnemonic = "PUSH " + (op === 0xf5 ? "PSW" : rp);
          else mnemonic = "DB " + hex(op, 2);
          break;
      }
    }

    return { address: pc, bytes: [op, p1, p2].slice(0, size), mnemonic, size };
  };

  return { disassemble };
};

export default createI8080Decoder;
