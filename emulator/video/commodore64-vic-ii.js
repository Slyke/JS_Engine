const DRIVER = "commodore64-vic-ii";
const DISPLAY_WIDTH = 384;
const DISPLAY_HEIGHT = 272;
const TEXT_LEFT = 32;
const TEXT_TOP = 36;
const COLUMNS = 40;
const ROWS = 25;
const CELL_SIZE = 8;

const PALETTE = Object.freeze([
  "#000000", "#ffffff", "#9f4e44", "#6abfc6",
  "#a057a3", "#5cab5e", "#50459b", "#c9d487",
  "#a1683c", "#6d5412", "#cb7e75", "#626262",
  "#898989", "#9ae29b", "#887ecb", "#adadad",
]);

const color = (index) => PALETTE[index & 0x0f] ?? PALETTE[0];
const vicRegs = (emu) => emu?.mmu?.memory?.vic ?? null;
const colorRam = (emu) => emu?.mmu?.memory?.colorRam ?? null;
const readVideoByte = (emu, address) => emu?.mmu?.readVideoByte?.(emu, address & 0x3fff) ?? 0;

const renderGlyph = (emu, screenCtx, screenCode, colorCode, charAddress, cellX, cellY, backgroundColor) => {
  const foreground = color(colorCode);
  const reverse = (screenCode & 0x80) !== 0;
  const x0 = TEXT_LEFT + cellX * CELL_SIZE;
  const y0 = TEXT_TOP + cellY * CELL_SIZE;

  for (let row = 0; row < CELL_SIZE; row += 1) {
    const bits = readVideoByte(emu, charAddress + row);
    for (let col = 0; col < CELL_SIZE; col += 1) {
      const on = ((bits >> (7 - col)) & 1) !== 0;
      screenCtx.fillStyle = (on !== reverse) ? foreground : backgroundColor;
      screenCtx.fillRect(x0 + col, y0 + row, 1, 1);
    }
  }
};

export const renderFrame = ({ emu, screenCtx }) => {
  const regs = vicRegs(emu);
  const colors = colorRam(emu);
  const d018 = regs?.[0x18] ?? 0x14;
  const borderColor = color(regs?.[0x20] ?? 0x0e);
  const backgroundColor = color(regs?.[0x21] ?? 0x06);
  const screenBase = ((d018 >> 4) & 0x0f) * 0x0400;
  const charBase = ((d018 >> 1) & 0x07) * 0x0800;

  screenCtx.fillStyle = borderColor;
  screenCtx.fillRect(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
  screenCtx.fillStyle = backgroundColor;
  screenCtx.fillRect(TEXT_LEFT, TEXT_TOP, COLUMNS * CELL_SIZE, ROWS * CELL_SIZE);

  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const index = row * COLUMNS + column;
      const screenCode = readVideoByte(emu, screenBase + index);
      const colorCode = colors?.[index & 0x03ff] ?? 0x0e;
      const charAddress = charBase + ((screenCode & 0xff) * CELL_SIZE);
      renderGlyph(emu, screenCtx, screenCode, colorCode, charAddress, column, row, backgroundColor);
    }
  }
};

export default Object.freeze({
  driver: DRIVER,
  renderFrame,
});
