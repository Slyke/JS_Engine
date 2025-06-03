import assert from "assert";
import path from "path";
import { pathToFileURL } from "url";
import { createEmulatorFromManifestURL } from "../../emulator/create-emulator.js";
import createAtari2600TIAAudio from "../../emulator/audio/atari2600-tia.js";
import { renderFrame as renderAtariFrame } from "../../emulator/video/atari2600-tia.js";
import { repoRoot } from "../helpers/emulator-harness.js";

const manifestURL = () => pathToFileURL(path.join(repoRoot, "emulator/platforms/atari2600.json5")).href;

const createAtari = async () => createEmulatorFromManifestURL(manifestURL());
const createImageData = (emu) => {
  const width = Number(emu.manifest.video.width) || 160;
  const height = Number(emu.manifest.video.height) || 192;
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
};
const pixelAt = (imageData, x, y = 0) => {
  const index = (y * imageData.width + x) * 4;
  return Array.from(imageData.data.slice(index, index + 3));
};

const createRom = (size, program = [], resetVector = 0xf000) => {
  const rom = new Uint8Array(size).fill(0xea);
  const offset = resetVector & 0x0fff;
  rom.set(program, offset);
  for (let bank = 0; bank < Math.max(1, size / 0x1000); bank += 1) {
    const vector = bank * 0x1000 + 0x0ffc;
    if (vector + 1 < rom.length) {
      rom[vector] = resetVector & 0xff;
      rom[vector + 1] = (resetVector >> 8) & 0xff;
      rom[vector + 2] = resetVector & 0xff;
      rom[vector + 3] = (resetVector >> 8) & 0xff;
    }
  }
  return rom;
};

