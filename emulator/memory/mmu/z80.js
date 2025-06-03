const createZ80MMU = (devices = [], memoryConfig = {}) => {
  const listeners = { read: [], write: [] };
  const segments = memoryConfig.segments ?? [];
  const fetchAliases = (memoryConfig.fetchAliases ?? []).map((alias) => {
    const start = alias.start >>> 0;
    const end = alias.end != null ? alias.end >>> 0 : start + Math.max(1, alias.size >>> 0) - 1;
    const targetStart = alias.targetStart >>> 0;
    const preserveOpcodes = new Set((alias.preserveOpcodes ?? []).map((opcode) => opcode & 0xff));
    const defaultOpcode = alias.defaultOpcode == null ? null : (alias.defaultOpcode & 0xff);
    return { start, end, targetStart, preserveOpcodes, defaultOpcode };
  });

  const findDevice = (addr) => devices.find((dev) => addr >= dev.start && addr < dev.start + dev.size);
  const findLoadDevice = (addr) => devices.find((dev) => (
    typeof dev.loadByte === "function"
    && addr >= dev.start
    && addr < dev.start + dev.size
  ));
  const findSegment = (addr) => segments.find((segment) => {
    const start = segment.start >>> 0;
    const size = segment.size >>> 0;
    const end = segment.end != null ? (segment.end >>> 0) : start + Math.max(0, size - 1);
    return addr >= start && addr <= end;
  });

  const emit = (type, event) => {
    for (const listener of listeners[type] ?? []) listener(event);
  };

  const readByte = (emuState, addr) => {
    const address = addr & 0xffff;
    const dev = findDevice(address);
    const value = dev ? dev.readByte(emuState, address - dev.start) & 0xff : 0xff;
    emit('read', { address, value, device: dev ?? null, segment: findSegment(address) ?? null });
    return value;
  };

  const fetchAliasFor = (addr) => {
    const address = addr & 0xffff;
    return fetchAliases.find((entry) => address >= entry.start && address <= entry.end) ?? null;
  };

  const fetchByte = (emuState, addr) => {
    const address = addr & 0xffff;
    const alias = fetchAliasFor(address);
    if (!alias) return readByte(emuState, address);
    const value = readByte(emuState, (alias.targetStart + (address - alias.start)) & 0xffff);
    return alias.defaultOpcode != null && !alias.preserveOpcodes.has(value) ? alias.defaultOpcode : value;
  };

  const peekByte = (emuState, addr) => {
    const address = addr & 0xffff;
    const dev = findDevice(address);
    if (!dev) return 0xff;
    const offset = address - dev.start;
    if (dev.peekByte) return dev.peekByte(emuState, offset) & 0xff;
    if (dev.raw) return dev.raw[offset & (dev.raw.length - 1)] & 0xff;
    if (findSegment(address)?.type === "io") return 0xff;
    return dev.readByte ? dev.readByte(emuState, offset) & 0xff : 0xff;
  };

  const canWriteAddress = (address, dev) => {
    if (!dev?.writeByte) return false;
    const segment = findSegment(address);
    if (segment?.writable === false) return false;
    return dev.writable !== false;
  };

  const writeByte = (emuState, addr, value) => {
    const address = addr & 0xffff;
    const next = value & 0xff;
    const dev = findDevice(address);
    const segment = findSegment(address) ?? null;
    const blocked = !canWriteAddress(address, dev);
    if (!blocked) dev.writeByte(emuState, address - dev.start, next);
    emit('write', { address, value: next, device: dev ?? null, segment, blocked });
  };

  const loadByte = (emuState, addr, value, options = {}) => {
    const address = addr & 0xffff;
    const next = value & 0xff;
    const dev = (options.target != null || options.physical === true ? findLoadDevice(address) : null) ?? findDevice(address);
    if (dev?.loadByte) dev.loadByte(emuState, address - dev.start, next, options);
    else if (dev?.writeByte) dev.writeByte(emuState, address - dev.start, next);
  };

  const loadBytes = (emuState, offset, bytes, options = {}) => {
    const start = offset & 0xffff;
    if (!(bytes instanceof Uint8Array)) bytes = Uint8Array.from(bytes ?? []);
    for (let i = 0; i < bytes.length; i += 1) loadByte(emuState, start + i, bytes[i], options);
    return { start, length: bytes.length, end: (start + Math.max(0, bytes.length - 1)) & 0xffff };
  };

  const readWord = (emuState, addr) => {
    const lo = readByte(emuState, addr);
    const hi = readByte(emuState, (addr + 1) & 0xffff);
    return (hi << 8) | lo;
  };

  const peekWord = (emuState, addr) => {
    const lo = peekByte(emuState, addr);
    const hi = peekByte(emuState, (addr + 1) & 0xffff);
    return (hi << 8) | lo;
  };

  const writeWord = (emuState, addr, value) => {
    writeByte(emuState, addr, value & 0xff);
    writeByte(emuState, (addr + 1) & 0xffff, (value >> 8) & 0xff);
  };

  const on = (type, listener) => {
    if (!listeners[type]) throw new Error('Unknown MMU event type: ' + type);
    listeners[type].push(listener);
    return () => {
      const index = listeners[type].indexOf(listener);
      if (index >= 0) listeners[type].splice(index, 1);
    };
  };

  const getMemoryMap = () => (segments.length ? segments : devices).map((entry) => {
    const start = entry.start >>> 0;
    const size = entry.size >>> 0;
    const end = entry.end != null ? entry.end >>> 0 : (start + Math.max(1, size) - 1) >>> 0;
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

  const searchByte = (emuState, value, start = 0, end = 0x10000, limit = 1024) => {
    const needle = value & 0xff;
    const results = [];
    const from = Math.max(0, start >>> 0);
    const to = Math.min(0x10000, end >>> 0);
    for (let address = from; address < to && results.length < limit; address += 1) {
      if (peekByte(emuState, address) === needle) results.push(address);
    }
    return results;
  };

  return { devices, segments, readByte, fetchByte, peekByte, writeByte, loadByte, loadBytes, readWord, peekWord, writeWord, on, getMemoryMap, searchByte };
};

export default createZ80MMU;
