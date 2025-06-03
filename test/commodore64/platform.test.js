import assert from "assert";
import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { createEmulatorFromManifestURL } from "../../emulator/create-emulator.js";
import { renderFrame as renderC64Frame } from "../../emulator/video/commodore64-vic-ii.js";
import { repoRoot } from "../helpers/emulator-harness.js";

const manifestURL = () => pathToFileURL(path.join(repoRoot, "emulator/platforms/commodore64.json5")).href;
const romPath = () => path.join(repoRoot, "roms/commodore64/64c.251913-01.bin");

const createC64 = async () => {
  const emu = await createEmulatorFromManifestURL(manifestURL());
  const rom = new Uint8Array(await fs.readFile(romPath()));
  emu.mmu.loadBytes(emu, 0x0000, rom, { target: "system" });
  emu.cpu.reset(emu);
  return emu;
};

const run = (emu, count) => {
  for (let i = 0; i < count && !emu.debugBreakRequested; i += 1) emu.cpu.step(emu);
};

const screenCodesToText = (bytes) => bytes.map((value) => {
  const code = value & 0x7f;
  if (code === 0x20) return " ";
  if (code >= 1 && code <= 26) return String.fromCharCode(64 + code);
  if (code >= 0x20 && code <= 0x5f) return String.fromCharCode(code);
  return " ";
}).join("");

describe("Commodore 64 platform integration", function () {
  this.timeout(10000);

  it("loads the combined ROM into BASIC and KERNAL banks and resets through KERNAL", async () => {
    const emu = await createC64();

    assert.strictEqual(emu.mmu.peekByte(emu, 0xa000), 0x94);
    assert.strictEqual(emu.mmu.peekByte(emu, 0xe000), 0x85);
    assert.strictEqual(emu.mmu.peekWord(emu, 0xfffc), 0xfce2);
    assert.strictEqual(emu.cpu.registers.pc, 0xfce2);
  });

  it("can expose RAM under BASIC ROM through the 6510 port", async () => {
    const emu = await createC64();

    emu.mmu.writeByte(emu, 0xa000, 0x42);
    assert.strictEqual(emu.mmu.peekByte(emu, 0xa000), 0x94);

    emu.mmu.writeByte(emu, 0x0001, 0x34);

    assert.strictEqual(emu.mmu.peekByte(emu, 0xa000), 0x42);
  });

  it("boots to the BASIC editor screen from the provided ROM", async () => {
    const emu = await createC64();

    run(emu, 3000000);

    const screen = Array.from(emu.mmu.memory.raw.slice(0x0400, 0x0400 + 120));
    const text = screenCodesToText(screen);
    assert.strictEqual(text.includes("COMMODORE 64 BASIC V2"), true);
    assert.notStrictEqual(emu.debugBreakRequested, true);
    assert.strictEqual(emu.cpu.getDebugState().halted, false);
  });

  it("renders C64 text screen pixels from screen RAM and color RAM", async () => {
    const emu = await createC64();
    const pixels = [];
    const screenCtx = {
      fillStyle: "",
      fillRect(x, y, width, height) {
        if (this.fillStyle === "#9ae29b") pixels.push({ x, y, width, height });
      },
    };

    emu.mmu.memory.raw[0x0400] = 1;
    emu.mmu.memory.colorRam[0] = 13;
    renderC64Frame({ emu, screenCtx });

    assert.strictEqual(pixels.some(({ x, y }) => x >= 32 && x < 40 && y >= 36 && y < 44), true);
  });
});
