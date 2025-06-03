const u8 = (value) => value & 0xff;
const u16 = (value) => value & 0xffff;

export const REGISTER_DEFS = Object.freeze([
  { name: "pc", bits: 16 },
  { name: "sp", bits: 16 },
  { name: "x", bits: 16 },
  { name: "a", bits: 8 },
  { name: "b", bits: 8 },
  { name: "cc", bits: 8 },
]);

export const createHD6303InitialRegisters = (manifest = {}) => ({
  pc: u16(manifest.cpu?.initialPc ?? 0),
  sp: u16(manifest.cpu?.initialSp ?? 0),
  x: u16(manifest.cpu?.initialX ?? 0),
  a: u8(manifest.cpu?.initialA ?? 0),
  b: u8(manifest.cpu?.initialB ?? 0),
  cc: u8(manifest.cpu?.initialCc ?? 0),
});

const createHD6303RegisterInterface = () => ({
  registerDefs: REGISTER_DEFS,
  createInitialRegisters: createHD6303InitialRegisters,
});

export default createHD6303RegisterInterface;
