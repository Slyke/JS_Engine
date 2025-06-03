const ADDRESS_SPACE_SIZE = 0x10000;
const FIXED_RAM_SIZE = 0x4000;
const BANK_WINDOW_SIZE = 0x4000;
const BANKED_RAM_START = 0x4000;
const BANKED_ROM_START = 0x8000;
const FIXED_ROM_START = 0xc000;

const parseSize = (value, fallback) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value >>> 0);
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return fallback;
  const parsed = text.startsWith("0x") ? parseInt(text, 16) : parseInt(text, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed >>> 0) : fallback;
};

const parseSizeList = (values) => Array.isArray(values)
  ? values.map((value) => parseSize(value, 0))
  : null;

const createBanks = (count, size) => Array.from({ length: Math.max(1, count >>> 0) }, () => new Uint8Array(size));
const bytesToArray = (bytes) => Array.from(bytes ?? []);
const restoreBytes = (target, source) => {
  target.fill(0);
  if (source == null) return;
  const bytes = source instanceof Uint8Array ? source : Uint8Array.from(source);
  target.set(bytes.subarray(0, target.length));
};

const createPsionLzMemory = (_size = ADDRESS_SPACE_SIZE, options = {}) => {
  const romSize = parseSize(options.romSize, ADDRESS_SPACE_SIZE);
  const ramSize = parseSize(options.ramSize, 0x8000);
  const fixedRamSize = parseSize(options.fixedRamSize, FIXED_RAM_SIZE);
  const bankWindowSize = parseSize(options.bankWindowSize, BANK_WINDOW_SIZE);
  const configuredRamBanks = parseSize(options.ramBankCount, Math.max(1, Math.ceil(Math.max(0, ramSize - fixedRamSize) / bankWindowSize)));
  const fixedRomOffset = parseSize(options.fixedRomOffset, Math.max(0, romSize - bankWindowSize));
  const romBankOffsets = parseSizeList(options.romBankOffsets)
    ?? Array.from({ length: Math.max(1, Math.floor(Math.max(0, romSize - bankWindowSize) / bankWindowSize)) }, (_value, index) => index * bankWindowSize);
  const romBankCount = Math.max(1, romBankOffsets.length);

  const rom = new Uint8Array(romSize).fill(0xff);
  const fixedRam = new Uint8Array(fixedRamSize);
  const ramBanks = createBanks(configuredRamBanks, bankWindowSize);
  let romBank = 0;
  let ramBank = 0;

  const resetBanks = () => {
    romBank = 0;
    ramBank = 0;
  };

  const reset = () => {
    fixedRam.fill(0);
    for (const bank of ramBanks) bank.fill(0);
    resetBanks();
  };

  const writeByte = (_emuState, offset, value) => {
    const address = offset & 0xffff;
    const next = value & 0xff;
    if (address < BANKED_RAM_START) fixedRam[address % fixedRam.length] = next;
    else if (address < BANKED_ROM_START) ramBanks[ramBank % ramBanks.length][address - BANKED_RAM_START] = next;
  };

  const loadByte = (emuState, offset, value, loadOptions = {}) => {
    const address = offset & 0xffff;
    if (loadOptions.target === "rom" || loadOptions.physical === true) {
      rom[address % rom.length] = value & 0xff;
      return;
    }
    writeByte(emuState, address, value);
  };

  const readByte = (_emuState, offset) => {
    const address = offset & 0xffff;
    if (address < BANKED_RAM_START) return fixedRam[address % fixedRam.length];
    if (address < BANKED_ROM_START) return ramBanks[ramBank % ramBanks.length][address - BANKED_RAM_START];
    if (address < FIXED_ROM_START) return rom[(romBankOffsets[romBank % romBankCount] + (address - BANKED_ROM_START)) % rom.length];
    return rom[(fixedRomOffset + (address - FIXED_ROM_START)) % rom.length];
  };

  const serializeState = () => ({
    romBank,
    ramBank,
    fixedRam: bytesToArray(fixedRam),
    ramBanks: ramBanks.map(bytesToArray),
    rom: bytesToArray(rom),
    byteLength: fixedRam.length + ramBanks.reduce((sum, bank) => sum + bank.length, 0) + rom.length,
  });

  const restoreState = (_emuState, snapshot = {}) => {
    restoreBytes(fixedRam, snapshot.fixedRam);
    if (Array.isArray(snapshot.ramBanks)) {
      for (let index = 0; index < ramBanks.length; index += 1) restoreBytes(ramBanks[index], snapshot.ramBanks[index]);
    } else {
      for (const bank of ramBanks) bank.fill(0);
    }
    if (snapshot.rom != null) restoreBytes(rom, snapshot.rom);
    romBank = Math.max(0, Number(snapshot.romBank) || 0) % romBankCount;
    ramBank = Math.max(0, Number(snapshot.ramBank) || 0) % ramBanks.length;
  };

  reset();

  return {
    readByte,
    writeByte,
    loadByte,
    reset,
    resetBanks,
    serializeState,
    restoreState,
    nextRomBank: () => { romBank = (romBank + 1) % romBankCount; },
    nextRamBank: () => { ramBank = (ramBank + 1) % ramBanks.length; },
    getState: () => ({
      romBank,
      ramBank,
      romBankCount,
      ramBankCount: ramBanks.length,
      fixedRomOffset,
      romBankOffsets: romBankOffsets.slice(),
    }),
  };
};

export default createPsionLzMemory;
