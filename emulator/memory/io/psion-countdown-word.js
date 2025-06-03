const DEFAULT_CYCLES_PER_TICK = 46080;

const createPsionCountdownWord = (_size = 2, options = {}) => {
  const cyclesPerTick = Math.max(1, Number(options.cyclesPerTick ?? DEFAULT_CYCLES_PER_TICK) || DEFAULT_CYCLES_PER_TICK);
  let value = 0;
  let lastCycles = 0;

  const currentCycles = (emuState) => Number(emuState?.cpu?.cycles ?? 0) || 0;

  const sync = (emuState) => {
    const cycles = currentCycles(emuState);
    if (value > 0 && cycles >= lastCycles) {
      const ticks = Math.floor((cycles - lastCycles) / cyclesPerTick);
      if (ticks > 0) {
        value = Math.max(0, value - ticks);
        lastCycles += ticks * cyclesPerTick;
        return;
      }
    }
    if (cycles < lastCycles) lastCycles = cycles;
  };

  const readByte = (emuState, offset) => {
    sync(emuState);
    return (offset & 1) === 0 ? (value >> 8) & 0xff : value & 0xff;
  };

  const peekByte = (emuState, offset) => {
    let next = value;
    const cycles = currentCycles(emuState);
    if (next > 0 && cycles >= lastCycles) {
      const ticks = Math.floor((cycles - lastCycles) / cyclesPerTick);
      if (ticks > 0) next = Math.max(0, next - ticks);
    }
    return (offset & 1) === 0 ? (next >> 8) & 0xff : next & 0xff;
  };

  const writeByte = (emuState, offset, byte) => {
    sync(emuState);
    if ((offset & 1) === 0) value = ((byte & 0xff) << 8) | (value & 0x00ff);
    else value = (value & 0xff00) | (byte & 0xff);
    lastCycles = currentCycles(emuState);
  };

  const reset = () => {
    value = 0;
    lastCycles = 0;
  };

  return {
    readByte,
    peekByte,
    writeByte,
    reset,
    serializeState: () => ({ value, lastCycles, byteLength: 2 }),
    restoreState: (_emuState, snapshot = {}) => {
      value = Number(snapshot.value) & 0xffff;
      lastCycles = Number(snapshot.lastCycles) || 0;
    },
  };
};

export default createPsionCountdownWord;
