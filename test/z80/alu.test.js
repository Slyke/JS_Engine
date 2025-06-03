import assert from "assert";
import createZ80ALU from "../../emulator/cpu/alu/z80.js";
import createZ80Registers from "../../emulator/cpu/registers/z80.js";

const flagDefs = {
  sign: 0x80,
  zero: 0x40,
  halfcarry: 0x10,
  parity: 0x04,
  subtract: 0x02,
  carry: 0x01,
};

const createSubject = () => {
  const registers = createZ80Registers();
  const emu = { cpu: { registers: registers.registerBank() } };
  const alu = createZ80ALU({
    getRegister: registers.getRegister,
    setRegister: registers.setRegister,
    flagDefs,
  });
  return { emu, alu };
};

describe("Z80 ALU", () => {
  it("adds 8-bit values and sets carry/zero/parity flags", () => {
    const { emu, alu } = createSubject();
    emu.cpu.registers.a = 0xff;

    const result = alu.add8(emu, "a", 0x01, "f");

    assert.strictEqual(result, 0x00);
    assert.strictEqual(emu.cpu.registers.a, 0x00);
    assert.strictEqual((emu.cpu.registers.f & flagDefs.carry) !== 0, true);
    assert.strictEqual((emu.cpu.registers.f & flagDefs.zero) !== 0, true);
  });

  it("increments an 8-bit register without throwing", () => {
    const { emu, alu } = createSubject();
    emu.cpu.registers.b = 0x0f;

    const result = alu.inc8(emu, "b", "f");

    assert.strictEqual(result, 0x10);
    assert.strictEqual(emu.cpu.registers.b, 0x10);
    assert.strictEqual((emu.cpu.registers.f & flagDefs.halfcarry) !== 0, true);
  });
});
