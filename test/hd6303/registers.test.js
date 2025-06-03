import assert from "assert";
import { REGISTER_DEFS, createHD6303InitialRegisters } from "../../emulator/cpu/registers/hd6303.js";

describe("Hitachi HD6303 register definitions", () => {
  it("creates initial registers from manifest settings", () => {
    const registers = createHD6303InitialRegisters({
      cpu: { initialPc: 0x1234, initialSp: 0x8000, initialX: 0x2222, initialA: 0x12, initialB: 0x34, initialCc: 0x0f },
    });

    assert.deepStrictEqual(registers, { pc: 0x1234, sp: 0x8000, x: 0x2222, a: 0x12, b: 0x34, cc: 0x0f });
    assert.ok(REGISTER_DEFS.some((def) => def.name === "x" && def.bits === 16));
  });
});
