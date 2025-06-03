const createFlatMemory = (size = 0x10000) => {
  const raw = new Uint8Array(size);
  const mask = size - 1;

  const readByte = (_emuState, address) => raw[address & mask];
  const writeByte = (_emuState, address, value) => {
    raw[address & mask] = value & 0xff;
  };

  const loadBytes = (offset, bytes) => {
    const start = offset >>> 0;
    for (let i = 0; i < bytes.length && start + i < raw.length; i += 1) {
      raw[start + i] = bytes[i] & 0xff;
    }
  };

  return { raw, readByte, writeByte, loadBytes };
};

export default createFlatMemory;
