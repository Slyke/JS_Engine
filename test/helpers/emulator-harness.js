import assert from "assert";
import path from "path";
import { fileURLToPath } from "url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(thisDir, "../..");
export const emulatorRoot = path.join(repoRoot, "emulator");

export const allOpcodes = () => Array.from({ length: 0x100 }, (_value, opcode) => opcode);

export const hex8 = (value) => "0x" + (value & 0xff).toString(16).toUpperCase().padStart(2, "0");

export const createTestMemory = (size = 0x10000) => {
  const raw = new Uint8Array(size);
  const mask = size - 1;

  const readByte = (_emuState, address) => raw[address & mask];
  const writeByte = (_emuState, address, value) => {
    raw[address & mask] = value & 0xff;
  };
  const load = (address, bytes) => {
    for (let i = 0; i < bytes.length; i += 1) raw[(address + i) & mask] = bytes[i] & 0xff;
  };

  return {
    raw,
    readByte,
    fetchByte: readByte,
    writeByte,
    readWord(_emuState, address) {
      return readByte(null, address) | (readByte(null, address + 1) << 8);
    },
    writeWord(emuState, address, value) {
      writeByte(emuState, address, value);
      writeByte(emuState, address + 1, value >> 8);
    },
    load,
  };
};

export const createTestEmulator = (cpu, memory, manifest = {}) => {
  const ioRaw = new Uint8Array(0x10000);
  const io = {
    raw: ioRaw,
    inByte(_emuState, port) {
      return ioRaw[port & 0xffff];
    },
    outByte(_emuState, port, value) {
      ioRaw[port & 0xffff] = value & 0xff;
    },
  };
  io.read = io.inByte;
  io.write = io.outByte;

  return {
    cpu,
    mmu: memory,
    io,
    audio: { writePort() {} },
    debugHooks: {},
    debugBreakRequested: false,
    manifest,
  };
};

export const withMutedConsole = (fn) => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = originalLog;
  }
};

export const assertOpcodeStep = (cpu, emu, opcode) => {
  assert.doesNotThrow(() => withMutedConsole(() => cpu.step(emu)), `${hex8(opcode)} should not throw`);
  const debug = cpu.getDebugState({ historyLength: 1 });
  assert.strictEqual(debug.lastOpcode, opcode, `${hex8(opcode)} should be recorded as the last opcode`);
  assert.strictEqual(debug.instructionCount, 1, `${hex8(opcode)} should count as one instruction`);
  assert.ok(debug.lastOpCycles > 0, `${hex8(opcode)} should consume cycles`);
};
