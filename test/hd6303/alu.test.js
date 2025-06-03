import assert from "assert";
import createHD6303ALU, { FLAG_C, FLAG_N, FLAG_V, FLAG_Z } from "../../emulator/cpu/alu/hd6303.js";

const createSubject = () => {
  const memory = new Uint8Array(0x10000);
  const cpu = { registers: { a: 0, b: 0, cc: 0, x: 0, sp: 0, pc: 0 } };
  const alu = createHD6303ALU({
    getCpu: () => cpu,
    readByte: (address) => memory[address & 0xffff],
    writeByte: (address, value) => { memory[address & 0xffff] = value & 0xff; },
  });
  return { cpu, memory, alu };
};

describe("Hitachi HD6303 ALU", () => {
  it("adds 8-bit values and sets negative/overflow flags", () => {
    const { cpu, alu } = createSubject();

    const result = alu.add8(0x7f, 0x01);

    assert.strictEqual(result, 0x80);
    assert.strictEqual((cpu.registers.cc & FLAG_N) !== 0, true);
    assert.strictEqual((cpu.registers.cc & FLAG_V) !== 0, true);
    assert.strictEqual((cpu.registers.cc & FLAG_Z) !== 0, false);
  });

  it("subtracts with borrow and sets carry on underflow", () => {
    const { cpu, alu } = createSubject();

    const result = alu.subtract8(0x00, 0x01);

    assert.strictEqual(result, 0xff);
    assert.strictEqual((cpu.registers.cc & FLAG_C) !== 0, true);
  });
});
