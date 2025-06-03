const createZ80RegisterInterface = () => {
  const registerBank = () => ({
    pc: 0,
    sp: 0,
    a: 0, f: 0,
    b: 0, c: 0,
    d: 0, e: 0,
    h: 0, l: 0,
    ix: 0,
    iy: 0,
    i: 0,
    r: 0,
    // Shadow registers for EXX instruction
    a_: 0, f_: 0,   // AF'
    b_: 0, c_: 0,   // BC'
    d_: 0, e_: 0,   // DE'
    h_: 0, l_: 0   // HL'
  });

  const getRegister = (emuState, reg, endian = 0x01) => {
    const registers = emuState.cpu.registers;
    reg = reg.toLowerCase();

    const get16 = (hi, lo) => endian === 0x01
      ? ((registers[hi] << 8) | registers[lo]) & 0xFFFF
      : ((registers[lo] << 8) | registers[hi]) & 0xFFFF;

    switch (reg) {
      case 'pc':
      case 'sp':
      case 'ix':
      case 'iy': return registers[reg] & 0xFFFF;
      case 'a': case 'f':
      case 'b': case 'c':
      case 'd': case 'e':
      case 'h': case 'l':
      case 'i': case 'r': return registers[reg] & 0xFF;
      case 'af': return get16('a', 'f');
      case 'bc': return get16('b', 'c');
      case 'de': return get16('d', 'e');
      case 'hl': return get16('h', 'l');
      default: throw new Error(`Unknown register: ${reg}`);
    }
  };

  const setRegister = (emuState, reg, value, endian = 0x02) => {
    const registers = emuState.cpu.registers;
    reg = reg.toLowerCase();
    value = typeof value === 'object' ? ((value[1] << 8) | value[0]) & 0xFFFF : value;
    const lo = value & 0xFF;
    const hi = (value >> 8) & 0xFF;

    const set16 = (hiName, loName) => {
      if (endian === 0x01) {
        registers[hiName] = hi;
        registers[loName] = lo;
      } else {
        registers[hiName] = lo;
        registers[loName] = hi;
      }
    };

    switch (reg) {
      case 'pc':
      case 'sp':
      case 'ix':
      case 'iy': registers[reg] = value & 0xFFFF; break;
      case 'a': case 'f':
      case 'b': case 'c':
      case 'd': case 'e':
      case 'h': case 'l':
      case 'i': case 'r': registers[reg] = value & 0xFF; break;
      case 'af': set16('a', 'f'); break;
      case 'bc': set16('b', 'c'); break;
      case 'de': set16('d', 'e'); break;
      case 'hl': set16('h', 'l'); break;
      default: throw new Error(`Unknown register: ${reg}`);
    }
  };

  return {
    registerBank,
    getRegister,
    setRegister
  };
};

export default createZ80RegisterInterface;
