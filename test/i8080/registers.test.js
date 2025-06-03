import assert from "assert";
import { FLAG, REGISTER_DEFS, createI8080State, flagsForRegisters } from "../../emulator/cpu/registers/i8080.js";

describe("Intel 8080 register definitions", () => {
  it("creates initial CPU state from manifest settings", () => {
    const state = createI8080State({ cpu: { initialPc: 0x1234, initialSp: 0xabcd } });

    assert.strictEqual(state.registers.pc, 0x1234);
    assert.strictEqual(state.registers.sp, 0xabcd);
    assert.strictEqual(state.registers.f, 0x02);
    assert.ok(REGISTER_DEFS.some((def) => def.name === "a" && def.bits === 8));
  });

  it("reports flag states from a register snapshot", () => {
    const flags = flagsForRegisters({ f: FLAG.zero | FLAG.carry });

    assert.strictEqual(flags.find((flag) => flag.name === "zero").set, true);
    assert.strictEqual(flags.find((flag) => flag.name === "carry").set, true);
    assert.strictEqual(flags.find((flag) => flag.name === "sign").set, false);
  });
});
