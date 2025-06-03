import assert from "assert";
import createI8080ALU, { parityEven } from "../../emulator/cpu/alu/i8080.js";
import { FLAG, createI8080State } from "../../emulator/cpu/registers/i8080.js";

const createSubject = () => {
  const state = createI8080State({ cpu: { initialPc: 0, initialSp: 0x9000 } });
  const setFlag = (mask, set) => {
    if (set) state.registers.f |= mask;
    else state.registers.f &= (~mask) & 0xff;
    state.registers.f |= 0x02;
  };
  const getFlag = (mask) => (state.registers.f & mask) === mask;
  const getHL = () => (state.registers.h << 8) | state.registers.l;
  const setHL = (value) => {
    state.registers.h = (value >> 8) & 0xff;
    state.registers.l = value & 0xff;
  };
  const alu = createI8080ALU({ getState: () => state, getHL, setHL, setFlag, getFlag, flagDefs: FLAG });
  return { state, alu };
};

describe("Intel 8080 ALU", () => {
  it("tracks even parity", () => {
    assert.strictEqual(parityEven(0b00000011), true);
    assert.strictEqual(parityEven(0b00000001), false);
  });

  it("adds and sets zero/carry flags", () => {
    const { state, alu } = createSubject();
    state.registers.a = 0xff;

    alu.add(0x01);

    assert.strictEqual(state.registers.a, 0x00);
    assert.strictEqual((state.registers.f & FLAG.zero) !== 0, true);
    assert.strictEqual((state.registers.f & FLAG.carry) !== 0, true);
  });

  it("increments without disturbing carry", () => {
    const { state, alu } = createSubject();
    state.registers.f = FLAG.carry | 0x02;

    const result = alu.inr(0x0f);

    assert.strictEqual(result, 0x10);
    assert.strictEqual((state.registers.f & FLAG.halfcarry) !== 0, true);
    assert.strictEqual((state.registers.f & FLAG.carry) !== 0, true);
  });
});
