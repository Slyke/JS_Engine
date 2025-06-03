const u16 = (value) => value & 0xffff;
const hex = (value, width) => "0x" + (value >>> 0).toString(16).toUpperCase().padStart(width, "0");
const signed8 = (value) => (value & 0x80) ? value - 0x100 : value;

const createHD6303Decoder = ({ getPc, safeReadByte }) => {
  const disassemble = (address = getPc()) => {
    const pc = u16(address);
    const op = safeReadByte(pc);
    const p1 = safeReadByte(pc + 1);
    const p2 = safeReadByte(pc + 2);
    const word = (p1 << 8) | p2;
    let size = 1;
    let mnemonic = "DB " + hex(op, 2);

    const branchMnemonics = {
      0x20: "BRA", 0x21: "BRN", 0x22: "BHI", 0x23: "BLS",
      0x24: "BCC", 0x25: "BCS", 0x26: "BNE", 0x27: "BEQ",
      0x28: "BVC", 0x29: "BVS", 0x2a: "BPL", 0x2b: "BMI",
      0x2c: "BGE", 0x2d: "BLT", 0x2e: "BGT", 0x2f: "BLE",
    };

    if (op === 0x01) mnemonic = "NOP";
    else if (branchMnemonics[op]) {
      size = 2;
      mnemonic = branchMnemonics[op] + " " + hex(u16(pc + 2 + signed8(p1)), 4);
    } else if (op === 0x7d) {
      size = 3;
      mnemonic = "TST " + hex(word, 4);
    } else if (op === 0x7e) {
      size = 3;
      mnemonic = "JMP " + hex(word, 4);
    } else if (op === 0xbd) {
      size = 3;
      mnemonic = "JSR " + hex(word, 4);
    } else if (op === 0x39) {
      mnemonic = "RTS";
    }

    return { address: pc, bytes: [op, p1, p2].slice(0, size), mnemonic, size };
  };

  return { disassemble };
};

export default createHD6303Decoder;
