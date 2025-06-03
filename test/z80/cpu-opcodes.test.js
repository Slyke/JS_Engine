import assert from "assert";
import createZ80CPU from "../../emulator/cpu/z80.js";
import { allOpcodes, assertOpcodeStep, createTestEmulator, createTestMemory, emulatorRoot, hex8 } from "../helpers/emulator-harness.js";

const z80Config = {
  cpu: {
    alu: "./cpu/alu/z80.js",
    registers: "./cpu/registers/z80.js",
    control: "./cpu/control/z80.js",
    decoder: "./cpu/decoder/z80.js",
    initialPc: 0x0200,
    initialSp: 0x9000,
  },
};

describe("Z80 CPU opcode execution", () => {
  for (const opcode of allOpcodes()) {
    it(`steps primary opcode ${hex8(opcode)} without an uncaught exception`, async () => {
      const pc = z80Config.cpu.initialPc;
      const memory = createTestMemory();
      memory.load(pc, [opcode, 0x34, 0x12, 0x00, 0x00]);
      const cpu = await createZ80CPU(z80Config, emulatorRoot);
      const emu = createTestEmulator(cpu, memory, z80Config);
      cpu.attach(emu);

      assertOpcodeStep(cpu, emu, opcode);
      assert.ok(cpu.getDebugState().history.length >= 1, `${hex8(opcode)} should be disassemblable for history`);
    });
  }
});