describe("Atari 2600 platform", function () {
  this.timeout(10000);

  it("loads a 4K cartridge through the 6507 reset vector", async () => {
    const emu = await createAtari();
    const rom = createRom(0x1000, [0xa9, 0x2e, 0x8d, 0x09, 0x00]);

    emu.mmu.loadBytes(emu, 0, rom, { target: "cartridge" });
    emu.cpu.reset(emu);
    emu.cpu.step(emu);
    emu.cpu.step(emu);

    assert.strictEqual(emu.cpu.name, "MOS 6507");
    assert.strictEqual(emu.cpu.registers.pc, 0xf005);
    assert.strictEqual(emu.mmu.memory.tia.registers[0x09], 0x2e);
    assert.strictEqual(emu.mmu.peekByte(emu, 0xf000), 0xa9);
    assert.strictEqual(emu.mmu.peekByte(emu, 0x1000), 0xa9);
  });

  it("mirrors RIOT RAM and maps joystick/button input as active-low bits", async () => {
    const emu = await createAtari();

    emu.mmu.writeByte(emu, 0x0080, 0x42);
    assert.strictEqual(emu.mmu.readByte(emu, 0x0180), 0x42);

    emu.cpu.setInput("left", true);
    emu.cpu.setInput("fire", true);

    assert.strictEqual((emu.mmu.readByte(emu, 0x0280) & 0x40), 0x00);
    assert.strictEqual(emu.mmu.readByte(emu, 0x000c), 0x00);
  });

  it("maps Atari P1 to WASD and Space, and P2 to arrows and Numpad0", async () => {
    const emu = await createAtari();
    const hotkeys = emu.manifest.controls.inputHotkeys;
    const keyboardGroups = emu.manifest.controls.keyboardGroups;

    assert.deepStrictEqual(keyboardGroups, [
      { id: "wsad", label: "P1 WSAD" },
      { id: "arrows", label: "P2 Arrow Keys" },
    ]);
    assert.deepStrictEqual({
      up: hotkeys.up,
      down: hotkeys.down,
      left: hotkeys.left,
      right: hotkeys.right,
      fire: hotkeys.fire,
      p1up: hotkeys.p1up,
      p1down: hotkeys.p1down,
      p1left: hotkeys.p1left,
      p1right: hotkeys.p1right,
      p1fire: hotkeys.p1fire,
    }, {
      up: "KeyW",
      down: "KeyS",
      left: "KeyA",
      right: "KeyD",
      fire: "Space",
      p1up: "ArrowUp",
      p1down: "ArrowDown",
      p1left: "ArrowLeft",
      p1right: "ArrowRight",
      p1fire: "Numpad0",
    });

    emu.cpu.setInput("up", true);
    emu.cpu.setInput("p1right", true);
    emu.cpu.setInput("p1fire", true);

    assert.strictEqual((emu.mmu.readByte(emu, 0x0280) & 0x10), 0x00);
    assert.strictEqual((emu.mmu.readByte(emu, 0x0280) & 0x08), 0x00);
    assert.strictEqual(emu.mmu.readByte(emu, 0x000d), 0x00);
  });

  it("maps common Atari console switch aliases", async () => {
    const emu = await createAtari();

    emu.cpu.setInput("start1", true);
    emu.cpu.setInput("start2", true);

    assert.strictEqual((emu.mmu.readByte(emu, 0x0282) & 0x01), 0x00);
    assert.strictEqual((emu.mmu.readByte(emu, 0x0282) & 0x02), 0x00);
  });

  it("runs the RIOT interval timer at CPU-cycle intervals", async () => {
    const emu = await createAtari();

    emu.mmu.writeByte(emu, 0x0294, 0x03);
    assert.strictEqual(emu.mmu.readByte(emu, 0x0284), 0x02);
    emu.mmu.tick(emu, 2);
    assert.strictEqual(emu.mmu.readByte(emu, 0x0284), 0x00);
    assert.strictEqual(emu.mmu.readByte(emu, 0x0285), 0x00);

    emu.mmu.tick(emu, 1);
    assert.strictEqual(emu.mmu.readByte(emu, 0x0285), 0xc0);
    assert.strictEqual(emu.mmu.readByte(emu, 0x0285), 0x80);
    emu.mmu.writeByte(emu, 0x0294, 0x01);
    assert.strictEqual(emu.mmu.readByte(emu, 0x0285), 0x00);
  });

  it("switches common 4K cartridge banks through F8 and F6 hotspots", async () => {
    const emu = await createAtari();
    const f8 = createRom(0x2000);
    f8[0x0000] = 0xa0;
    f8[0x1000] = 0xb0;

    emu.mmu.loadBytes(emu, 0, f8, { target: "cartridge" });
    assert.deepStrictEqual(emu.mmu.getCartridgeState(), {
      cartridgeSize: 0x2000,
      cartridgeRamSize: 0,
      bankSize: 0x1000,
      bankCount: 2,
      currentBank: 1,
      bankingMode: "F8",
    });
    assert.strictEqual(emu.mmu.peekByte(emu, 0xf000), 0xb0);
    emu.mmu.readByte(emu, 0xfff8);
    assert.strictEqual(emu.mmu.peekByte(emu, 0xf000), 0xa0);
    emu.mmu.readByte(emu, 0xfff9);
    assert.strictEqual(emu.mmu.peekByte(emu, 0xf000), 0xb0);

    const f6 = createRom(0x4000);
    f6[0x0000] = 0x10;
    f6[0x1000] = 0x20;
    f6[0x2000] = 0x30;
    f6[0x3000] = 0x40;
    emu.mmu.loadBytes(emu, 0, f6, { target: "cartridge" });
    emu.mmu.readByte(emu, 0xfff6);
    assert.strictEqual(emu.mmu.peekByte(emu, 0xf000), 0x10);
    emu.mmu.readByte(emu, 0xfff9);
    assert.strictEqual(emu.mmu.peekByte(emu, 0xf000), 0x40);

    const fourK = createRom(0x1000);
    fourK[0x0000] = 0x55;
    emu.mmu.loadBytes(emu, 0, fourK, { target: "cartridge" });
    assert.strictEqual(emu.mmu.getCartridgeState().bankCount, 1);
    assert.strictEqual(emu.mmu.peekByte(emu, 0xf000), 0x55);
  });

  it("maps Superchip cartridge RAM for padded bank-switched cartridges", async () => {
    const emu = await createAtari();
    const rom = createRom(0x2000);
    for (let bank = 0; bank < 2; bank += 1) rom.fill(0x00, bank * 0x1000, bank * 0x1000 + 0x100);
    rom[0x0100] = 0x66;
    rom[0x1100] = 0x77;

    emu.mmu.loadBytes(emu, 0, rom, { target: "cartridge" });

    assert.strictEqual(emu.mmu.getCartridgeState().cartridgeRamSize, 0x80);
    assert.strictEqual(emu.mmu.readByte(emu, 0xf080), 0x00);
    emu.mmu.writeByte(emu, 0xf000, 0x5a);
    assert.strictEqual(emu.mmu.readByte(emu, 0xf080), 0x5a);
    assert.strictEqual(emu.mmu.peekByte(emu, 0xf100), 0x77);
    emu.mmu.readByte(emu, 0xfff8);
    assert.strictEqual(emu.mmu.readByte(emu, 0xf080), 0x5a);
    assert.strictEqual(emu.mmu.peekByte(emu, 0xf100), 0x66);
  });

  it("honors explicit F8SC mapping for 16K overdumped cartridges", async () => {
    const emu = await createAtari();
    const rom = createRom(0x4000);
    for (let bank = 0; bank < 4; bank += 1) rom.fill(0x00, bank * 0x1000, bank * 0x1000 + 0x100);
    rom[0x0100] = 0x11;
    rom[0x1100] = 0x22;
    rom[0x2100] = 0x33;
    rom[0x3100] = 0x44;

    emu.mmu.loadBytes(emu, 0, rom, { target: "cartridge", mapper: "F8SC" });

    assert.deepStrictEqual(emu.mmu.getCartridgeState(), {
      cartridgeSize: 0x2000,
      cartridgeRamSize: 0x80,
      bankSize: 0x1000,
      bankCount: 2,
      currentBank: 1,
      bankingMode: "F8",
    });
    assert.strictEqual(emu.mmu.peekByte(emu, 0xf100), 0x22);
    emu.mmu.readByte(emu, 0xfff8);
    assert.strictEqual(emu.mmu.peekByte(emu, 0xf100), 0x11);
  });

  it("auto-detects F8SC mapping for padded 16K overdumped cartridges", async () => {
    const emu = await createAtari();
    const rom = createRom(0x4000);
    for (let bank = 0; bank < 4; bank += 1) rom.fill(0x00, bank * 0x1000, bank * 0x1000 + 0x100);
    rom[0x0100] = 0x11;
    rom[0x1100] = 0x22;
    rom[0x2100] = 0x33;
    rom[0x2ffc] = 0x03;
    rom[0x2ffd] = 0xd1;
    rom.set(rom.subarray(0x1000, 0x2000), 0x3000);

    emu.mmu.loadBytes(emu, 0, rom, { target: "cartridge" });

    assert.deepStrictEqual(emu.mmu.getCartridgeState(), {
      cartridgeSize: 0x2000,
      cartridgeRamSize: 0x80,
      bankSize: 0x1000,
      bankCount: 2,
      currentBank: 1,
      bankingMode: "F8",
    });
    assert.strictEqual(emu.mmu.peekByte(emu, 0xf100), 0x22);
    emu.mmu.readByte(emu, 0xfff8);
    assert.strictEqual(emu.mmu.peekByte(emu, 0xf100), 0x11);
  });

  it("renders coarse TIA playfield pixels into the frame buffer", async () => {
    const emu = await createAtari();
    const imageData = createImageData(emu);
    const screenCtx = {
      putImageData(data) {
        this.lastImageData = data;
      },
    };

    emu.mmu.writeByte(emu, 0x0008, 0x3e);
    emu.mmu.writeByte(emu, 0x000d, 0xf0);
    emu.mmu.writeByte(emu, 0x000e, 0xff);
    emu.mmu.writeByte(emu, 0x000f, 0xff);
    emu.mmu.writeByte(emu, 0x0001, 0x00);
    emu.mmu.tick(emu, 76);
    renderAtariFrame({ emu, screenCtx, imageData });

    assert.strictEqual(screenCtx.lastImageData, imageData);
    assert.strictEqual(imageData.data[3], 255);
    assert.notDeepStrictEqual(pixelAt(imageData, 0), [20, 20, 20]);
    assert.notDeepStrictEqual(pixelAt(imageData, 4), [20, 20, 20]);
  });

  it("applies the calibrated playfield phase without blanking the leading playfield bit", async () => {
    const emu = await createAtari();
    const imageData = createImageData(emu);
    const screenCtx = { putImageData(data) { this.lastImageData = data; } };

    emu.mmu.writeByte(emu, 0x0008, 0x3e);
    emu.mmu.writeByte(emu, 0x000d, 0x20);
    emu.mmu.writeByte(emu, 0x0001, 0x00);
    emu.mmu.tick(emu, 76);
    renderAtariFrame({ emu, screenCtx, imageData });

    assert.deepStrictEqual(pixelAt(imageData, 0), [20, 20, 20]);
    assert.notDeepStrictEqual(pixelAt(imageData, 1), [20, 20, 20]);
    assert.notDeepStrictEqual(pixelAt(imageData, 4), [20, 20, 20]);
    assert.deepStrictEqual(pixelAt(imageData, 5), [20, 20, 20]);
  });

  it("latches TIA collisions as visible pixels are drawn", async () => {
    const emu = await createAtari();

    emu.mmu.writeByte(emu, 0x0006, 0xc6);
    emu.mmu.writeByte(emu, 0x0008, 0x3e);
    emu.mmu.writeByte(emu, 0x000d, 0xf0);
    emu.mmu.writeByte(emu, 0x001b, 0xff);
    emu.mmu.writeByte(emu, 0x0001, 0x00);
    emu.mmu.tick(emu, 23);

    assert.strictEqual(emu.mmu.readByte(emu, 0x0002) & 0x80, 0x80);
  });

  it("presents the last completed TIA frame without clearing it mid-frame", async () => {
    const emu = await createAtari();
    const imageData = createImageData(emu);
    const screenCtx = { putImageData(data) { this.lastImageData = data; } };

    emu.mmu.writeByte(emu, 0x0008, 0xc6);
    emu.mmu.writeByte(emu, 0x000d, 0xf0);
    emu.mmu.writeByte(emu, 0x000e, 0xff);
    emu.mmu.writeByte(emu, 0x000f, 0xff);
    emu.mmu.writeByte(emu, 0x0001, 0x00);
    emu.mmu.tick(emu, 76 * 192);
    emu.mmu.writeByte(emu, 0x0000, 0x02);

    renderAtariFrame({ emu, screenCtx, imageData });

    assert.strictEqual(emu.mmu.memory.tia.getDebugState().framesCompleted, 1);
    assert.strictEqual(emu.mmu.memory.tia.getDebugState().displayFramesCompleted, 1);
    assert.strictEqual(screenCtx.lastImageData, imageData);
    assert.strictEqual(imageData.data[3], 255);
    assert.notDeepStrictEqual(Array.from(imageData.data.slice(0, 3)), [0, 0, 0]);
  });

  it("does not publish partial TIA frames as completed display frames", async () => {
    const emu = await createAtari();

    emu.mmu.writeByte(emu, 0x0001, 0x00);
    emu.mmu.tick(emu, 76);
    emu.mmu.writeByte(emu, 0x0000, 0x02);

    const tia = emu.mmu.memory.tia.getDebugState();
    assert.strictEqual(tia.framesCompleted, 1);
    assert.strictEqual(tia.displayFramesCompleted, 0);
  });

  it("publishes substantial shorter TIA fields as display frames", async () => {
    const emu = await createAtari();
    const substantialLines = Math.ceil(emu.manifest.video.height * 0.8);

    emu.mmu.writeByte(emu, 0x0001, 0x00);
    emu.mmu.tick(emu, 76 * substantialLines);
    emu.mmu.writeByte(emu, 0x0000, 0x02);

    const tia = emu.mmu.memory.tia.getDebugState();
    assert.strictEqual(tia.framesCompleted, 1);
    assert.strictEqual(tia.displayFramesCompleted, 1);
  });

  it("applies playfield register changes at their scanline beam position", async () => {
    const emu = await createAtari();
    const imageData = createImageData(emu);
    const screenCtx = { putImageData(data) { this.lastImageData = data; } };

    emu.mmu.writeByte(emu, 0x0008, 0x3e);
    emu.mmu.writeByte(emu, 0x000f, 0x00);
    emu.mmu.writeByte(emu, 0x0001, 0x00);
    emu.mmu.tick(emu, 36);
    emu.mmu.writeByte(emu, 0x000f, 0xff);
    emu.mmu.tick(emu, 40);
    renderAtariFrame({ emu, screenCtx, imageData });

    assert.deepStrictEqual(pixelAt(imageData, 45), [20, 20, 20]);
    assert.notDeepStrictEqual(pixelAt(imageData, 46), pixelAt(imageData, 20));
  });

  it("applies player position resets at their scanline beam position", async () => {
    const emu = await createAtari();
    const imageData = createImageData(emu);
    const screenCtx = { putImageData(data) { this.lastImageData = data; } };

    emu.mmu.writeByte(emu, 0x0006, 0xc6);
    emu.mmu.writeByte(emu, 0x0001, 0x00);
    emu.mmu.tick(emu, 36);
    emu.mmu.writeByte(emu, 0x0010, 0x00);
    emu.mmu.writeByte(emu, 0x001b, 0xff);
    emu.mmu.tick(emu, 40);
    renderAtariFrame({ emu, screenCtx, imageData });

    assert.deepStrictEqual(pixelAt(imageData, 20), [20, 20, 20]);
    assert.notDeepStrictEqual(pixelAt(imageData, 45), [20, 20, 20]);
  });

  it("draws playfield priority above players only when CTRLPF priority is set", async () => {
    const renderPriorityPixel = async (ctrlpf) => {
      const emu = await createAtari();
      const imageData = createImageData(emu);
      const screenCtx = { putImageData(data) { this.lastImageData = data; } };

      emu.mmu.writeByte(emu, 0x0006, 0xc6);
      emu.mmu.writeByte(emu, 0x0008, 0x3e);
      emu.mmu.writeByte(emu, 0x000a, ctrlpf);
      emu.mmu.writeByte(emu, 0x000d, 0xf0);
      emu.mmu.writeByte(emu, 0x000e, 0xff);
      emu.mmu.writeByte(emu, 0x000f, 0xff);
      emu.mmu.writeByte(emu, 0x001b, 0xff);
      emu.mmu.writeByte(emu, 0x0001, 0x00);
      emu.mmu.tick(emu, 76);
      renderAtariFrame({ emu, screenCtx, imageData });
      return pixelAt(imageData, 4);
    };

    const normal = await renderPriorityPixel(0x00);
    const playfieldPriority = await renderPriorityPixel(0x04);

    assert.notDeepStrictEqual(normal, playfieldPriority);
  });

  it("hides missiles while RESMP locks them to their player", async () => {
    const emu = await createAtari();
    const imageData = createImageData(emu);
    const screenCtx = { putImageData(data) { this.lastImageData = data; } };

    emu.mmu.writeByte(emu, 0x0006, 0xc6);
    emu.mmu.writeByte(emu, 0x001d, 0x02);
    emu.mmu.writeByte(emu, 0x0028, 0x02);
    emu.mmu.writeByte(emu, 0x0001, 0x00);
    emu.mmu.tick(emu, 76);
    renderAtariFrame({ emu, screenCtx, imageData });

    assert.deepStrictEqual(pixelAt(imageData, 3), [20, 20, 20]);
  });

  it("uses vertical-delay latches for player graphics", async () => {
    const emu = await createAtari();
    const imageData = createImageData(emu);
    const screenCtx = { putImageData(data) { this.lastImageData = data; } };

    emu.mmu.writeByte(emu, 0x0006, 0xc6);
    emu.mmu.writeByte(emu, 0x0025, 0x01);
    emu.mmu.writeByte(emu, 0x001b, 0xff);
    emu.mmu.writeByte(emu, 0x0001, 0x00);
    emu.mmu.tick(emu, 76);
    emu.mmu.writeByte(emu, 0x001c, 0x00);
    emu.mmu.tick(emu, 76);
    renderAtariFrame({ emu, screenCtx, imageData });

    assert.deepStrictEqual(pixelAt(imageData, 0, 0), [20, 20, 20]);
    assert.notDeepStrictEqual(pixelAt(imageData, 0, 1), [20, 20, 20]);
  });

  it("applies TIA horizontal motion with positive values moving left", async () => {
    const emu = await createAtari();

    emu.mmu.tick(emu, 36);
    emu.mmu.writeByte(emu, 0x0010, 0x00);
    assert.strictEqual(emu.mmu.memory.tia.getDebugState().positions.p0, 45);

    emu.mmu.writeByte(emu, 0x0020, 0x10);
    emu.mmu.writeByte(emu, 0x002a, 0x00);
    assert.strictEqual(emu.mmu.memory.tia.getDebugState().positions.p0, 44);

    emu.mmu.writeByte(emu, 0x0020, 0xf0);
    emu.mmu.writeByte(emu, 0x002a, 0x00);
    assert.strictEqual(emu.mmu.memory.tia.getDebugState().positions.p0, 45);
  });

  it("uses TIA visible reset counter offsets for ball and missiles", async () => {
    const emu = await createAtari();

    emu.mmu.tick(emu, 36);
    emu.mmu.writeByte(emu, 0x0014, 0x00);
    emu.mmu.writeByte(emu, 0x0012, 0x00);

    const positions = emu.mmu.memory.tia.getDebugState().positions;
    assert.strictEqual(positions.bl, 45);
    assert.strictEqual(positions.m0, 45);
  });

  it("renders HMOVE blanking as visible black pixels", async () => {
    const emu = await createAtari();
    const imageData = createImageData(emu);
    const screenCtx = { putImageData(data) { this.lastImageData = data; } };

    emu.mmu.writeByte(emu, 0x0009, 0x3e);
    emu.mmu.writeByte(emu, 0x0001, 0x00);
    emu.mmu.writeByte(emu, 0x002a, 0x00);
    emu.mmu.tick(emu, 76);
    renderAtariFrame({ emu, screenCtx, imageData });

    assert.deepStrictEqual(Array.from(imageData.data.slice(0, 3)), [0, 0, 0]);
  });

  it("tracks TIA audio register writes", async () => {
    const emu = await createAtari();

    emu.mmu.writeByte(emu, 0x0015, 0x04);
    emu.mmu.writeByte(emu, 0x0017, 0x1f);
    emu.mmu.writeByte(emu, 0x0019, 0x0f);

    assert.deepStrictEqual(emu.audio.getDebugState()[0], {
      control: 0x04,
      frequency: 0x1f,
      volume: 0x0f,
    });
  });

  it("exposes Atari audio channel controls and debugger card metadata", async () => {
    const emu = await createAtari();

    assert.deepStrictEqual(emu.audio.getControls(), [
      { id: "channel0", label: "Channel 0", enabled: true },
      { id: "channel1", label: "Channel 1", enabled: true },
    ]);

    emu.audio.setControlEnabled("channel0", false);
    assert.deepStrictEqual(emu.audio.getControls(), [
      { id: "channel0", label: "Channel 0", enabled: false },
      { id: "channel1", label: "Channel 1", enabled: true },
    ]);
    assert.deepStrictEqual(emu.manifest.debuggerCards, [
      { id: "atari-audio", title: "Audio", module: "./debugger/atari2600-audio-card.js", columns: 5, rows: 3 },
    ]);
    assert.ok(emu.manifest.debuggerLayout.cards.some((card) => card.id === "atari-audio"));
  });

  it("stops Atari TIA audio sources when suspended", async () => {
    const originalAudioContext = globalThis.AudioContext;
    const originalWebkitAudioContext = globalThis.webkitAudioContext;
    const sources = [];

    class FakeAudioParam {
      constructor(value = 0) { this.value = value; }
      setTargetAtTime(value) { this.value = value; }
    }

    class FakeAudioContext {
      constructor() {
        this.currentTime = 0;
        this.destination = {};
        this.sampleRate = 44100;
        this.state = "running";
      }

      createGain() {
        return { gain: new FakeAudioParam(), connect() {} };
      }

      createOscillator() {
        const source = {
          type: "square",
          frequency: new FakeAudioParam(),
          connect() {},
          start() { this.started = true; },
          stop() { this.stopped = true; },
        };
        sources.push(source);
        return source;
      }

      createBufferSource() {
        const source = {
          playbackRate: new FakeAudioParam(1),
          connect() {},
          start() { this.started = true; },
          stop() { this.stopped = true; },
        };
        sources.push(source);
        return source;
      }

      createBuffer(_channels, length) {
        return { getChannelData: () => new Float32Array(length) };
      }

      async resume() {
        this.state = "running";
      }

      async suspend() {
        this.state = "suspended";
      }
    }

    globalThis.AudioContext = FakeAudioContext;
    globalThis.webkitAudioContext = undefined;
    try {
      const audio = createAtari2600TIAAudio();
      audio.writeRegister(0x15, 0x04);
      audio.writeRegister(0x19, 0x0f);

      assert.ok(sources.some((source) => source.started && !source.stopped));
      await audio.suspend();
      assert.ok(sources.every((source) => source.stopped));
    } finally {
      globalThis.AudioContext = originalAudioContext;
      globalThis.webkitAudioContext = originalWebkitAudioContext;
    }
  });

  it("peeks TIA registers without invoking side-effecting reads", async () => {
    const emu = await createAtari();
    const originalRead = emu.mmu.memory.tia.read;

    emu.mmu.memory.tia.read = () => {
      throw new Error("TIA read should not be used for peeks");
    };

    try {
      assert.strictEqual(emu.mmu.peekByte(emu, 0x0002), 0x00);
      assert.strictEqual(emu.mmu.peekByte(emu, 0x000c), 0x80);
    } finally {
      emu.mmu.memory.tia.read = originalRead;
    }
  });

  it("executes stable unofficial 6502 opcodes used by some cartridges", async () => {
    const emu = await createAtari();
    const rom = createRom(0x1000, [
      0xa9, 0x02,       // LDA #$02
      0x85, 0x80,       // STA $80
      0xa9, 0x40,       // LDA #$40
      0xa2, 0x00,       // LDX #$00
      0x18,             // CLC
      0x7f, 0x80, 0x00, // RRA $0080,X
    ]);

    emu.mmu.loadBytes(emu, 0, rom, { target: "cartridge" });
    emu.cpu.reset(emu);
    for (let i = 0; i < 6; i += 1) emu.cpu.step(emu);

    assert.strictEqual(emu.mmu.readByte(emu, 0x0080), 0x01);
    assert.strictEqual(emu.cpu.registers.a, 0x41);
    assert.strictEqual(emu.cpu.getDebugState().halted, false);
  });

  it("runs the 6507 by an Atari frame cycle slice", async () => {
    const emu = await createAtari();
    const rom = createRom(0x1000);
    emu.mmu.loadBytes(emu, 0, rom, { target: "cartridge" });
    emu.cpu.reset(emu);

    const result = emu.cpu.runUntilInterrupt(emu);

    assert.strictEqual(result.halted, false);
    assert.ok(result.cycles >= emu.manifest.cpu.cyclesPerRun);
    assert.ok(result.cycles < emu.manifest.cpu.cyclesPerRun + 8);
    assert.ok(result.instructions < 6000);
  });
});
