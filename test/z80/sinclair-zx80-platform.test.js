import assert from "assert";
import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { createEmulatorFromManifestURL } from "../../emulator/create-emulator.js";
import { renderFrame as renderZX80Frame } from "../../emulator/video/sinclair-zx80-display-file.js";
import { repoRoot } from "../helpers/emulator-harness.js";

const createZX80 = async () => {
  const manifestURL = pathToFileURL(path.join(repoRoot, "emulator/platforms/sinclair-zx80.json5")).href;
  const emu = await createEmulatorFromManifestURL(manifestURL);
  const rom = new Uint8Array(await fs.readFile(path.join(repoRoot, "roms/sinclair-zx80/zx80.rom")));
  emu.mmu.loadBytes(emu, 0x0000, rom);
  emu.cpu.reset(emu);
  return emu;
};

const readByte = (emu, address) => (
  emu.mmu.peekByte ? emu.mmu.peekByte(emu, address) : emu.mmu.readByte(emu, address)
);
const readWord = (emu, address) => readByte(emu, address) | (readByte(emu, address + 1) << 8);
const bytes = (emu, start, count) => Array.from({ length: count }, (_value, index) => readByte(emu, start + index));
const run = (emu, count) => {
  for (let i = 0; i < count && !emu.debugBreakRequested; i += 1) {
    emu.cpu.step(emu);
  }
};
const tap = (emu, key, down = 120000, up = 80000) => {
  emu.cpu.setInput(key, true);
  run(emu, down);
  emu.cpu.setInput(key, false);
  run(emu, up);
};

describe("Sinclair ZX80 platform ROM integration", function () {
  this.timeout(5000);

  it("boots to the command prompt from the bundled ROM", async () => {
    const emu = await createZX80();

    run(emu, 180000);

    const eLine = readWord(emu, 0x400a);
    const dFile = readWord(emu, 0x400c);
    assert.strictEqual(eLine, 0x4029);
    assert.strictEqual(dFile, 0x402b);
    assert.deepStrictEqual(bytes(emu, eLine, dFile - eLine), [0xb0, 0x76]);
    assert.notStrictEqual(emu.debugBreakRequested, true);
  });

  it("accepts Enter through the keyboard matrix", async () => {
    const emu = await createZX80();

    run(emu, 180000);
    tap(emu, "1");

    let eLine = readWord(emu, 0x400a);
    let dFile = readWord(emu, 0x400c);
    assert.deepStrictEqual(bytes(emu, eLine, dFile - eLine), [0x1d, 0xb0, 0x76]);

    tap(emu, "enter");

    eLine = readWord(emu, 0x400a);
    dFile = readWord(emu, 0x400c);
    assert.deepStrictEqual(bytes(emu, eLine, dFile - eLine), [0xb0, 0x76]);
    assert.notStrictEqual(emu.debugBreakRequested, true);
  });

  it("accepts PC quote aliases as the ZX80 string quote", async () => {
    const emu = await createZX80();

    run(emu, 180000);
    tap(emu, "quote");

    let eLine = readWord(emu, 0x400a);
    let dFile = readWord(emu, 0x400c);
    assert.deepStrictEqual(bytes(emu, eLine, dFile - eLine), [0x01, 0xb0, 0x76]);

    tap(emu, "rubout");
    tap(emu, "apostrophe");

    eLine = readWord(emu, 0x400a);
    dFile = readWord(emu, 0x400c);
    assert.deepStrictEqual(bytes(emu, eLine, dFile - eLine), [0x01, 0xb0, 0x76]);
    assert.notStrictEqual(emu.debugBreakRequested, true);
  });

  it("accepts plus and expands it into the display file", async () => {
    const emu = await createZX80();

    run(emu, 180000);
    for (const key of ["o", "2", "plus"]) {
      tap(emu, key);
    }

    const eLine = readWord(emu, 0x400a);
    const dFile = readWord(emu, 0x400c);
    const dfEnd = readWord(emu, 0x4010);
    assert.deepStrictEqual(bytes(emu, eLine, dFile - eLine), [0xf4, 0x1e, 0xdd, 0xb0, 0x76]);
    assert.strictEqual(bytes(emu, dFile, dfEnd - dFile).includes(0x13), true);
    assert.notStrictEqual(emu.debugBreakRequested, true);
  });

  it("renders the expanded plus glyph on the command line", async () => {
    const emu = await createZX80();
    const inkPixels = [];
    const screenCtx = {
      fillStyle: "",
      fillRect(x, y, width, height) {
        if (this.fillStyle === "#101010") inkPixels.push({ x, y, width, height });
      },
    };

    run(emu, 180000);
    for (const key of ["o", "2", "plus"]) {
      tap(emu, key);
    }
    renderZX80Frame({ emu, screenCtx });

    assert.strictEqual(inkPixels.some(({ x, y }) => x >= 56 && x < 64 && y >= 184 && y < 192), true);
  });

  it("executes PRINT expressions entered with the ZX80 keyword key", async () => {
    const emu = await createZX80();

    run(emu, 180000);
    for (const key of ["o", "2", "plus", "2"]) {
      tap(emu, key);
    }
    tap(emu, "enter");

    const eLine = readWord(emu, 0x400a);
    const dFile = readWord(emu, 0x400c);
    assert.strictEqual(readWord(emu, 0x4015), 0x0000);
    assert.strictEqual(eLine, dFile);
    assert.deepStrictEqual(bytes(emu, dFile, 3), [0x76, 0x20, 0x76]);
    assert.notStrictEqual(emu.debugBreakRequested, true);
  });

  it("does not execute display characters as real opcodes through the upper echo", async () => {
    const emu = await createZX80();

    run(emu, 180000);
    assert.deepStrictEqual(bytes(emu, 0xc048, 24), Array(24).fill(0x00));

    for (let i = 0; i < 8; i += 1) {
      tap(emu, "f");
    }

    const eLine = readWord(emu, 0x400a);
    const dFile = readWord(emu, 0x400c);
    assert.strictEqual(dFile - eLine, 10);
    assert.deepStrictEqual(bytes(emu, 0xc048, 24), Array(24).fill(0x00));
    assert.notStrictEqual(emu.debugBreakRequested, true);
  });
});
