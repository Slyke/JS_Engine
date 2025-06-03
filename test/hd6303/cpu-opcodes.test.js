import assert from "assert";
import createHD6303CPU from "../../emulator/cpu/hd6303.js";
import { allOpcodes, assertOpcodeStep, createTestEmulator, createTestMemory, hex8 } from "../helpers/emulator-harness.js";

describe("Hitachi HD6303 CPU opcode execution", () => {
  for (const opcode of allOpcodes()) {
    it(`steps primary opcode ${hex8(opcode)} without an uncaught exception`, async () => {
      const pc = 0x0200;
      const memory = createTestMemory();
      memory.load(pc, [opcode, 0x34, 0x12, 0x00, 0x00]);
      const cpu = await createHD6303CPU({ cpu: { initialPc: pc, initialSp: 0x9000, initialX: 0x0100 } });
      const emu = createTestEmulator(cpu, memory);
      cpu.attach(emu);

      assertOpcodeStep(cpu, emu, opcode);
      assert.ok(cpu.getDebugState().history.length >= 1, `${hex8(opcode)} should be disassemblable for history`);
    });
  }
});
