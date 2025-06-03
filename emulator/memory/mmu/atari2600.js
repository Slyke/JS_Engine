const createAtari2600MMU = (devices = [], memoryConfig = {}) => {
  const listeners = { read: [], write: [] };
  const memory = devices.find((device) => device.type === "atari2600" || device.tia || device.riot)
    ?? devices.find((device) => device.readByte)
    ?? null;
  const segments = memoryConfig.segments ?? [];

  if (!memory) throw new Error("Atari 2600 MMU requires an Atari 2600 memory device");

  const emit = (type, event) => {
    for (const listener of listeners[type] ?? []) listener(event);
  };

  const findSegment = (address) => {
    const addr = address & 0x1fff;
    return segments.find((segment) => {
      const start = segment.start & 0x1fff;
      const size = Math.max(1, Number(segment.size) || 1);
      const end = segment.end != null ? (segment.end & 0x1fff) : ((start + size - 1) & 0x1fff);
      return end >= start ? addr >= start && addr <= end : addr >= start || addr <= end;
    }) ?? null;
  };

  const readByte = (emu, address) => {
    const addr = address & 0xffff;
    const physical = addr & 0x1fff;
    const value = memory.readByte(emu, physical) & 0xff;
    emit("read", { address: addr, physical, value, device: memory, segment: findSegment(physical) });
    return value;
  };

  const peekByte = (emu, address) => {
    const physical = address & 0x1fff;
    return (memory.peekByte ? memory.peekByte(emu, physical) : memory.readByte(emu, physical)) & 0xff;
  };

  const writeByte = (emu, address, value) => {
    const addr = address & 0xffff;
    const physical = addr & 0x1fff;
    const next = value & 0xff;
    memory.writeByte(emu, physical, next);
    emit("write", { address: addr, physical, value: next, device: memory, segment: findSegment(physical), blocked: false });
  };

  const loadByte = (emu, address, value, options = {}) => {
    if (memory.loadByte) memory.loadByte(emu, address & 0x1fff, value & 0xff, options);
    else writeByte(emu, address, value);
  };

  const loadBytes = (emu, offset, bytes, options = {}) => (
    memory.loadBytes
      ? memory.loadBytes(emu, offset & 0xffff, bytes, options)
      : (() => {
        const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes ?? []);
        const start = offset & 0xffff;
        for (let i = 0; i < data.length; i += 1) loadByte(emu, start + i, data[i], options);
        return { start, length: data.length, end: (start + Math.max(0, data.length - 1)) & 0xffff };
      })()
  );

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

  const getMemoryMap = () => (segments.length ? segments : [
    { type: "tia", label: "TIA registers", start: 0x0000, size: 0x0080, writable: true },
    { type: "ram", label: "RIOT RAM", start: 0x0080, size: 0x0080, writable: true },
    { type: "riot", label: "RIOT I/O", start: 0x0280, size: 0x0080, writable: true },
    { type: "rom", label: "Cartridge", start: 0x1000, size: 0x1000, writable: false },
  ]).map((entry) => {
    const start = entry.start >>> 0;
    const size = entry.size >>> 0;
    const end = entry.end != null ? entry.end >>> 0 : start + Math.max(1, size) - 1;
    return {
      type: entry.type,
      index: entry.index ?? 0,
      label: entry.label ?? entry.type,
      start,
      end,
      size: end >= start ? end - start + 1 : size,
      writable: entry.writable !== false,
    };
  });

  const searchByte = (emu, value, start = 0, end = 0x2000, limit = 1024) => {
    const needle = value & 0xff;
    const results = [];
    const from = Math.max(0, start >>> 0);
    const to = Math.min(0x2000, end >>> 0);
    for (let address = from; address < to && results.length < limit; address += 1) {
      if (peekByte(emu, address) === needle) results.push(address);
    }
    return results;
  };

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
    tick: (emu, cycles) => memory.tick?.(emu, cycles),
    irqActive: () => false,
    consumeNmi: () => false,
    debugPorts: (emu) => memory.debugPorts?.(emu) ?? [],
    soundWrites: memory.soundWrites,
    videoFrame: () => memory.tia?.getFrame?.() ?? memory.tia?.displayFrame ?? memory.tia?.frame ?? null,
    getCartridgeState: () => memory.getCartridgeState?.() ?? null,
  };
};

export default createAtari2600MMU;
