const BUS_MASK = 0x1fff;
const ADDRESS_SPACE_SIZE = 0x2000;
const RIOT_RAM_SIZE = 0x80;
const TIA_REGISTER_COUNT = 0x40;
const SCREEN_WIDTH = 160;
const SCREEN_HEIGHT = 192;
const CYCLES_PER_SCANLINE = 76;
const COLOR_CLOCKS_PER_CPU_CYCLE = 3;
const COLOR_CLOCKS_PER_SCANLINE = CYCLES_PER_SCANLINE * COLOR_CLOCKS_PER_CPU_CYCLE;
const SCANLINES_PER_FRAME = 262;
const MIN_DISPLAY_FRAME_COVERAGE = 0.75;
const PLAYFIELD_HORIZONTAL_OFFSET = -3;

const TIA_WRITE = Object.freeze({
  VSYNC: 0x00,
  VBLANK: 0x01,
  WSYNC: 0x02,
  RSYNC: 0x03,
  NUSIZ0: 0x04,
  NUSIZ1: 0x05,
  COLUP0: 0x06,
  COLUP1: 0x07,
  COLUPF: 0x08,
  COLUBK: 0x09,
  CTRLPF: 0x0a,
  REFP0: 0x0b,
  REFP1: 0x0c,
  PF0: 0x0d,
  PF1: 0x0e,
  PF2: 0x0f,
  RESP0: 0x10,
  RESP1: 0x11,
  RESM0: 0x12,
  RESM1: 0x13,
  RESBL: 0x14,
  AUDC0: 0x15,
  AUDC1: 0x16,
  AUDF0: 0x17,
  AUDF1: 0x18,
  AUDV0: 0x19,
  AUDV1: 0x1a,
  GRP0: 0x1b,
  GRP1: 0x1c,
  ENAM0: 0x1d,
  ENAM1: 0x1e,
  ENABL: 0x1f,
  HMP0: 0x20,
  HMP1: 0x21,
  HMM0: 0x22,
  HMM1: 0x23,
  HMBL: 0x24,
  VDELP0: 0x25,
  VDELP1: 0x26,
  VDELBL: 0x27,
  RESMP0: 0x28,
  RESMP1: 0x29,
  HMOVE: 0x2a,
  HMCLR: 0x2b,
  CXCLR: 0x2c,
});

const RIOT = Object.freeze({
  SWCHA: 0x00,
  SWACNT: 0x01,
  SWCHB: 0x02,
  SWBCNT: 0x03,
  INTIM: 0x04,
  INSTAT: 0x05,
  TIM1T: 0x14,
  TIM8T: 0x15,
  TIM64T: 0x16,
  T1024T: 0x17,
});

const u8 = (value) => value & 0xff;
const u13 = (value) => value & BUS_MASK;
const bytesToArray = (bytes) => Array.from(bytes ?? []);
const restoreBytes = (target, source, fill = 0) => {
  target.fill(fill);
  if (source == null) return;
  const bytes = source instanceof Uint8Array ? source : Uint8Array.from(source);
  target.set(bytes.subarray(0, target.length));
};
const normalizeMapperName = (mapper) => String(mapper ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const byteArrayFrom = (bytes) => (bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes ?? []));

const bankEquals = (data, leftBank, rightBank, bankSize = 0x1000) => {
  const leftStart = leftBank * bankSize;
  const rightStart = rightBank * bankSize;
  if (leftStart + bankSize > data.length || rightStart + bankSize > data.length) return false;
  for (let i = 0; i < bankSize; i += 1) {
    if (data[leftStart + i] !== data[rightStart + i]) return false;
  }
  return true;
};

const bankPrefixIsPaddingData = (data, bank, prefixSize = 0x100, bankSize = 0x1000) => {
  const start = bank * bankSize;
  const end = start + prefixSize;
  if (end > data.length) return false;
  for (let i = start; i < end; i += 1) {
    const value = data[i] ?? 0xff;
    if (value !== 0x00 && value !== 0xff) return false;
  }
  return true;
};

const bankResetVector = (data, bank, bankSize = 0x1000) => {
  const vector = bank * bankSize + 0x0ffc;
  if (vector + 1 >= data.length) return 0x0000;
  return (data[vector] ?? 0x00) | ((data[vector + 1] ?? 0x00) << 8);
};

const vectorLooksCartridgeMapped = (vector) => vector >= 0xf000 && vector <= 0xffff;

const looksLikeF8SCOverdump = (data) => {
  if (data.length !== 0x4000) return false;
  if (!bankEquals(data, 1, 3)) return false;
  for (let bank = 0; bank < 4; bank += 1) {
    if (!bankPrefixIsPaddingData(data, bank)) return false;
  }

  const reset0 = bankResetVector(data, 0);
  const reset1 = bankResetVector(data, 1);
  const reset2 = bankResetVector(data, 2);
  const reset3 = bankResetVector(data, 3);
  return vectorLooksCartridgeMapped(reset0)
    && vectorLooksCartridgeMapped(reset1)
    && vectorLooksCartridgeMapped(reset3)
    && !vectorLooksCartridgeMapped(reset2);
};

