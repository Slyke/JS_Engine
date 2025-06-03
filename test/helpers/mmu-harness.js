export const createMappedDevice = ({ start = 0, size = 0x100, writable = true, type = "ram" } = {}) => {
  const raw = new Uint8Array(size);
  return {
    type,
    start,
    size,
    writable,
    raw,
    readByte(_emuState, address) {
      return raw[address & (size - 1)];
    },
    writeByte(_emuState, address, value) {
      raw[address & (size - 1)] = value & 0xff;
    },
  };
};
