const createZ80Audio = (size = 16) => {
  const regs = new Uint8Array(size);

  const readByte = (emuState, addr) => {
    // Optional: return playback state or register echo
    return regs[addr & (size - 1)];
  };

  const writeByte = (emuState, addr, value) => {
    // Simulate audio control (volume, frequency, waveform, etc.)
    regs[addr & (size - 1)] = value & 0xFF;

    // For debug/dev purposes
    console.log(`Audio write [0x${addr.toString(16)}] = 0x${value.toString(16)}`);
  };

  return {
    readByte,
    writeByte
  };
};

export default createZ80Audio;