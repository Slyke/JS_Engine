const DRIVER = "sinclair-zx80-display-file";
const COLUMNS = 32;
const ROWS = 24;
const CELL_SIZE = 8;
const D_FILE = 0x400c;
const E_LINE = 0x400a;
const DF_END = 0x4010;
const DF_SZ = 0x4012;
const FONT_BASE = 0x0e00;
const TOKEN_TABLE = 0x00ba;
const NEWLINE = 0x76;
const INVERSE_K = 0xb0;
const PAPER = "#d8d8c8";
const INK = "#101010";

const readByte = (emu, address) => emu.mmu.readByte(emu, address & 0xffff) & 0xff;
const readWordLE = (emu, address) => readByte(emu, address) | (readByte(emu, address + 1) << 8);

const tokenGlyphs = (emu, token) => {
  const threshold = readByte(emu, TOKEN_TABLE);
  let address = TOKEN_TABLE + 1;
  let entriesToSkip = token < threshold ? 0 : (token - threshold) + 1;
  while (entriesToSkip > 0 && address < FONT_BASE) {
    const value = readByte(emu, address);
    address += 1;
    if ((value & 0x80) !== 0) entriesToSkip -= 1;
  }

  const glyphs = [];
  for (let guard = 0; guard < 24 && address < FONT_BASE; guard += 1) {
    const value = readByte(emu, address);
    glyphs.push(value & 0x3f);
    address += 1;
    if ((value & 0x80) !== 0) break;
  }
  return glyphs;
};

const glyphsForValue = (emu, value) => {
  if (value >= readByte(emu, TOKEN_TABLE)) return tokenGlyphs(emu, value);
  if ((value & 0x40) !== 0) return [];
  return [value];
};

const displayFileRange = (emu) => {
  const start = readWordLE(emu, D_FILE) & 0x7fff;
  const end = readWordLE(emu, DF_END) & 0x7fff;
  if (start < 0x4000 || start >= 0x8000) return null;
  return {
    start,
    end: end > start && end <= 0x8000 ? end : Math.min(0x8000, start + 2048),
  };
};

const renderGlyph = (emu, screenCtx, code, cellX, cellY, inverse = false) => {
  const charCode = code & 0x3f;
  const fontBase = FONT_BASE + (charCode * CELL_SIZE);
  const x0 = cellX * CELL_SIZE;
  const y0 = cellY * CELL_SIZE;

  for (let row = 0; row < CELL_SIZE; row += 1) {
    const bits = readByte(emu, fontBase + row);
    for (let col = 0; col < CELL_SIZE; col += 1) {
      const on = ((bits >> (7 - col)) & 1) === 1;
      screenCtx.fillStyle = (on !== inverse) ? INK : PAPER;
      screenCtx.fillRect(x0 + col, y0 + row, 1, 1);
    }
  }
};

const collectDisplayLines = (emu, range) => {
  const lines = [[]];
  let address = range.start;
  for (let guard = 0; address < range.end && guard < 2048; guard += 1) {
    const value = readByte(emu, address);
    address = (address + 1) & 0xffff;
    if (value === NEWLINE) lines.push([]);
    else lines[lines.length - 1].push(value);
  }
  return lines;
};

const trimTrailingEmptyLines = (lines) => {
  let end = lines.length;
  while (end > 0 && lines[end - 1].length === 0) end -= 1;
  return lines.slice(0, end);
};

const renderLines = (emu, screenCtx, lines, startRow = 0) => {
  let row = startRow;
  let column = 0;
  let glyphCount = 0;

  for (const line of lines) {
    if (row >= ROWS) break;
    column = 0;
    for (const value of line) {
      for (const glyph of glyphsForValue(emu, value)) {
        if (column >= COLUMNS) {
          row += 1;
          column = 0;
          if (row >= ROWS) return glyphCount;
        }
        renderGlyph(emu, screenCtx, glyph, column, row, (glyph & 0x80) !== 0);
        glyphCount += 1;
        column += 1;
      }
    }
    row += 1;
  }

  return glyphCount;
};

export const renderFrame = ({ emu, screenCtx }) => {
  const width = Number(emu?.manifest?.video?.width) || COLUMNS * CELL_SIZE;
  const height = Number(emu?.manifest?.video?.height) || ROWS * CELL_SIZE;
  screenCtx.fillStyle = PAPER;
  screenCtx.fillRect(0, 0, width, height);

  const range = displayFileRange(emu);
  if (!range) return;

  const displayLines = collectDisplayLines(emu, range);
  let glyphCount = renderLines(emu, screenCtx, displayLines.slice(0, ROWS));

  if (glyphCount > 0) return;

  const lowerRows = Math.max(1, Math.min(ROWS, readByte(emu, DF_SZ) || 1));
  const lowerLines = trimTrailingEmptyLines(displayLines).slice(-lowerRows);
  glyphCount = renderLines(emu, screenCtx, lowerLines, Math.max(0, ROWS - lowerRows));

  if (glyphCount > 0) return;

  const editLine = readWordLE(emu, E_LINE) & 0x7fff;
  const displayFile = readWordLE(emu, D_FILE) & 0x7fff;
  if (editLine >= 0x4000 && editLine < displayFile && displayFile <= 0x8000) {
    const editLines = [[]];
    for (let editAddress = editLine; editAddress < displayFile; editAddress += 1) {
      const value = readByte(emu, editAddress);
      if (value === NEWLINE) editLines.push([]);
      else editLines[editLines.length - 1].push(value);
    }
    glyphCount = renderLines(emu, screenCtx, editLines, Math.max(0, ROWS - lowerRows));
  }

  if (glyphCount === 0) renderGlyph(emu, screenCtx, INVERSE_K, 0, ROWS - 1, true);
};

export default Object.freeze({
  driver: DRIVER,
  renderFrame,
});
