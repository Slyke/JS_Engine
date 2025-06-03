import assert from "assert";
import createZ80Decoder from "../../emulator/cpu/decoder/z80.js";
import createZ80ALU from "../../emulator/cpu/alu/z80.js";
import createZ80Registers from "../../emulator/cpu/registers/z80.js";
import { allOpcodes, createTestEmulator, createTestMemory, hex8 } from "../helpers/emulator-harness.js";

const flagDefs = {
  sign: 0x80,
  zero: 0x40,
  halfcarry: 0x10,
  parity: 0x04,
  subtract: 0x02,
  carry: 0x01,
};

const createEmu = () => {
  const registerInterface = createZ80Registers();
  const memory = createTestMemory();
  const cpu = {
    registers: registerInterface.registerBank(),
    flags: flagDefs,
    getRegister: registerInterface.getRegister,
    setRegister: registerInterface.setRegister,
    alu: null,
    addCycles(_emuState, count) {
      this.cycles = (this.cycles ?? 0) + count;
    },
    cycles: 0,
    setPins() {},
  };
  cpu.alu = createZ80ALU({
    getRegister: registerInterface.getRegister,
    setRegister: registerInterface.setRegister,
    flagDefs,
  });
  const emu = createTestEmulator(cpu, memory);
  return { emu, memory };
};

describe("Z80 decoder", () => {
  for (const opcode of allOpcodes()) {
    it(`returns an instruction closure for primary opcode ${hex8(opcode)}`, () => {
      const decoder = createZ80Decoder();
      const { emu, memory } = createEmu();
      memory.load(0x0200, [opcode, 0x34, 0x12, 0x00]);
      emu.cpu.setRegister(emu, "pc", 0x0201);

      const instruction = decoder.decode(emu, opcode);

      assert.strictEqual(typeof instruction, "function");
    });
  }
});
