import assert from "assert";
import createI8080Decoder from "../../emulator/cpu/decoder/i8080.js";
import { allOpcodes, createTestMemory, hex8 } from "../helpers/emulator-harness.js";

const createSubject = (bytes = []) => {
  const memory = createTestMemory();
  memory.load(0x0200, bytes);
  const state = { registers: { pc: 0x0200 } };
  return createI8080Decoder({
    getState: () => state,
    readByte: (address) => memory.readByte(null, address),
  });
};

describe("Intel 8080 decoder", () => {
  it("disassembles immediate register loads", () => {
    const decoder = createSubject([0x3e, 0x99]);

    assert.deepStrictEqual(decoder.disassemble(0x0200), {
      address: 0x0200,
      bytes: [0x3e, 0x99],
      mnemonic: "MVI A,0x99",
      size: 2,
    });
  });

  for (const opcode of allOpcodes()) {
    it(`disassembles primary opcode ${hex8(opcode)}`, () => {
      const decoder = createSubject([opcode, 0x34, 0x12]);
      const instruction = decoder.disassemble(0x0200);

      assert.strictEqual(instruction.address, 0x0200);
      assert.ok(instruction.size >= 1 && instruction.size <= 3);
      assert.strictEqual(typeof instruction.mnemonic, "string");
    });
  }
});
