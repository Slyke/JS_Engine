const createZ80IOBus = (size = 0x10000) => {
  const io = new Uint8Array(size);

  const inByte  = (emuState, port16) => io[port16 & 0xFFFF];
  const outByte = (emuState, port16, value) => { io[port16 & 0xFFFF] = value & 0xFF; };

  return { inByte, outByte, raw: io };
};

export default createZ80IOBus;
