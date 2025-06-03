const DRIVER = "midway-8080-bitmap";
const OFF_COLOR = Object.freeze([0, 0, 0]);
const WHITE_COLOR = Object.freeze([235, 235, 225]);
const GREEN_COLOR = Object.freeze([80, 255, 120]);
const RED_COLOR = Object.freeze([255, 80, 80]);

const pixelColor = (x, y) => {
  if ((y >= 0xb8 && y <= 0xee && x >= 0 && x <= 0xdf) || (y >= 0xf0 && y <= 0xf7 && x >= 0x0f && x <= 0x85)) {
    return GREEN_COLOR;
  }
  if (y >= 0x20 && y <= 0x3f && x >= 0 && x <= 0xe9) return RED_COLOR;
  return WHITE_COLOR;
};

export const renderByte = ({ emu, imageData, address }) => {
  const video = emu?.manifest?.video ?? {};
  const start = Number(video.memoryStart);
  const normalized = (address & 0xffff) - start;
  if (!emu?.mmu || !imageData || !Number.isFinite(start) || normalized < 0) return;

  const x = normalized >> 5;
  const baseY = (~(((normalized & 0x1f) * 8) & 0xff)) & 0xff;
  const value = emu.mmu.readByte(emu, address & 0xffff) & 0xff;
  const width = imageData.width ?? Number(video.width) ?? 224;
  const height = imageData.height ?? Number(video.height) ?? 256;

  for (let bit = 0; bit < 8; bit += 1) {
    const y = baseY - bit;
    if (x < 0 || x >= width || y < 0 || y >= height) continue;

    const index = (y * width + x) * 4;
    const color = ((value >> bit) & 1) === 1 ? pixelColor(x, y) : OFF_COLOR;
    imageData.data[index] = color[0];
    imageData.data[index + 1] = color[1];
    imageData.data[index + 2] = color[2];
    imageData.data[index + 3] = 255;
  }
};

export default Object.freeze({
  driver: DRIVER,
  renderByte,
});
