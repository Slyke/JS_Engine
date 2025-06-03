const createZ80RAM = (size = 8192) => {
  const ram = new Uint8Array(size);

  const readByte = (emuState, addr) => ram[addr & (size - 1)];

  const writeByte = (emuState, addr, value) => {
    ram[addr & (size - 1)] = value & 0xFF;
  };

  return {
    readByte,
    writeByte
  };
};

export default createZ80RAM;
