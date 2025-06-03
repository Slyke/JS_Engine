const createZ80ROM = (size = 8192) => {
  const rom = new Uint8Array(size);

  const readByte = (emuState, addr) => rom[addr & (size - 1)];

  const writeByte = (emuState, addr, value) => {
    throw new Error("Attempt to write to ROM");
  };

  return {
    readByte,
    writeByte
  };
};

export default createZ80ROM;