const hslToRgb = (hue, saturation, lightness) => {
  const s = Math.max(0, Math.min(1, saturation / 100));
  const l = Math.max(0, Math.min(1, lightness / 100));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((hue % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
      : hp < 3 ? [0, c, x]
        : hp < 4 ? [0, x, c]
          : hp < 5 ? [x, 0, c]
            : [c, 0, x];
  const m = l - c / 2;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
};

const createNtscPalette = () => {
  const hues = [0, 38, 25, 14, 350, 323, 292, 260, 223, 199, 171, 145, 104, 82, 62, 48];
  const palette = [];
  for (let value = 0; value < 0x100; value += 1) {
    const color = (value >> 4) & 0x0f;
    const lum = (value >> 1) & 0x07;
    const lightness = 8 + lum * 10.8;
    palette[value] = color === 0
      ? [Math.round(lightness * 2.55), Math.round(lightness * 2.55), Math.round(lightness * 2.55)]
      : hslToRgb(hues[color], 76, lightness + 5);
  }
  return palette;
};

const PALETTE = createNtscPalette();

const colorFor = (value) => PALETTE[value & 0xfe] ?? PALETTE[0];
const normalizeX = (value) => {
  const next = Math.round(Number(value) || 0) % SCREEN_WIDTH;
  return next < 0 ? next + SCREEN_WIDTH : next;
};

const inWrappedRange = (x, start, width) => {
  const normalizedStart = normalizeX(start);
  return ((x - normalizedStart + SCREEN_WIDTH) % SCREEN_WIDTH) < width;
};

const motionValue = (value) => {
  const nibble = (value >> 4) & 0x0f;
  return nibble < 8 ? nibble : nibble - 16;
};

const playerCopies = (nusiz) => {
  switch (nusiz & 0x07) {
    case 0x01: return { scale: 1, offsets: [0, 16] };
    case 0x02: return { scale: 1, offsets: [0, 32] };
    case 0x03: return { scale: 1, offsets: [0, 16, 32] };
    case 0x04: return { scale: 1, offsets: [0, 64] };
    case 0x05: return { scale: 2, offsets: [0] };
    case 0x06: return { scale: 1, offsets: [0, 32, 64] };
    case 0x07: return { scale: 4, offsets: [0] };
    default: return { scale: 1, offsets: [0] };
  }
};

const missileWidth = (nusiz) => 1 << ((nusiz >> 4) & 0x03);
const ballWidth = (ctrlpf) => 1 << ((ctrlpf >> 4) & 0x03);
const clonePositions = (positions) => ({
  p0: positions.p0,
  p1: positions.p1,
  m0: positions.m0,
  m1: positions.m1,
  bl: positions.bl,
});
const copyPositions = (target, source) => {
  target.p0 = source.p0;
  target.p1 = source.p1;
  target.m0 = source.m0;
  target.m1 = source.m1;
  target.bl = source.bl;
};
const missileLockOffset = (nusiz) => {
  const scale = playerCopies(nusiz).scale;
  if (scale === 2) return 6;
  if (scale === 4) return 10;
  return 3;
};
const SCANLINE_TIMED_REGISTERS = new Set([
  TIA_WRITE.NUSIZ0,
  TIA_WRITE.NUSIZ1,
  TIA_WRITE.COLUP0,
  TIA_WRITE.COLUP1,
  TIA_WRITE.COLUPF,
  TIA_WRITE.COLUBK,
  TIA_WRITE.CTRLPF,
  TIA_WRITE.REFP0,
  TIA_WRITE.REFP1,
  TIA_WRITE.PF0,
  TIA_WRITE.PF1,
  TIA_WRITE.PF2,
  TIA_WRITE.GRP0,
  TIA_WRITE.GRP1,
  TIA_WRITE.ENAM0,
  TIA_WRITE.ENAM1,
  TIA_WRITE.ENABL,
  TIA_WRITE.VDELP0,
  TIA_WRITE.VDELP1,
  TIA_WRITE.VDELBL,
  TIA_WRITE.RESMP0,
  TIA_WRITE.RESMP1,
]);

const TIA_REGISTER_DELAY_CLOCKS = new Map([
  [TIA_WRITE.CTRLPF, 6],
  [TIA_WRITE.PF0, 6],
  [TIA_WRITE.PF1, 6],
  [TIA_WRITE.PF2, 6],
  [TIA_WRITE.REFP0, 1],
  [TIA_WRITE.REFP1, 1],
  [TIA_WRITE.GRP0, 1],
  [TIA_WRITE.GRP1, 1],
  [TIA_WRITE.ENAM0, 1],
  [TIA_WRITE.ENAM1, 1],
  [TIA_WRITE.ENABL, 1],
]);

const TIA_WRITE_CYCLE_OFFSET_BY_OPCODE = new Map([
  [0x81, 5], [0x85, 2], [0x8d, 3], [0x91, 5], [0x95, 3], [0x99, 4], [0x9d, 4],
  [0x86, 2], [0x8e, 3], [0x96, 3],
  [0x84, 2], [0x8c, 3], [0x94, 3],
  [0x83, 5], [0x87, 2], [0x8f, 3], [0x97, 3],
  [0x06, 4], [0x0e, 5], [0x16, 5], [0x1e, 6],
  [0x26, 4], [0x2e, 5], [0x36, 5], [0x3e, 6],
  [0x46, 4], [0x4e, 5], [0x56, 5], [0x5e, 6],
  [0x66, 4], [0x6e, 5], [0x76, 5], [0x7e, 6],
  [0xc6, 4], [0xce, 5], [0xd6, 5], [0xde, 6],
  [0xe6, 4], [0xee, 5], [0xf6, 5], [0xfe, 6],
]);

const TIA_WRITE_INSTRUCTION_CYCLES_BY_OPCODE = new Map([
  [0x81, 6], [0x85, 3], [0x8d, 4], [0x91, 6], [0x95, 4], [0x99, 5], [0x9d, 5],
  [0x86, 3], [0x8e, 4], [0x96, 4],
  [0x84, 3], [0x8c, 4], [0x94, 4],
  [0x83, 6], [0x87, 3], [0x8f, 4], [0x97, 4],
  [0x06, 5], [0x0e, 6], [0x16, 6], [0x1e, 7],
  [0x26, 5], [0x2e, 6], [0x36, 6], [0x3e, 7],
  [0x46, 5], [0x4e, 6], [0x56, 6], [0x5e, 7],
  [0x66, 5], [0x6e, 6], [0x76, 6], [0x7e, 7],
  [0xc6, 5], [0xce, 6], [0xd6, 6], [0xde, 7],
  [0xe6, 5], [0xee, 6], [0xf6, 6], [0xfe, 7],
]);

const TIA_READ_CYCLE_OFFSET_BY_OPCODE = new Map([
  [0x01, 5], [0x05, 2], [0x0d, 3], [0x11, 5], [0x15, 3], [0x19, 3], [0x1d, 3],
  [0x21, 5], [0x24, 2], [0x25, 2], [0x2c, 3], [0x2d, 3], [0x31, 5], [0x35, 3], [0x39, 3], [0x3d, 3],
  [0x41, 5], [0x45, 2], [0x4d, 3], [0x51, 5], [0x55, 3], [0x59, 3], [0x5d, 3],
  [0x61, 5], [0x65, 2], [0x6d, 3], [0x71, 5], [0x75, 3], [0x79, 3], [0x7d, 3],
  [0xa1, 5], [0xa5, 2], [0xad, 3], [0xb1, 5], [0xb5, 3], [0xb9, 3], [0xbd, 3],
  [0xc1, 5], [0xc4, 2], [0xc5, 2], [0xcc, 3], [0xcd, 3], [0xd1, 5], [0xd5, 3], [0xd9, 3], [0xdd, 3],
  [0xe1, 5], [0xe4, 2], [0xe5, 2], [0xec, 3], [0xed, 3], [0xf1, 5], [0xf5, 3], [0xf9, 3], [0xfd, 3],
]);

const createTIA = (config = {}) => {
  const width = Number(config.width) || SCREEN_WIDTH;
  const height = Number(config.height) || SCREEN_HEIGHT;
  const registers = new Uint8Array(TIA_REGISTER_COUNT);
  const lineStartRegisters = new Uint8Array(TIA_REGISTER_COUNT);
  const collisions = new Uint8Array(8);
  const frame = new Uint8ClampedArray(width * height * 4);
  const displayFrame = new Uint8ClampedArray(width * height * 4);
  const lineEvents = [];
  const positions = { p0: 0, p1: 0, m0: 0, m1: 0, bl: 0 };
  const lineStartPositions = { p0: 0, p1: 0, m0: 0, m1: 0, bl: 0 };
  const playerGraphics = new Uint8Array(2);
  const delayedPlayerGraphics = new Uint8Array(2);
  const lineStartPlayerGraphics = new Uint8Array(2);
  const lineStartDelayedPlayerGraphics = new Uint8Array(2);
  let ballEnable = 0;
  let delayedBallEnable = 0;
  let lineStartBallEnable = 0;
  let lineStartDelayedBallEnable = 0;
  let hmoveBlankUntil = 0;
  let lineStartHmoveBlankUntil = 0;
  let cycleInLine = 0;
  let scanline = 0;
  let pictureLine = 0;
  let vsync = false;
  let vblank = true;
  let lastRenderedLine = -1;
  let renderedXInLine = 0;
  let framesCompleted = 0;
  let displayFramesCompleted = 0;

  const fillFrame = (target, rgb = [0, 0, 0]) => {
    for (let i = 0; i < target.length; i += 4) {
      target[i] = rgb[0];
      target[i + 1] = rgb[1];
      target[i + 2] = rgb[2];
      target[i + 3] = 255;
    }
  };

  const reset = () => {
    registers.fill(0);
    lineStartRegisters.fill(0);
    collisions.fill(0);
    lineEvents.length = 0;
    Object.assign(positions, { p0: 0, p1: 0, m0: 0, m1: 0, bl: 0 });
    copyPositions(lineStartPositions, positions);
    playerGraphics.fill(0);
    delayedPlayerGraphics.fill(0);
    lineStartPlayerGraphics.fill(0);
    lineStartDelayedPlayerGraphics.fill(0);
    ballEnable = 0;
    delayedBallEnable = 0;
    lineStartBallEnable = 0;
    lineStartDelayedBallEnable = 0;
    hmoveBlankUntil = 0;
    lineStartHmoveBlankUntil = 0;
    cycleInLine = 0;
    scanline = 0;
    pictureLine = 0;
    vsync = false;
    vblank = true;
    lastRenderedLine = -1;
    renderedXInLine = 0;
    framesCompleted = 0;
    displayFramesCompleted = 0;
    fillFrame(frame, [0, 0, 0]);
    fillFrame(displayFrame, [0, 0, 0]);
  };

  const snapshotLineStart = () => {
    lineStartRegisters.set(registers);
    copyPositions(lineStartPositions, positions);
    lineStartPlayerGraphics.set(playerGraphics);
    lineStartDelayedPlayerGraphics.set(delayedPlayerGraphics);
    lineStartBallEnable = ballEnable;
    lineStartDelayedBallEnable = delayedBallEnable;
    lineStartHmoveBlankUntil = hmoveBlankUntil;
    lineEvents.length = 0;
    renderedXInLine = 0;
  };

  const syncLockedMissiles = () => {
    if ((registers[TIA_WRITE.RESMP0] & 0x02) !== 0) {
      positions.m0 = normalizeX(positions.p0 + missileLockOffset(registers[TIA_WRITE.NUSIZ0]));
    }
    if ((registers[TIA_WRITE.RESMP1] & 0x02) !== 0) {
      positions.m1 = normalizeX(positions.p1 + missileLockOffset(registers[TIA_WRITE.NUSIZ1]));
    }
  };

  const startFrame = () => {
    if (lastRenderedLine >= 0) {
      if (lastRenderedLine + 1 >= Math.ceil(height * MIN_DISPLAY_FRAME_COVERAGE)) {
        displayFrame.set(frame);
        displayFramesCompleted += 1;
      }
      framesCompleted += 1;
    }
    scanline = 0;
    pictureLine = 0;
    lastRenderedLine = -1;
    fillFrame(frame, colorFor(registers[TIA_WRITE.COLUBK]));
    snapshotLineStart();
  };

  const currentOpcode = (emu) => Number(emu?.cpu?.getDebugState?.({ historyLength: 0 })?.lastOpcode ?? -1);
  const writeCycleOffset = (emu) => TIA_WRITE_CYCLE_OFFSET_BY_OPCODE.get(currentOpcode(emu)) ?? 0;
  const readCycleOffset = (emu) => TIA_READ_CYCLE_OFFSET_BY_OPCODE.get(currentOpcode(emu)) ?? 0;
  const writeInstructionCycles = (emu) => TIA_WRITE_INSTRUCTION_CYCLES_BY_OPCODE.get(currentOpcode(emu)) ?? 0;
  const effectiveCycleInLine = (emu, delayClocks = 0) => cycleInLine + writeCycleOffset(emu) + delayClocks;
  const visibleBeamXForCycle = (cycle) => (cycle * 3) - 68;
  const visibleBeamX = (emu = null) => visibleBeamXForCycle(effectiveCycleInLine(emu) % CYCLES_PER_SCANLINE);
  const visibleRenderEndForCycle = (cycle) => Math.max(0, Math.min(width, Math.floor(visibleBeamXForCycle(cycle))));
  const lineEventX = (emu, delayColorClocks = 0) => {
    const effectiveColorClock = (cycleInLine + writeCycleOffset(emu)) * COLOR_CLOCKS_PER_CPU_CYCLE
      + Math.max(0, Number(delayColorClocks) || 0);
    if (effectiveColorClock >= COLOR_CLOCKS_PER_SCANLINE) return null;
    const x = effectiveColorClock - 68;
    if (x >= width) return null;
    return Math.max(0, Math.floor(x));
  };

  const renderThroughCycle = (cycle) => {
    if (cycle < CYCLES_PER_SCANLINE) renderScanlineUntil(visibleRenderEndForCycle(cycle));
    else renderScanlineUntil(width);
  };

  const renderThroughBeam = (emu, offset = 0) => {
    renderThroughCycle(cycleInLine + Math.max(0, Number(offset) || 0));
  };

  const recordLineEvent = (event, emu = null, delayClocks = 0) => {
    if (vsync || vblank || pictureLine < 0 || pictureLine >= height) return;
    const x = lineEventX(emu, delayClocks);
    if (x == null) return;
    lineEvents.push({ x, ...event });
  };

  const recordRegisterEvent = (reg, value, emu) => {
    if (!SCANLINE_TIMED_REGISTERS.has(reg)) return;
    recordLineEvent({ type: "register", reg, value: value & 0xff }, emu, TIA_REGISTER_DELAY_CLOCKS.get(reg) ?? 0);
  };

  const recordPositionEvent = (emu) => {
    recordLineEvent({ type: "positions", positions: clonePositions(positions) }, emu);
  };

  const recordHmoveBlankEvent = (emu) => {
    recordLineEvent({ type: "hmoveBlank", hmoveBlankUntil }, emu);
  };

  const resetObject = (key, emu) => {
    const x = visibleBeamX(emu);
    const isPlayer = key === "p0" || key === "p1";
    positions[key] = x < 0
      ? (isPlayer ? 3 : 2)
      : normalizeX(x + 5);
    if (key === "p0" || key === "p1") syncLockedMissiles();
    recordPositionEvent(emu);
  };

  const applyMotion = (emu) => {
    positions.p0 = normalizeX(positions.p0 - motionValue(registers[TIA_WRITE.HMP0]));
    positions.p1 = normalizeX(positions.p1 - motionValue(registers[TIA_WRITE.HMP1]));
    positions.m0 = normalizeX(positions.m0 - motionValue(registers[TIA_WRITE.HMM0]));
    positions.m1 = normalizeX(positions.m1 - motionValue(registers[TIA_WRITE.HMM1]));
    positions.bl = normalizeX(positions.bl - motionValue(registers[TIA_WRITE.HMBL]));
    syncLockedMissiles();
    recordPositionEvent(emu);

    if (visibleBeamX(emu) < 0) {
      hmoveBlankUntil = 8;
      recordHmoveBlankEvent(emu);
    }
  };

  const clearMotion = () => {
    registers[TIA_WRITE.HMP0] = 0;
    registers[TIA_WRITE.HMP1] = 0;
    registers[TIA_WRITE.HMM0] = 0;
    registers[TIA_WRITE.HMM1] = 0;
    registers[TIA_WRITE.HMBL] = 0;
  };

  const playfieldPixel = (x, regs = registers) => {
    const shiftedX = Math.max(0, Math.min(width - 1, x - PLAYFIELD_HORIZONTAL_OFFSET));
    let bit = Math.floor((shiftedX * 40) / width);
    if (bit >= 20) bit = (regs[TIA_WRITE.CTRLPF] & 0x01) ? 39 - bit : bit - 20;
    if (bit < 4) return (regs[TIA_WRITE.PF0] & (1 << (4 + bit))) !== 0;
    if (bit < 12) return (regs[TIA_WRITE.PF1] & (1 << (11 - bit))) !== 0;
    return (regs[TIA_WRITE.PF2] & (1 << (bit - 12))) !== 0;
  };

  const applyRegisterToRenderState = (state, reg, value) => {
    const next = value & 0xff;
    state.regs[reg] = next;

    switch (reg) {
      case TIA_WRITE.GRP0:
        state.playerGraphics[0] = next;
        state.delayedPlayerGraphics[1] = state.playerGraphics[1];
        break;
      case TIA_WRITE.GRP1:
        state.playerGraphics[1] = next;
        state.delayedPlayerGraphics[0] = state.playerGraphics[0];
        state.delayedBallEnable = state.ballEnable;
        break;
      case TIA_WRITE.ENABL:
        state.ballEnable = next;
        break;
      default:
        break;
    }
  };

  const applyRegisterToLiveState = (reg, value) => {
    const next = value & 0xff;
    registers[reg] = next;

    switch (reg) {
      case TIA_WRITE.GRP0:
        playerGraphics[0] = next;
        delayedPlayerGraphics[1] = playerGraphics[1];
        break;
      case TIA_WRITE.GRP1:
        playerGraphics[1] = next;
        delayedPlayerGraphics[0] = playerGraphics[0];
        delayedBallEnable = ballEnable;
        break;
      case TIA_WRITE.ENABL:
        ballEnable = next;
        break;
      case TIA_WRITE.NUSIZ0:
      case TIA_WRITE.NUSIZ1:
      case TIA_WRITE.RESMP0:
      case TIA_WRITE.RESMP1:
        syncLockedMissiles();
        break;
      default:
        break;
    }
  };

  const createLineRenderState = () => ({
    regs: new Uint8Array(lineStartRegisters),
    positions: clonePositions(lineStartPositions),
    playerGraphics: Uint8Array.from(lineStartPlayerGraphics),
    delayedPlayerGraphics: Uint8Array.from(lineStartDelayedPlayerGraphics),
    ballEnable: lineStartBallEnable,
    delayedBallEnable: lineStartDelayedBallEnable,
    hmoveBlankUntil: lineStartHmoveBlankUntil,
  });

  const displayedPlayerGraphics = (player, state) => (
    (state.regs[player === 0 ? TIA_WRITE.VDELP0 : TIA_WRITE.VDELP1] & 0x01) !== 0
      ? state.delayedPlayerGraphics[player]
      : state.playerGraphics[player]
  );

  const displayedBallEnable = (state) => (
    (state.regs[TIA_WRITE.VDELBL] & 0x01) !== 0 ? state.delayedBallEnable : state.ballEnable
  );

  const playerPixel = (player, x, state) => {
    const regs = state.regs;
    const nusiz = regs[player === 0 ? TIA_WRITE.NUSIZ0 : TIA_WRITE.NUSIZ1];
    const graphics = displayedPlayerGraphics(player, state);
    const reflected = (regs[player === 0 ? TIA_WRITE.REFP0 : TIA_WRITE.REFP1] & 0x08) !== 0;
    const start = player === 0 ? state.positions.p0 : state.positions.p1;
    const { scale, offsets } = playerCopies(nusiz);
    for (const offset of offsets) {
      const copyStart = normalizeX(start + offset);
      const relative = (x - copyStart + SCREEN_WIDTH) % SCREEN_WIDTH;
      if (relative >= 8 * scale) continue;
      const bitIndex = Math.floor(relative / scale);
      const bit = reflected ? bitIndex : 7 - bitIndex;
      return (graphics & (1 << bit)) !== 0;
    }
    return false;
  };

  const missilePixel = (missile, x, state) => {
    const regs = state.regs;
    if ((regs[missile === 0 ? TIA_WRITE.RESMP0 : TIA_WRITE.RESMP1] & 0x02) !== 0) return false;
    const enabled = (regs[missile === 0 ? TIA_WRITE.ENAM0 : TIA_WRITE.ENAM1] & 0x02) !== 0;
    if (!enabled) return false;
    const nusiz = regs[missile === 0 ? TIA_WRITE.NUSIZ0 : TIA_WRITE.NUSIZ1];
    const basePosition = missile === 0 ? state.positions.m0 : state.positions.m1;
    const { offsets } = playerCopies(nusiz);
    const widthPx = missileWidth(nusiz);
    return offsets.some((offset) => inWrappedRange(x, basePosition + offset, widthPx));
  };

  const ballPixel = (x, state) => {
    if ((displayedBallEnable(state) & 0x02) === 0) return false;
    return inWrappedRange(x, state.positions.bl, ballWidth(state.regs[TIA_WRITE.CTRLPF]));
  };

  const setCollision = (index, mask) => { collisions[index] |= mask; };

  const recordCollisions = ({ p0, p1, m0, m1, pf, bl }) => {
    if (m0 && p1) setCollision(0, 0x80);
    if (m0 && p0) setCollision(0, 0x40);
    if (m1 && p0) setCollision(1, 0x80);
    if (m1 && p1) setCollision(1, 0x40);
    if (p0 && pf) setCollision(2, 0x80);
    if (p0 && bl) setCollision(2, 0x40);
    if (p1 && pf) setCollision(3, 0x80);
    if (p1 && bl) setCollision(3, 0x40);
    if (m0 && pf) setCollision(4, 0x80);
    if (m0 && bl) setCollision(4, 0x40);
    if (m1 && pf) setCollision(5, 0x80);
    if (m1 && bl) setCollision(5, 0x40);
    if (bl && pf) setCollision(6, 0x80);
    if (p0 && p1) setCollision(7, 0x80);
    if (m0 && m1) setCollision(7, 0x40);
  };

  const renderScanlineUntil = (xEnd) => {
    if (pictureLine < 0 || pictureLine >= height) return;
    const targetX = Math.max(0, Math.min(width, Math.floor(Number(xEnd) || 0)));
    if (targetX <= renderedXInLine) return;
    const y = pictureLine;
    const state = createLineRenderState();
    const regs = state.regs;
    const events = lineEvents.slice().sort((a, b) => a.x - b.x);
    let eventIndex = 0;

    for (let x = 0; x < targetX; x += 1) {
      while (eventIndex < events.length && events[eventIndex].x <= x) {
        const event = events[eventIndex];
        if (event.type === "register") {
          applyRegisterToRenderState(state, event.reg, event.value);
        } else if (event.type === "positions") {
          copyPositions(state.positions, event.positions);
        } else if (event.type === "hmoveBlank") {
          state.hmoveBlankUntil = event.hmoveBlankUntil;
        }
        eventIndex += 1;
      }

      if (x < renderedXInLine) continue;

      const bg = colorFor(regs[TIA_WRITE.COLUBK]);
      const p0Color = colorFor(regs[TIA_WRITE.COLUP0]);
      const p1Color = colorFor(regs[TIA_WRITE.COLUP1]);
      const pfColor = colorFor(regs[TIA_WRITE.COLUPF]);
      const priorityPlayfield = (regs[TIA_WRITE.CTRLPF] & 0x04) !== 0;
      const scoreMode = (regs[TIA_WRITE.CTRLPF] & 0x02) !== 0;
      const pf = playfieldPixel(x, regs);
      const bl = ballPixel(x, state);
      const p0 = playerPixel(0, x, state);
      const p1 = playerPixel(1, x, state);
      const m0 = missilePixel(0, x, state);
      const m1 = missilePixel(1, x, state);
      recordCollisions({ p0, p1, m0, m1, pf, bl });
      const hmoveBlanked = x < state.hmoveBlankUntil;

      const localPfColor = scoreMode ? (x < width / 2 ? p0Color : p1Color) : pfColor;
      let rgb = bg;
      const drawP0 = !hmoveBlanked && (p0 || m0);
      const drawP1 = !hmoveBlanked && (p1 || m1);
      const drawPf = pf || (!hmoveBlanked && bl);

      if (hmoveBlanked) {
        rgb = [0, 0, 0];
      } else if (priorityPlayfield) {
        if (drawP1) rgb = p1Color;
        if (drawP0) rgb = p0Color;
        if (drawPf) rgb = localPfColor;
      } else {
        if (drawPf) rgb = localPfColor;
        if (drawP1) rgb = p1Color;
        if (drawP0) rgb = p0Color;
      }

      const index = (y * width + x) * 4;
      frame[index] = rgb[0];
      frame[index + 1] = rgb[1];
      frame[index + 2] = rgb[2];
      frame[index + 3] = 255;
    }
    renderedXInLine = targetX;
    lastRenderedLine = y;
  };

  const tickScanline = () => {
    if (!vsync && !vblank && pictureLine < height) {
      renderScanlineUntil(width);
      pictureLine += 1;
    }
    hmoveBlankUntil = 0;
    snapshotLineStart();
    scanline += 1;
    if (scanline >= SCANLINES_PER_FRAME) startFrame();
  };

  const tick = (cycles) => {
    let remaining = Math.max(0, Math.floor(Number(cycles) || 0));
    while (remaining > 0) {
      const slice = Math.min(remaining, CYCLES_PER_SCANLINE - cycleInLine);
      const nextCycle = cycleInLine + slice;
      if (!vsync && !vblank && pictureLine < height) renderThroughCycle(nextCycle);
      cycleInLine = nextCycle;
      remaining -= slice;
      if (cycleInLine >= CYCLES_PER_SCANLINE) {
        cycleInLine = 0;
        tickScanline();
      }
    }
  };

  const write = (emu, offset, value) => {
    const reg = offset & 0x3f;
    const next = value & 0xff;
    renderThroughBeam(emu, writeCycleOffset(emu));
    recordRegisterEvent(reg, next, emu);
    if (reg < registers.length) applyRegisterToLiveState(reg, next);

    switch (reg) {
      case TIA_WRITE.VSYNC: {
        const nextVsync = (next & 0x02) !== 0;
        if (nextVsync && !vsync) startFrame();
        vsync = nextVsync;
        break;
      }
      case TIA_WRITE.VBLANK: {
        const nextVblank = (next & 0x02) !== 0;
        if (vblank && !nextVblank && !vsync) {
          pictureLine = 0;
          snapshotLineStart();
        }
        vblank = nextVblank;
        break;
      }
      case TIA_WRITE.WSYNC: {
        const writeCycle = effectiveCycleInLine(emu);
        const cyclesToNextLine = writeCycle === 0 ? CYCLES_PER_SCANLINE : CYCLES_PER_SCANLINE - writeCycle;
        const postWriteInstructionCycles = Math.max(0, writeInstructionCycles(emu) - writeCycleOffset(emu));
        const waitCycles = Math.max(0, cyclesToNextLine - postWriteInstructionCycles);
        if (waitCycles > 0) emu?.cpu?.addCycles?.(waitCycles);
        break;
      }
      case TIA_WRITE.RSYNC:
        cycleInLine = 0;
        snapshotLineStart();
        break;
      case TIA_WRITE.RESP0: resetObject("p0", emu); break;
      case TIA_WRITE.RESP1: resetObject("p1", emu); break;
      case TIA_WRITE.RESM0: resetObject("m0", emu); break;
      case TIA_WRITE.RESM1: resetObject("m1", emu); break;
      case TIA_WRITE.RESBL: resetObject("bl", emu); break;
      case TIA_WRITE.NUSIZ0:
      case TIA_WRITE.NUSIZ1:
        if ((registers[TIA_WRITE.RESMP0] & 0x02) !== 0 || (registers[TIA_WRITE.RESMP1] & 0x02) !== 0) {
          recordPositionEvent(emu);
        }
        break;
      case TIA_WRITE.RESMP0:
      case TIA_WRITE.RESMP1:
        recordPositionEvent(emu);
        break;
      case TIA_WRITE.HMOVE: applyMotion(emu); break;
      case TIA_WRITE.HMCLR: clearMotion(); break;
      case TIA_WRITE.CXCLR: collisions.fill(0); break;
      case TIA_WRITE.AUDC0:
      case TIA_WRITE.AUDC1:
      case TIA_WRITE.AUDF0:
      case TIA_WRITE.AUDF1:
      case TIA_WRITE.AUDV0:
      case TIA_WRITE.AUDV1:
        emu?.audio?.writeRegister?.(reg, next);
        break;
      default:
        break;
    }
  };

  const readInput = (emu, index) => {
    if (index === 4) return emu?.cpu?.isInputPressed?.("fire") || emu?.cpu?.isInputPressed?.("p0fire") ? 0x00 : 0x80;
    if (index === 5) return emu?.cpu?.isInputPressed?.("p1fire") ? 0x00 : 0x80;
    return 0x80;
  };

  const read = (emu, offset) => {
    const reg = offset & 0x0f;
    if (reg < 8) {
      renderThroughBeam(emu, readCycleOffset(emu));
      return collisions[reg] & 0xc0;
    }
    if (reg >= 8 && reg <= 13) return readInput(emu, reg - 8);
    return 0x00;
  };

  const peek = (emu, offset) => {
    const reg = offset & 0x0f;
    if (reg < 8) return collisions[reg] & 0xc0;
    if (reg >= 8 && reg <= 13) return readInput(emu, reg - 8);
    return 0x00;
  };

  const serializeState = () => ({
    registers: bytesToArray(registers),
    collisions: bytesToArray(collisions),
    frame: bytesToArray(frame),
    displayFrame: bytesToArray(displayFrame),
    positions: { ...positions },
    playerGraphics: bytesToArray(playerGraphics),
    delayedPlayerGraphics: bytesToArray(delayedPlayerGraphics),
    ballEnable,
    delayedBallEnable,
    hmoveBlankUntil,
    cycleInLine,
    scanline,
    pictureLine,
    vsync,
    vblank,
    lastRenderedLine,
    framesCompleted,
    displayFramesCompleted,
  });

  const restoreState = (snapshot = {}) => {
    restoreBytes(registers, snapshot.registers);
    restoreBytes(collisions, snapshot.collisions);
    restoreBytes(frame, snapshot.frame);
    restoreBytes(displayFrame, snapshot.displayFrame ?? snapshot.frame);
    Object.assign(positions, snapshot.positions ?? {});
    syncLockedMissiles();
    restoreBytes(playerGraphics, snapshot.playerGraphics ?? [registers[TIA_WRITE.GRP0], registers[TIA_WRITE.GRP1]]);
    restoreBytes(delayedPlayerGraphics, snapshot.delayedPlayerGraphics ?? playerGraphics);
    ballEnable = u8(snapshot.ballEnable ?? registers[TIA_WRITE.ENABL] ?? 0);
    delayedBallEnable = u8(snapshot.delayedBallEnable ?? ballEnable);
    hmoveBlankUntil = Math.max(0, Math.min(width, Number(snapshot.hmoveBlankUntil) || 0));
    cycleInLine = Math.max(0, Number(snapshot.cycleInLine) || 0) % CYCLES_PER_SCANLINE;
    scanline = Math.max(0, Number(snapshot.scanline) || 0) % SCANLINES_PER_FRAME;
    pictureLine = Math.max(0, Number(snapshot.pictureLine) || 0);
    vsync = Boolean(snapshot.vsync);
    vblank = snapshot.vblank !== false;
    lastRenderedLine = Number(snapshot.lastRenderedLine ?? -1);
    framesCompleted = Math.max(0, Number(snapshot.framesCompleted) || 0);
    displayFramesCompleted = Math.max(0, Number(snapshot.displayFramesCompleted ?? framesCompleted) || 0);
    snapshotLineStart();
  };

  reset();

  return {
    registers,
    collisions,
    frame,
    displayFrame,
    width,
    height,
    reset,
    tick,
    read,
    peek,
    write,
    serializeState,
    restoreState,
    getFrame: () => (displayFramesCompleted > 0 ? displayFrame : frame),
    getDebugState: () => ({
      cycleInLine,
      scanline,
      pictureLine,
      vsync,
      vblank,
      positions: { ...positions },
      lastRenderedLine,
      framesCompleted,
      displayFramesCompleted,
    }),
  };
};

const createRIOT = () => {
  const ram = new Uint8Array(RIOT_RAM_SIZE);
  let portA = 0xff;
  let portADDR = 0x00;
  let portB = 0xff;
  let portBDDR = 0x00;
  let timerValue = 0xff;
  let timerInterval = 1;
  let timerDivider = 1;
  let timerUnderflow = false;
  let timerUnderflowSinceStatusRead = false;
  let timerUnderflowSinceSet = false;

  const reset = () => {
    ram.fill(0);
    portA = 0xff;
    portADDR = 0x00;
    portB = 0xff;
    portBDDR = 0x00;
    timerValue = 0xff;
    timerInterval = 1;
    timerDivider = 1;
    timerUnderflow = false;
    timerUnderflowSinceStatusRead = false;
    timerUnderflowSinceSet = false;
  };

  const pressed = (emu, ...ids) => ids.some((id) => emu?.cpu?.isInputPressed?.(id));

  const joystickInput = (emu) => {
    let value = 0xff;
    if (pressed(emu, "right", "p0right")) value &= ~0x80;
    if (pressed(emu, "left", "p0left")) value &= ~0x40;
    if (pressed(emu, "down", "p0down")) value &= ~0x20;
    if (pressed(emu, "up", "p0up")) value &= ~0x10;
    if (pressed(emu, "p1right")) value &= ~0x08;
    if (pressed(emu, "p1left")) value &= ~0x04;
    if (pressed(emu, "p1down")) value &= ~0x02;
    if (pressed(emu, "p1up")) value &= ~0x01;
    return value;
  };

  const switchInput = (emu) => {
    let value = 0xff;
    if (pressed(emu, "reset", "start", "start1", "gameReset")) value &= ~0x01;
    if (pressed(emu, "select", "start2", "gameSelect")) value &= ~0x02;
    if (pressed(emu, "bw", "blackwhite")) value &= ~0x08;
    if (pressed(emu, "p0difficultyA", "difficultyA")) value &= ~0x40;
    if (pressed(emu, "p1difficultyA")) value &= ~0x80;
    return value;
  };

  const portValue = (output, ddr, input) => ((output & ddr) | (input & (~ddr))) & 0xff;

  const setTimer = (value, interval) => {
    timerValue = value & 0xff;
    timerInterval = Math.max(1, interval | 0);
    timerDivider = timerInterval;
    timerUnderflow = false;
    timerUnderflowSinceStatusRead = false;
    timerUnderflowSinceSet = false;
    decrementTimer();
  };

  function markTimerUnderflow(remaining = 0) {
    timerUnderflow = true;
    timerUnderflowSinceStatusRead = true;
    timerUnderflowSinceSet = true;
    timerValue = 0xff;
    if (remaining > 0) timerValue = (timerValue - remaining) & 0xff;
  }

  function decrementTimer(remainingAfterUnderflow = 0) {
    if (timerValue > 0) {
      timerValue = (timerValue - 1) & 0xff;
    } else {
      markTimerUnderflow(remainingAfterUnderflow);
    }
  }

  const tick = (cycles) => {
    let remaining = Math.max(0, Math.floor(Number(cycles) || 0));
    if (remaining <= 0) return;

    if (timerUnderflow) {
      timerValue = (timerValue - remaining) & 0xff;
      return;
    }

    while (remaining > 0) {
      const slice = Math.min(remaining, timerDivider);
      timerDivider -= slice;
      remaining -= slice;
      if (timerDivider > 0) break;
      timerDivider += timerInterval;
      decrementTimer(remaining);
      if (timerUnderflow) break;
    }
  };

  const readRegister = (emu, offset, sideEffects = true) => {
    switch (offset & 0x1f) {
      case RIOT.SWCHA: return portValue(portA, portADDR, joystickInput(emu));
      case RIOT.SWACNT: return portADDR;
      case RIOT.SWCHB: return portValue(portB, portBDDR, switchInput(emu));
      case RIOT.SWBCNT: return portBDDR;
      case RIOT.INTIM: {
        const value = timerValue & 0xff;
        if (sideEffects && timerUnderflow) {
          timerUnderflow = false;
          timerDivider = timerInterval;
        }
        return value;
      }
      case RIOT.INSTAT: {
        const value = (timerUnderflowSinceSet ? 0x80 : 0x00) | (timerUnderflowSinceStatusRead ? 0x40 : 0x00);
        if (sideEffects) timerUnderflowSinceStatusRead = false;
        return value;
      }
      default:
        return 0xff;
    }
  };

  const writeRegister = (_emu, offset, value) => {
    const next = value & 0xff;
    switch (offset & 0x1f) {
      case RIOT.SWCHA: portA = next; break;
      case RIOT.SWACNT: portADDR = next; break;
      case RIOT.SWCHB: portB = next; break;
      case RIOT.SWBCNT: portBDDR = next; break;
      case RIOT.TIM1T: setTimer(next, 1); break;
      case RIOT.TIM8T: setTimer(next, 8); break;
      case RIOT.TIM64T: setTimer(next, 64); break;
      case RIOT.T1024T: setTimer(next, 1024); break;
      default: break;
    }
  };

  const serializeState = () => ({
    ram: bytesToArray(ram),
    portA,
    portADDR,
    portB,
    portBDDR,
    timerValue,
    timerInterval,
    timerDivider,
    timerUnderflow,
    timerUnderflowSinceStatusRead,
    timerUnderflowSinceSet,
  });

  const restoreState = (snapshot = {}) => {
    restoreBytes(ram, snapshot.ram);
    portA = u8(snapshot.portA ?? 0xff);
    portADDR = u8(snapshot.portADDR ?? 0x00);
    portB = u8(snapshot.portB ?? 0xff);
    portBDDR = u8(snapshot.portBDDR ?? 0x00);
    timerValue = u8(snapshot.timerValue ?? 0xff);
    timerInterval = Math.max(1, Number(snapshot.timerInterval) || 1);
    timerDivider = Math.max(1, Number(snapshot.timerDivider) || timerInterval);
    timerUnderflow = Boolean(snapshot.timerUnderflow);
    timerUnderflowSinceStatusRead = Boolean(snapshot.timerUnderflowSinceStatusRead ?? snapshot.timerInterrupt);
    timerUnderflowSinceSet = Boolean(snapshot.timerUnderflowSinceSet ?? snapshot.timerInterrupt);
  };

  reset();

  return {
    ram,
    reset,
    tick,
    readRegister,
    writeRegister,
    serializeState,
    restoreState,
  };
};

const createAtari2600Memory = (_size = ADDRESS_SPACE_SIZE, config = {}) => {
  const raw = new Uint8Array(ADDRESS_SPACE_SIZE);
  const riot = createRIOT();
  const tia = createTIA(config.video ?? {});
  let cartridge = new Uint8Array(0x1000);
  let cartridgeRam = new Uint8Array(0);
  let cartridgeRamSize = 0;
  let cartridgeMapper = "";
  let cartridgeRamHint = 0;
  let cartridgeSize = 0;
  let bankSize = 0x1000;
  let bankCount = 1;
  let currentBank = 0;
  let bankingMode = "empty";
  const soundWrites = [];

  const refreshRawCartridgeWindow = () => {
    for (let i = 0; i < 0x1000; i += 1) raw[0x1000 + i] = peekCartridgeByte(0x1000 + i);
  };

  const bankPrefixIsPadding = (prefixSize) => {
    if (bankCount <= 1 || bankSize !== 0x1000) return false;
    for (let bank = 0; bank < bankCount; bank += 1) {
      const start = bank * bankSize;
      const end = Math.min(start + prefixSize, cartridgeSize);
      if (end - start < prefixSize) return false;
      for (let i = start; i < end; i += 1) {
        const value = cartridge[i] ?? 0xff;
        if (value !== 0x00 && value !== 0xff) return false;
      }
    }
    return true;
  };

  const configureCartridgeRam = (resetRam = false) => {
    const nextSize = cartridgeRamHint > 0
      ? cartridgeRamHint
      : (bankPrefixIsPadding(0x100)
        ? (bankPrefixIsPadding(0x200) ? 0x100 : 0x80)
        : 0);
    if (nextSize !== cartridgeRamSize) {
      const nextRam = new Uint8Array(nextSize);
      if (!resetRam && cartridgeRam.length) nextRam.set(cartridgeRam.subarray(0, nextSize));
      cartridgeRam = nextRam;
      cartridgeRamSize = nextSize;
      return;
    }
    if (resetRam) cartridgeRam.fill(0);
  };

  const configureBanking = (size, options = {}) => {
    const mapper = normalizeMapperName(options.mapper ?? cartridgeMapper);
    cartridgeSize = Math.max(0, Number(size) || 0);
    bankSize = 0x1000;
    if (cartridgeSize === 0) {
      bankCount = 1;
      currentBank = 0;
      bankingMode = "empty";
    } else if (mapper === "F8" || mapper === "F8SC") {
      bankCount = 2;
      currentBank = Math.min(bankCount - 1, Math.max(0, Number(config.initialBank ?? bankCount - 1) || 0));
      bankingMode = "F8";
    } else if (cartridgeSize <= 0x1000) {
      bankCount = 1;
      currentBank = 0;
      bankingMode = cartridgeSize <= 0x0800 ? "2k" : "4k";
    } else if (cartridgeSize % 0x1000 === 0) {
      bankCount = Math.max(1, cartridgeSize / 0x1000);
      currentBank = Math.min(bankCount - 1, Math.max(0, Number(config.initialBank ?? bankCount - 1) || 0));
      bankingMode = bankCount === 2 ? "F8" : bankCount === 4 ? "F6" : bankCount === 8 ? "F4" : "4k-banked";
    } else {
      bankCount = 1;
      currentBank = 0;
      bankingMode = "raw";
    }
    configureCartridgeRam(Boolean(options.resetCartridgeRam));
  };

  const cartridgeRamReadIndex = (address) => {
    if (cartridgeRamSize === 0) return null;
    const offset = address & 0x0fff;
    const readBase = cartridgeRamSize === 0x100 ? 0x100 : 0x080;
    return offset >= readBase && offset < readBase + cartridgeRamSize ? offset - readBase : null;
  };

  const cartridgeRamWriteIndex = (address) => {
    if (cartridgeRamSize === 0) return null;
    const offset = address & 0x0fff;
    return offset < cartridgeRamSize ? offset : null;
  };

  function peekCartridgeByte(address) {
    if (cartridgeSize <= 0) return 0xff;
    const offset = address & 0x0fff;
    const ramIndex = cartridgeRamReadIndex(address);
    if (ramIndex != null) return cartridgeRam[ramIndex] ?? 0xff;
    if (bankCount <= 1) return cartridge[offset % cartridgeSize] ?? 0xff;
    return cartridge[(currentBank * bankSize + offset) % cartridgeSize] ?? 0xff;
  }

  const selectBankForHotspot = (address) => {
    if (bankCount <= 1) return;
    const hotspot = address & 0x0fff;
    let nextBank = null;
    if (bankCount === 2 && hotspot >= 0x0ff8 && hotspot <= 0x0ff9) nextBank = hotspot - 0x0ff8;
    else if (bankCount === 3 && hotspot >= 0x0ff8 && hotspot <= 0x0ffa) nextBank = hotspot - 0x0ff8;
    else if (bankCount === 4 && hotspot >= 0x0ff6 && hotspot <= 0x0ff9) nextBank = hotspot - 0x0ff6;
    else if (bankCount === 8 && hotspot >= 0x0ff4 && hotspot <= 0x0ffb) nextBank = hotspot - 0x0ff4;
    if (nextBank != null && nextBank >= 0 && nextBank < bankCount) {
      currentBank = nextBank;
      refreshRawCartridgeWindow();
    }
  };

  const readCartridgeByte = (address, sideEffects = true) => {
    if (sideEffects) selectBankForHotspot(address);
    return peekCartridgeByte(address);
  };

  const loadCartridge = (bytes, offset = 0, options = {}) => {
    const rawData = byteArrayFrom(bytes);
    let mapper = normalizeMapperName(options.mapper ?? options.banking ?? options.bankingMode ?? options.cartType);
    if (!mapper && looksLikeF8SCOverdump(rawData)) mapper = "F8SC";
    const data = (mapper === "F8" || mapper === "F8SC") && rawData.length > 0x2000
      ? rawData.subarray(0, 0x2000)
      : rawData;
    const start = Math.max(0, Number(offset) || 0);
    const logicalSize = start > 0 ? Math.max(cartridgeSize, start + data.length) : data.length;
    const nextSize = Math.max(logicalSize, 0x1000);
    const next = new Uint8Array(nextSize);
    if (start > 0 && cartridgeSize > 0) next.set(cartridge.subarray(0, Math.min(cartridge.length, next.length)));
    next.set(data, Math.min(start, next.length));
    cartridge = next;
    cartridgeMapper = mapper;
    cartridgeRamHint = mapper === "F8SC" ? 0x80 : 0;
    configureBanking(logicalSize, { resetCartridgeRam: true, mapper });
    refreshRawCartridgeWindow();
    return { start, length: data.length, end: start + Math.max(0, data.length - 1), target: "cartridge" };
  };

  const decode = (address) => {
    const addr = u13(address);
    if ((addr & 0x1000) !== 0) return { type: "cartridge", address: addr };
    if ((addr & 0x0080) === 0) return { type: "tia", address: addr & 0x3f };
    if ((addr & 0x0200) !== 0) return { type: "riot", address: addr & 0x1f };
    return { type: "ram", address: addr & 0x7f };
  };

  const readByte = (emu, address) => {
    const target = decode(address);
    if (target.type === "cartridge") return readCartridgeByte(target.address, true);
    if (target.type === "tia") return tia.read(emu, target.address);
    if (target.type === "riot") return riot.readRegister(emu, target.address, true);
    return riot.ram[target.address];
  };

  const peekByte = (emu, address) => {
    const target = decode(address);
    if (target.type === "cartridge") return readCartridgeByte(target.address, false);
    if (target.type === "tia") return tia.peek(emu, target.address);
    if (target.type === "riot") return riot.readRegister(emu, target.address, false);
    return riot.ram[target.address];
  };

  const writeByte = (emu, address, value) => {
    const target = decode(address);
    const next = value & 0xff;
    if (target.type === "tia") {
      tia.write(emu, target.address, next);
      raw[u13(address)] = next;
      if (target.address >= TIA_WRITE.AUDC0 && target.address <= TIA_WRITE.AUDV1) {
        soundWrites.push({ address: u13(address), register: target.address, value: next });
        if (soundWrites.length > 32) soundWrites.shift();
      }
      return;
    }
    if (target.type === "riot") {
      riot.writeRegister(emu, target.address, next);
      raw[u13(address)] = next;
      return;
    }
    if (target.type === "ram") {
      riot.ram[target.address] = next;
      raw[0x0080 + target.address] = next;
      return;
    }
    const ramIndex = cartridgeRamWriteIndex(target.address);
    if (ramIndex != null) {
      cartridgeRam[ramIndex] = next;
      refreshRawCartridgeWindow();
      return;
    }
    selectBankForHotspot(target.address);
  };

  const loadByte = (emu, address, value, options = {}) => {
    const target = String(options.target ?? "").toLowerCase();
    if (target === "cartridge" || target === "cart" || target === "rom") {
      const offset = address & 0x0fff;
      if (offset >= cartridge.length) {
        const next = new Uint8Array(offset + 1);
        next.set(cartridge);
        cartridge = next;
      }
      cartridge[offset] = value & 0xff;
      configureBanking(Math.max(cartridgeSize, offset + 1));
      refreshRawCartridgeWindow();
      return;
    }
    writeByte(emu, address, value);
  };

  const loadBytes = (emu, offset, bytes, options = {}) => {
    const data = byteArrayFrom(bytes);
    const target = String(options.target ?? "").toLowerCase();
    if (target === "cartridge" || target === "cart" || target === "rom" || (target === "" && data.length >= 0x0400)) {
      return loadCartridge(data, target === "" ? 0 : Number(offset) || 0, options);
    }
    const start = u13(offset);
    for (let i = 0; i < data.length; i += 1) loadByte(emu, start + i, data[i], options);
    return { start, length: data.length, end: u13(start + Math.max(0, data.length - 1)) };
  };

  const reset = () => {
    raw.fill(0);
    riot.reset();
    tia.reset();
    configureBanking(cartridgeSize);
    cartridgeRam.fill(0);
    refreshRawCartridgeWindow();
    soundWrites.length = 0;
  };

  const tick = (_emu, cycles) => {
    const count = Math.max(0, Number(cycles) || 0);
    tia.tick(count);
    riot.tick(count);
  };

  const serializeState = () => ({
    ram: bytesToArray(riot.ram),
    raw: bytesToArray(raw),
    cartridge: bytesToArray(cartridge.subarray(0, cartridgeSize || cartridge.length)),
    cartridgeSize,
    cartridgeRam: bytesToArray(cartridgeRam),
    cartridgeRamSize,
    cartridgeMapper,
    cartridgeRamHint,
    bankSize,
    bankCount,
    currentBank,
    bankingMode,
    riot: riot.serializeState(),
    tia: tia.serializeState(),
    soundWrites: soundWrites.slice(),
    byteLength: raw.length + riot.ram.length + (cartridgeSize || cartridge.length),
  });

  const restoreState = (emu, snapshot = {}) => {
    restoreBytes(raw, snapshot.raw);
    riot.restoreState(snapshot.riot ?? { ram: snapshot.ram });
    tia.restoreState(snapshot.tia);
    if (snapshot.cartridge != null) {
      cartridge = Uint8Array.from(snapshot.cartridge);
      cartridgeMapper = normalizeMapperName(snapshot.cartridgeMapper);
      cartridgeRamHint = Math.max(0, Number(snapshot.cartridgeRamHint) || 0);
      configureBanking(Number(snapshot.cartridgeSize) || cartridge.length, { mapper: cartridgeMapper });
    }
    restoreBytes(cartridgeRam, snapshot.cartridgeRam);
    cartridgeRamSize = cartridgeRam.length;
    bankSize = Math.max(1, Number(snapshot.bankSize) || 0x1000);
    bankCount = Math.max(1, Number(snapshot.bankCount) || 1);
    currentBank = Math.max(0, Number(snapshot.currentBank) || 0) % bankCount;
    bankingMode = String(snapshot.bankingMode ?? bankingMode);
    soundWrites.length = 0;
    soundWrites.push(...(snapshot.soundWrites ?? []).slice(-32));
    refreshRawCartridgeWindow();
    emu?.audio?.restoreTIAState?.(tia.registers);
  };

  configureBanking(0);
  reset();

  return {
    type: "atari2600",
    raw,
    ram: riot.ram,
    tia,
    riot,
    soundWrites,
    readByte,
    peekByte,
    writeByte,
    loadByte,
    loadBytes,
    loadCartridge,
    reset,
    tick,
    serializeState,
    restoreState,
    irqActive: () => false,
    consumeNmi: () => false,
    debugPorts: (emu) => [
      riot.readRegister(emu, RIOT.SWCHA, false),
      riot.readRegister(emu, RIOT.SWCHB, false),
      riot.readRegister(emu, RIOT.INTIM, false),
      currentBank,
      bankCount,
      tia.getDebugState().scanline,
      tia.getDebugState().pictureLine,
      tia.getDebugState().cycleInLine,
    ],
    getCartridgeState: () => ({ cartridgeSize, cartridgeRamSize, bankSize, bankCount, currentBank, bankingMode }),
  };
};

export default createAtari2600Memory;
