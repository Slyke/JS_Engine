const createALU = ({ getRegister, setRegister, readMem, writeMem, flagDefs }) => {
  const parity = (x, size) => {
    return preCalculatedParitySize8(x, 8)
    // var p = 0;
    // x = (x & ((1 << size) - 1));
    // for (var i = 0; i < size; i++) {
    //   if (x & 0x1) p++;
    //   x = x >> 1;
    // }
    // return (0 == (p & 0x1));
  };

  const preCalculatedParitySize8 = (value) => {
    // Technically parity(x, 8) will produce this. I extracted the values so it doesn't have to each time.
    var parityBits = [
      1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1,
      0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
      0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
      1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1,
      0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
      1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1,
      1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1,
      0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
      0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
      1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1,
      1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1,
      0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
      1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1,
      0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
      0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
      1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1
    ];
    return parityBits[value];
  };

  const mask8 = (val) => val & 0xFF;
  const mask16 = (val) => val & 0xFFFF;

  const buildFlags = ({ result, lhs, rhs, isSub = false }) => {
    const res = mask8(result);
    const overflow = isSub
      ? (((lhs ^ rhs) & (lhs ^ res) & 0x80) !== 0)
      : (((~(lhs ^ rhs)) & (lhs ^ res) & 0x80) !== 0);
    return {
      sign: (res & flagDefs.sign) !== 0,
      zero: res === 0,
      halfcarry: ((lhs ^ rhs ^ res) & 0x10) !== 0,
      parity: overflow,
      carry: result > 0xFF || result < 0,
      subtract: isSub
    };
  };

  const applyFlags = (emuState, fReg, flags) => {
    let reg = 0;
    if (flags.sign) reg |= flagDefs.sign;
    if (flags.zero) reg |= flagDefs.zero;
    if (flags.halfcarry) reg |= flagDefs.halfcarry;
    if (flags.parity) reg |= flagDefs.parity;
    if (flags.carry) reg |= flagDefs.carry;
    if (flags.subtract) reg |= flagDefs.subtract;
    setRegister(emuState, fReg, reg);
  };

  const logicFlags = (result, halfcarry = false) => {
    const res = mask8(result);
    return {
      sign: (res & flagDefs.sign) !== 0,
      zero: res === 0,
      halfcarry,
      parity: parity(res),
      carry: false,
      subtract: false
    };
  };

  const add8 = (emuState, aReg, bVal, fReg) => {
    const lhs = getRegister(emuState, aReg);
    const rhs = bVal;
    const result = lhs + rhs;
    const flags = buildFlags({ result, lhs, rhs });
    setRegister(emuState, aReg, mask8(result));
    applyFlags(emuState, fReg, flags);
    return mask8(result);
  };

  const adc8 = (emuState, aReg, bVal, fReg) => {
    const lhs = getRegister(emuState, aReg);
    const rhs = bVal;
    const carry = getRegister(emuState, fReg) & flagDefs.carry ? 1 : 0;
    const result = lhs + rhs + carry;
    const flags = buildFlags({ result, lhs, rhs });
    setRegister(emuState, aReg, mask8(result));
    applyFlags(emuState, fReg, flags);
    return mask8(result);
  };

  const sub8 = (emuState, aReg, bVal, fReg) => {
    const lhs = getRegister(emuState, aReg);
    const rhs = bVal;
    const result = lhs - rhs;
    const flags = buildFlags({ result, lhs, rhs, isSub: true });
    setRegister(emuState, aReg, mask8(result));
    applyFlags(emuState, fReg, flags);
    return mask8(result);
  };

  const sbc8 = (emuState, aReg, bVal, fReg) => {
    const lhs = getRegister(emuState, aReg);
    const rhs = bVal;
    const carry = getRegister(emuState, fReg) & flagDefs.carry ? 1 : 0;
    const result = lhs - rhs - carry;
    const flags = buildFlags({ result, lhs, rhs, isSub: true });
    setRegister(emuState, aReg, mask8(result));
    applyFlags(emuState, fReg, flags);
    return mask8(result);
  };

  const and8 = (emuState, aReg, bVal, fReg) => {
    const result = getRegister(emuState, aReg) & bVal;
    setRegister(emuState, aReg, result);
    applyFlags(emuState, fReg, logicFlags(result, true));
    return result;
  };

  const or8 = (emuState, aReg, bVal, fReg) => {
    const result = getRegister(emuState, aReg) | bVal;
    setRegister(emuState, aReg, result);
    applyFlags(emuState, fReg, logicFlags(result));
    return result;
  };

  const xor8 = (emuState, aReg, bVal, fReg) => {
    const result = getRegister(emuState, aReg) ^ bVal;
    setRegister(emuState, aReg, result);
    applyFlags(emuState, fReg, logicFlags(result));
    return result;
  };

  const inc8 = (emuState, reg, fReg) => {
    const val = getRegister(emuState, reg);
    const result = val + 1;
    const carry = getRegister(emuState, fReg) & flagDefs.carry;
    const res = mask8(result);
    const flags = {
      sign: (res & flagDefs.sign) !== 0,
      zero: res === 0,
      halfcarry: ((val & 0x0f) + 1) > 0x0f,
      parity: val === 0x7f,
      carry: carry !== 0,
      subtract: false
    };
    setRegister(emuState, reg, mask8(result));
    applyFlags(emuState, fReg, flags);
    return mask8(result);
  };

  const dec8 = (emuState, reg, fReg) => {
    const val = getRegister(emuState, reg)
    const result = val - 1
    const carry = getRegister(emuState, fReg) & flagDefs.carry
    const res = mask8(result)
    const flags = {
      sign: (res & flagDefs.sign) !== 0,
      zero: res === 0,
      halfcarry: (val & 0x0f) === 0,
      parity: val === 0x80,
      carry: carry !== 0,
      subtract: true
    }
    setRegister(emuState, reg, mask8(result))
    applyFlags(emuState, fReg, flags)
    return mask8(result)
  };

  const cpl = (emuState, aReg) => {
    const val = getRegister(emuState, aReg);
    setRegister(emuState, aReg, val ^ 0xFF)
  };

  const rlc = (emuState, reg, fReg) => {
    const val = getRegister(emuState, reg);
    const carry = (val >> 7) & 1;
    const result = ((val << 1) | carry) & 0xFF;
    setRegister(emuState, reg, result);
    applyFlags(emuState, fReg, {
      sign: result & 0x80,
      zero: result === 0,
      halfcarry: false,
      parity: parity(result),
      carry: carry !== 0
    });
  };

  return {
    add8,
    adc8,
    sub8,
    sbc8,
    and8,
    or8,
    xor8,
    inc8,
    dec8,
    cpl,
    rlc
  };
};

export default createALU;
