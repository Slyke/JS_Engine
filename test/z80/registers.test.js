import assert from "assert";
import createZ80Registers from "../../emulator/cpu/registers/z80.js";

describe("Z80 register interface", () => {
  it("reads and writes 8-bit and 16-bit registers", () => {
    const registers = createZ80Registers();
    const emu = { cpu: { registers: registers.registerBank() } };

    registers.setRegister(emu, "a", 0x123);
    registers.setRegister(emu, "pc", 0x12345);

    assert.strictEqual(registers.getRegister(emu, "a"), 0x23);
    assert.strictEqual(registers.getRegister(emu, "pc"), 0x2345);
  });

  it("combines paired registers using the configured endian mode", () => {
    const registers = createZ80Registers();
    const emu = { cpu: { registers: registers.registerBank() } };

    registers.setRegister(emu, "bc", 0x1234, 0x01);

    assert.strictEqual(registers.getRegister(emu, "b"), 0x12);
    assert.strictEqual(registers.getRegister(emu, "c"), 0x34);
    assert.strictEqual(registers.getRegister(emu, "bc"), 0x1234);
  });
});
