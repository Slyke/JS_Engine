import assert from "assert";
import createHD6303Decoder from "../../emulator/cpu/decoder/hd6303.js";
import { allOpcodes, createTestMemory, hex8 } from "../helpers/emulator-harness.js";

const createSubject = (bytes = []) => {
  const memory = createTestMemory();
  memory.load(0x0200, bytes);
  return createHD6303Decoder({
    getPc: () => 0x0200,
    safeReadByte: (address) => memory.readByte(null, address),
  });
};

describe("Hitachi HD6303 decoder", () => {
  it("disassembles extended jumps", () => {
    const decoder = createSubject([0x7e, 0x12, 0x34]);

    assert.deepStrictEqual(decoder.disassemble(0x0200), {
      address: 0x0200,
      bytes: [0x7e, 0x12, 0x34],
      mnemonic: "JMP 0x1234",
      size: 3,
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
