const DRIVER = "psion-lcd";
const DEFAULT_COLUMNS = 16;
const DEFAULT_ROWS = 2;
const DEFAULT_CELL_WIDTH = 10;
const DEFAULT_CELL_HEIGHT = 16;

const TWO_LINE_MAP = Object.freeze([
  Array.from({ length: 16 }, (_value, index) => index),
  Array.from({ length: 16 }, (_value, index) => 0x40 + index),
]);

const LZ_FOUR_LINE_MAP = Object.freeze([
  [0, 1, 2, 3, 8, 9, 10, 11, 12, 13, 14, 15, 24, 25, 26, 27, 28, 29, 30, 31],
  [64, 65, 66, 67, 72, 73, 74, 75, 76, 77, 78, 79, 88, 89, 90, 91, 92, 93, 94, 95],
  [4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23, 32, 33, 34, 35, 36, 37, 38, 39],
  [68, 69, 70, 71, 80, 81, 82, 83, 84, 85, 86, 87, 96, 97, 98, 99, 100, 101, 102, 103],
]);

const findLcdDevice = (emu) => (emu?.devices?.memory ?? []).find((device) => typeof device.getState === "function" && device.getState()?.ddram) ?? null;

const printableChar = (value) => {
  const code = value & 0xff;
  if (code >= 0x20 && code <= 0x7e) return String.fromCharCode(code);
  return " ";
};

const numberOption = (value, fallback) => {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
};

const lcdAddressMap = (video = {}) => {
  if (Array.isArray(video.addressMap)) return video.addressMap;
  const columns = numberOption(video.columns, DEFAULT_COLUMNS);
  const rows = numberOption(video.rows, DEFAULT_ROWS);
  if (columns === 20 && rows === 4) return LZ_FOUR_LINE_MAP;
  if (columns === 16 && rows === 2) return TWO_LINE_MAP;
  return Array.from({ length: rows }, (_row, row) => Array.from({ length: columns }, (_column, column) => row * columns + column));
};

const findCellForAddress = (addressMap, address) => {
  const target = address & 0x7f;
  for (let row = 0; row < addressMap.length; row += 1) {
    const column = addressMap[row]?.findIndex((candidate) => (candidate & 0x7f) === target) ?? -1;
    if (column >= 0) return { row, column };
  }
  return null;
};

const drawCgramGlyph = (ctx, cgram, code, x, y, width, height) => {
  const base = (code & 0x07) * 8;
  const dot = Math.max(1, Math.min(width / 7, height / 10));
  const gap = dot * 0.18;
  const usedWidth = 5 * dot + 4 * gap;
  const usedHeight = 8 * dot + 7 * gap;
  const originX = x + (width - usedWidth) / 2;
  const originY = y + (height - usedHeight) / 2;
  let pixels = 0;
  for (let row = 0; row < 8; row += 1) {
    const bits = cgram?.[base + row] ?? 0;
    for (let column = 0; column < 5; column += 1) {
      if ((bits & (1 << (4 - column))) === 0) continue;
      ctx.fillRect(originX + column * (dot + gap), originY + row * (dot + gap), dot, dot);
      pixels += 1;
    }
  }
  if (pixels === 0) ctx.fillRect(x + width * 0.2, y + height * 0.2, width * 0.6, height * 0.6);
};

const drawTextGlyph = (ctx, char, x, y, width, height) => {
  ctx.save();
  ctx.font = Math.max(8, Math.floor(Math.min(height * 0.72, width * 1.05))) + "px monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.translate(x + width / 2, y + height / 2);
  ctx.scale(0.78, 1);
  ctx.fillText(char, 0, 0);
  ctx.restore();
};

const drawCursor = (ctx, x, y, width, height, blinkOn) => {
  const lineHeight = Math.max(1, Math.floor(height * 0.1));
  ctx.fillRect(
    x + Math.max(1, width * 0.15),
    y + height - lineHeight - Math.max(1, height * 0.08),
    Math.max(1, width * 0.7),
    lineHeight,
  );
  if (!blinkOn) return;
  const strokeWidth = Math.max(1, Math.floor(Math.min(width, height) * 0.08));
  ctx.fillRect(x + 1, y + 1, width - 2, strokeWidth);
  ctx.fillRect(x + 1, y + height - strokeWidth - 1, width - 2, strokeWidth);
  ctx.fillRect(x + 1, y + 1, strokeWidth, height - 2);
  ctx.fillRect(x + width - strokeWidth - 1, y + 1, strokeWidth, height - 2);
};

export const renderFrame = ({ emu, screenCtx }) => {
  const video = emu?.manifest?.video ?? {};
  const columns = numberOption(video.columns, DEFAULT_COLUMNS);
  const rows = numberOption(video.rows, DEFAULT_ROWS);
  const width = Number(video.width) || columns * DEFAULT_CELL_WIDTH;
  const height = Number(video.height) || rows * DEFAULT_CELL_HEIGHT;
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const addressMap = lcdAddressMap(video);
  const state = findLcdDevice(emu)?.getState?.();
  const ddram = state?.ddram ?? new Uint8Array(0x80).fill(0x20);
  const cgram = state?.cgram ?? new Uint8Array(0x40);

  screenCtx.fillStyle = "#b7c49a";
  screenCtx.fillRect(0, 0, width, height);
  if (state?.displayOn === false) return;

  screenCtx.fillStyle = "#26311f";

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const code = ddram[(addressMap[row]?.[column] ?? (row * columns + column)) & 0x7f];
      const x = column * cellWidth;
      const y = row * cellHeight;
      if ((code & 0xff) < 8) drawCgramGlyph(screenCtx, cgram, code, x, y, cellWidth, cellHeight);
      else drawTextGlyph(screenCtx, printableChar(code), x, y, cellWidth, cellHeight);
    }
  }

  if (state?.cursorOn || state?.blinkOn) {
    const cell = findCellForAddress(addressMap, state.address ?? 0);
    if (cell) drawCursor(screenCtx, cell.column * cellWidth, cell.row * cellHeight, cellWidth, cellHeight, Boolean(state?.blinkOn));
  }
};

export default Object.freeze({
  driver: DRIVER,
  renderFrame,
});
