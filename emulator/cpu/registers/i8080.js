export const FLAG = Object.freeze({
  carry: 0x01,
  parity: 0x04,
  halfcarry: 0x10,
  zero: 0x40,
  sign: 0x80,
});

export const REGISTER_DEFS = Object.freeze([
  { name: "pc", bits: 16 },
  { name: "sp", bits: 16 },
  { name: "a", bits: 8 },
  { name: "f", bits: 8 },
  { name: "b", bits: 8 },
  { name: "c", bits: 8 },
  { name: "d", bits: 8 },
  { name: "e", bits: 8 },
  { name: "h", bits: 8 },
  { name: "l", bits: 8 },
]);

export const REG_NAMES = Object.freeze(["b", "c", "d", "e", "h", "l", "m", "a"]);
export const RP_NAMES = Object.freeze(["bc", "de", "hl", "sp"]);
export const CONDITION_NAMES = Object.freeze(["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"]);
export const INTERRUPT_INTERVAL = 16667;
export const DEFAULT_DEBUG_SAMPLE_INSTRUCTION_INTERVAL = 31;

export const createI8080State = (manifest = {}) => ({
  registers: {
    a: 0, f: 0x02,
    b: 0, c: 0,
    d: 0, e: 0,
    h: 0, l: 0,
    sp: manifest.cpu?.initialSp ?? 0,
    pc: manifest.cpu?.initialPc ?? 0,
  },
  halted: false,
  interruptEnabled: false,
  cycles: 0,
  totalCycles: 0,
  lastOpCycles: 0,
  instructionCount: 0,
  interruptCounter: 0,
  interruptVector: 0x08,
  cycleRollover: false,
  lastOpcode: 0,
  lastAddress: 0,
  history: [],
  ports: new Uint8Array(0x100),
  outputPorts: new Uint8Array(0x100),
  shiftRegister: 0,
  shiftOffset: 0,
  soundWrites: [],
  warnings: [],
  haltedReason: "",
  debugSample: null,
  stackSample: null,
  nextDebugSampleInstruction: 0,
});

export const flagsForRegisters = (registers) => Object.entries(FLAG).map(([name, mask]) => ({
  name,
  mask,
  set: (registers.f & mask) === mask,
}));

const createI8080RegisterInterface = () => ({
  flagDefs: FLAG,
  registerDefs: REGISTER_DEFS,
  registerNames: REG_NAMES,
  pairNames: RP_NAMES,
  conditionNames: CONDITION_NAMES,
  createState: createI8080State,
  flagsForRegisters,
});

export default createI8080RegisterInterface;
