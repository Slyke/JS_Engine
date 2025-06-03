const u8 = (value) => value & 0xff;
const u16 = (value) => value & 0xffff;

export const FLAG_N = 0x08;
export const FLAG_Z = 0x04;
export const FLAG_V = 0x02;
export const FLAG_C = 0x01;

const createHD6303ALU = ({ getCpu, readByte, writeByte }) => {
  const registers = () => getCpu().registers;

  const setFlag = (mask, enabled) => {
    const regs = registers();
    regs.cc = enabled ? u8(regs.cc | mask) : u8(regs.cc & ~mask);
  };

  const setNZ8 = (value) => {
    const next = u8(value);
    setFlag(FLAG_N, (next & 0x80) !== 0);
    setFlag(FLAG_Z, next === 0);
    return next;
  };

  const setNZ16 = (value) => {
    const next = u16(value);
    setFlag(FLAG_N, (next & 0x8000) !== 0);
    setFlag(FLAG_Z, next === 0);
    return next;
  };

  const getD = () => (registers().a << 8) | registers().b;

  const setD = (value) => {
    const regs = registers();
    const word = u16(value);
    regs.a = u8(word >> 8);
    regs.b = u8(word);
    setNZ16(word);
  };

  const compare8 = (left, right) => {
    const result = left - right;
    const value = u8(result);
    setFlag(FLAG_N, (value & 0x80) !== 0);
    setFlag(FLAG_Z, value === 0);
    setFlag(FLAG_C, result < 0);
    setFlag(FLAG_V, (((left ^ right) & (left ^ value)) & 0x80) !== 0);
  };

  const subtractD = (right) => {
    const left = getD();
    const result = left - right;
    const value = u16(result);
    setD(value);
    setFlag(FLAG_C, result < 0);
    setFlag(FLAG_V, (((left ^ right) & (left ^ value)) & 0x8000) !== 0);
    return value;
  };

  const compare16 = (left, right) => {
    const result = left - right;
    const value = u16(result);
    setFlag(FLAG_N, (value & 0x8000) !== 0);
    setFlag(FLAG_Z, value === 0);
    setFlag(FLAG_C, result < 0);
    setFlag(FLAG_V, (((left ^ right) & (left ^ value)) & 0x8000) !== 0);
  };

  const updateLogical8 = (value) => {
    const next = setNZ8(value);
    setFlag(FLAG_V, false);
    return next;
  };

  const updateLogical16 = (value) => {
    const next = setNZ16(value);
    setFlag(FLAG_V, false);
    return next;
  };

  const add8 = (left, right, carry = 0) => {
    const result = left + right + carry;
    const value = u8(result);
    setNZ8(value);
    setFlag(FLAG_C, result > 0xff);
    setFlag(FLAG_V, (~(left ^ right) & (left ^ value) & 0x80) !== 0);
    return value;
  };

  const subtract8 = (left, right, carry = 0) => {
    const result = left - right - carry;
    const value = u8(result);
    setNZ8(value);
    setFlag(FLAG_C, result < 0);
    setFlag(FLAG_V, (((left ^ right) & (left ^ value)) & 0x80) !== 0);
    return value;
  };

  const addD = (right) => {
    const left = getD();
    const result = left + right;
    const value = u16(result);
    setD(value);
    setFlag(FLAG_C, result > 0xffff);
    setFlag(FLAG_V, (~(left ^ right) & (left ^ value) & 0x8000) !== 0);
    return value;
  };

  const binaryA = (right, op) => {
    const regs = registers();
    if (op === "sub") regs.a = subtract8(regs.a, right);
    else if (op === "cmp") compare8(regs.a, right);
    else if (op === "sbc") regs.a = subtract8(regs.a, right, (regs.cc & FLAG_C) ? 1 : 0);
    else if (op === "and") regs.a = updateLogical8(regs.a & right);
    else if (op === "bit") updateLogical8(regs.a & right);
    else if (op === "lda") regs.a = updateLogical8(right);
    else if (op === "eor") regs.a = updateLogical8(regs.a ^ right);
    else if (op === "adc") regs.a = add8(regs.a, right, (regs.cc & FLAG_C) ? 1 : 0);
    else if (op === "ora") regs.a = updateLogical8(regs.a | right);
    else if (op === "add") regs.a = add8(regs.a, right);
  };

  const binaryB = (right, op) => {
    const regs = registers();
    if (op === "sub") regs.b = subtract8(regs.b, right);
    else if (op === "cmp") compare8(regs.b, right);
    else if (op === "sbc") regs.b = subtract8(regs.b, right, (regs.cc & FLAG_C) ? 1 : 0);
    else if (op === "and") regs.b = updateLogical8(regs.b & right);
    else if (op === "bit") updateLogical8(regs.b & right);
    else if (op === "ldb") regs.b = updateLogical8(right);
    else if (op === "eor") regs.b = updateLogical8(regs.b ^ right);
    else if (op === "adc") regs.b = add8(regs.b, right, (regs.cc & FLAG_C) ? 1 : 0);
    else if (op === "orb") regs.b = updateLogical8(regs.b | right);
    else if (op === "add") regs.b = add8(regs.b, right);
  };

  const branchCondition = (opcode) => {
    const regs = registers();
    const n = (regs.cc & FLAG_N) !== 0;
    const z = (regs.cc & FLAG_Z) !== 0;
    const v = (regs.cc & FLAG_V) !== 0;
    const c = (regs.cc & FLAG_C) !== 0;
    switch (opcode) {
      case 0x21: return false;
      case 0x22: return !c && !z;
      case 0x23: return c || z;
      case 0x24: return !c;
      case 0x25: return c;
      case 0x26: return !z;
      case 0x27: return z;
      case 0x28: return !v;
      case 0x29: return v;
      case 0x2a: return !n;
      case 0x2b: return n;
      case 0x2c: return n === v;
      case 0x2d: return n !== v;
      case 0x2e: return !z && n === v;
      case 0x2f: return z || n !== v;
      default: return true;
    }
  };

  const setZ16Only = (value) => {
    const next = u16(value);
    setFlag(FLAG_Z, next === 0);
    return next;
  };

  const setShiftFlags = (value, carry) => {
    const next = setNZ8(value);
    const nextCarry = Boolean(carry);
    setFlag(FLAG_C, nextCarry);
    setFlag(FLAG_V, ((next & 0x80) !== 0) !== nextCarry);
    return next;
  };

  const neg8 = (value) => {
    const before = u8(value);
    const next = setNZ8(-before);
    setFlag(FLAG_C, before !== 0);
    setFlag(FLAG_V, before === 0x80);
    return next;
  };

  const com8 = (value) => {
    const next = updateLogical8(~value);
    setFlag(FLAG_C, true);
    return next;
  };

  const lsr8 = (value) => {
    const before = u8(value);
    const next = u8(before >> 1);
    setFlag(FLAG_N, false);
    setFlag(FLAG_Z, next === 0);
    setFlag(FLAG_C, (before & 0x01) !== 0);
    setFlag(FLAG_V, (before & 0x01) !== 0);
    return next;
  };

  const ror8 = (value) => {
    const regs = registers();
    const before = u8(value);
    const carryIn = (regs.cc & FLAG_C) ? 0x80 : 0;
    return setShiftFlags((before >> 1) | carryIn, (before & 0x01) !== 0);
  };

  const asr8 = (value) => {
    const before = u8(value);
    return setShiftFlags((before >> 1) | (before & 0x80), (before & 0x01) !== 0);
  };

  const asl8 = (value) => {
    const before = u8(value);
    return setShiftFlags(before << 1, (before & 0x80) !== 0);
  };

  const rol8 = (value) => {
    const regs = registers();
    const before = u8(value);
    const carryIn = (regs.cc & FLAG_C) ? 1 : 0;
    return setShiftFlags((before << 1) | carryIn, (before & 0x80) !== 0);
  };

  const dec8 = (value) => {
    const before = u8(value);
    const next = setNZ8(before - 1);
    setFlag(FLAG_V, before === 0x80);
    return next;
  };

  const inc8 = (value) => {
    const before = u8(value);
    const next = setNZ8(before + 1);
    setFlag(FLAG_V, before === 0x7f);
    return next;
  };

  const tst8 = (value) => {
    const next = setNZ8(value);
    setFlag(FLAG_V, false);
    setFlag(FLAG_C, false);
    return next;
  };

  const clr8 = () => {
    setFlag(FLAG_N, false);
    setFlag(FLAG_Z, true);
    setFlag(FLAG_V, false);
    setFlag(FLAG_C, false);
    return 0;
  };

  const lsrD = () => {
    const regs = registers();
    const before = getD();
    const next = u16(before >> 1);
    regs.a = u8(next >> 8);
    regs.b = u8(next);
    setFlag(FLAG_N, false);
    setFlag(FLAG_Z, next === 0);
    setFlag(FLAG_C, (before & 0x0001) !== 0);
    setFlag(FLAG_V, (before & 0x0001) !== 0);
  };

  const aslD = () => {
    const regs = registers();
    const before = getD();
    const carry = (before & 0x8000) !== 0;
    const next = u16(before << 1);
    regs.a = u8(next >> 8);
    regs.b = u8(next);
    setNZ16(next);
    setFlag(FLAG_C, carry);
    setFlag(FLAG_V, ((next & 0x8000) !== 0) !== carry);
  };

  const updateMemoryByte = (address, transform) => {
    const next = transform(readByte(address));
    writeByte(address, next);
    return next;
  };

  const bitModify = (address, mask, op) => {
    const before = readByte(address);
    const next = op === "and" ? (before & mask) : op === "or" ? (before | mask) : (before ^ mask);
    writeByte(address, next);
    updateLogical8(next);
  };

  const bitTest = (address, mask) => {
    updateLogical8(readByte(address) & mask);
  };

  return {
    FLAG_N,
    FLAG_Z,
    FLAG_V,
    FLAG_C,
    setFlag,
    setNZ8,
    setNZ16,
    getD,
    setD,
    compare8,
    subtractD,
    compare16,
    updateLogical8,
    updateLogical16,
    add8,
    subtract8,
    addD,
    binaryA,
    binaryB,
    branchCondition,
    setZ16Only,
    neg8,
    com8,
    lsr8,
    ror8,
    asr8,
    asl8,
    rol8,
    dec8,
    inc8,
    tst8,
    clr8,
    lsrD,
    aslD,
    updateMemoryByte,
    bitModify,
    bitTest,
  };
};

export default createHD6303ALU;
