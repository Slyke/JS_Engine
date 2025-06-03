const u8 = (value) => value & 0xff;
const u16 = (value) => value & 0xffff;

export const parityEven = (value) => {
  let v = value & 0xff;
  v ^= v >> 4;
  v &= 0x0f;
  return ((0x6996 >> v) & 1) === 0;
};

const createI8080ALU = ({ getState, getHL, setHL, setFlag, getFlag, flagDefs }) => {
  const registers = () => getState().registers;

  const setSZP = (value) => {
    const result = u8(value);
    setFlag(flagDefs.sign, (result & 0x80) !== 0);
    setFlag(flagDefs.zero, result === 0);
    setFlag(flagDefs.parity, parityEven(result));
  };

  const add = (value, carry = 0) => {
    const regs = registers();
    const a = regs.a;
    const rhs = u8(value);
    const result = a + rhs + carry;
    const out = u8(result);
    regs.a = out;
    setSZP(out);
    setFlag(flagDefs.carry, result > 0xff);
    setFlag(flagDefs.halfcarry, ((a & 0x0f) + (rhs & 0x0f) + carry) > 0x0f);
  };

  const sub = (value, borrow = 0, compareOnly = false) => {
    const regs = registers();
    const a = regs.a;
    const rhs = u8(value);
    const result = a - rhs - borrow;
    const out = u8(result);
    if (!compareOnly) regs.a = out;
    setSZP(out);
    setFlag(flagDefs.carry, result < 0);
    setFlag(flagDefs.halfcarry, ((a ^ rhs ^ out) & 0x10) !== 0);
  };

  const ana = (value) => {
    const regs = registers();
    const out = regs.a & u8(value);
    regs.a = out;
    setSZP(out);
    setFlag(flagDefs.carry, false);
    setFlag(flagDefs.halfcarry, true);
  };

  const xra = (value) => {
    const regs = registers();
    const out = regs.a ^ u8(value);
    regs.a = out;
    setSZP(out);
    setFlag(flagDefs.carry, false);
    setFlag(flagDefs.halfcarry, false);
  };

  const ora = (value) => {
    const regs = registers();
    const out = regs.a | u8(value);
    regs.a = out;
    setSZP(out);
    setFlag(flagDefs.carry, false);
    setFlag(flagDefs.halfcarry, false);
  };

  const inr = (value) => {
    const out = u8(value + 1);
    setSZP(out);
    setFlag(flagDefs.halfcarry, ((value & 0x0f) + 1) > 0x0f);
    return out;
  };

  const dcr = (value) => {
    const out = u8(value - 1);
    setSZP(out);
    setFlag(flagDefs.halfcarry, (value & 0x0f) === 0);
    return out;
  };

  const dad = (value) => {
    const result = getHL() + u16(value);
    setHL(result);
    setFlag(flagDefs.carry, result > 0xffff);
  };

  return {
    parityEven,
    setSZP,
    add,
    sub,
    ana,
    xra,
    ora,
    inr,
    dcr,
    dad,
    getFlag,
  };
};

export default createI8080ALU;
