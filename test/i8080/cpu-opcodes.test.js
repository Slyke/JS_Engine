import assert from "assert";
import createI8080CPU from "../../emulator/cpu/i8080.js";
import { allOpcodes, assertOpcodeStep, createTestEmulator, createTestMemory, hex8 } from "../helpers/emulator-harness.js";

describe("Intel 8080 CPU opcode execution", () => {
  for (const opcode of allOpcodes()) {
    it(`steps primary opcode ${hex8(opcode)} without an uncaught exception`, async () => {
      const pc = 0x0200;
      const memory = createTestMemory();
      memory.load(pc, [opcode, 0x34, 0x12, 0x00, 0x00]);
      const cpu = await createI8080CPU({ cpu: { initialPc: pc, initialSp: 0x9000 } });
      const emu = createTestEmulator(cpu, memory);
      cpu.attach(emu);

      assertOpcodeStep(cpu, emu, opcode);
      assert.ok(cpu.getDebugState().history.length >= 1, `${hex8(opcode)} should be disassemblable for history`);
    });
  }
});
