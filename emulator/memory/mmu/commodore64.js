const createCommodore64MMU = (devices = []) => {
  const listeners = { read: [], write: [] };
  const memory = devices.find((device) => device.type === "commodore64" || device.readVideoByte)
    ?? devices.find((device) => device.readByte)
    ?? null;

  if (!memory) throw new Error("Commodore 64 MMU requires a Commodore 64 memory device");

  const emit = (type, event) => {
    for (const listener of listeners[type] ?? []) listener(event);
  };

  const segmentFor = (address) => {
    const addr = address & 0xffff;
    return getMemoryMap().find((segment) => addr >= segment.start && addr <= segment.end) ?? null;
  };

  const readByte = (emu, address) => {
    const addr = address & 0xffff;
    const value = memory.readByte(emu, addr) & 0xff;
    emit("read", { address: addr, value, device: memory, segment: segmentFor(addr) });
    return value;
  };

  const peekByte = (emu, address) => memory.peekByte(emu, address & 0xffff) & 0xff;

  const writeByte = (emu, address, value) => {
    const addr = address & 0xffff;
    const next = value & 0xff;
    memory.writeByte(emu, addr, next);
    emit("write", { address: addr, value: next, device: memory, segment: segmentFor(addr), blocked: false });
  };

  const loadByte = (emu, address, value, options = {}) => memory.loadByte(emu, address & 0xffff, value & 0xff, options);
  const loadBytes = (emu, offset, bytes, options = {}) => memory.loadBytes(emu, offset & 0xffff, bytes, options);
  const readWord = (emu, address) => readByte(emu, address) | (readByte(emu, address + 1) << 8);
  const peekWord = (emu, address) => peekByte(emu, address) | (peekByte(emu, address + 1) << 8);
  const writeWord = (emu, address, value) => {
    writeByte(emu, address, value);
    writeByte(emu, address + 1, value >> 8);
  };

  const on = (type, listener) => {
    if (!listeners[type]) throw new Error("Unknown MMU event type: " + type);
    listeners[type].push(listener);
    return () => {
      const index = listeners[type].indexOf(listener);
      if (index >= 0) listeners[type].splice(index, 1);
    };
  };

  const getMemoryMap = () => memory.getMemoryMap?.() ?? [{
    type: "ram",
    label: "64K Address Space",
    start: 0,
    end: 0xffff,
    size: 0x10000,
    writable: true,
  }];

  const searchByte = (emu, value, start = 0, end = 0x10000, limit = 1024) => (
    memory.searchByte?.(emu, value, start, end, limit) ?? []
  );

  return {
    devices,
    memory,
    readByte,
    fetchByte: readByte,
    peekByte,
    writeByte,
    loadByte,
    loadBytes,
    readWord,
    peekWord,
    writeWord,
    on,
    getMemoryMap,
    searchByte,
    readVideoByte: (emu, address) => memory.readVideoByte(emu, address),
    tick: (emu, cycles) => memory.tick(emu, cycles),
    irqActive: (emu) => memory.irqActive(emu),
    consumeNmi: (emu) => memory.consumeNmi(emu),
    debugPorts: (emu) => memory.debugPorts(emu),
    soundWrites: memory.soundWrites,
  };
};

export default createCommodore64MMU;
