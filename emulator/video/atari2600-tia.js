const DRIVER = "atari2600-tia";

export const renderFrame = ({ emu, screenCtx, imageData }) => {
  const video = emu?.manifest?.video ?? {};
  const width = Number(video.width) || 160;
  const height = Number(video.height) || 192;
  const frame = emu?.mmu?.videoFrame?.(emu) ?? emu?.mmu?.memory?.tia?.frame;

  if (!screenCtx || !frame) return;

  if (imageData?.data && imageData.width === width && imageData.height === height) {
    imageData.data.set(frame.subarray(0, imageData.data.length));
    screenCtx.putImageData(imageData, 0, 0);
    return;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      screenCtx.fillStyle = "rgb(" + frame[index] + "," + frame[index + 1] + "," + frame[index + 2] + ")";
      screenCtx.fillRect(x, y, 1, 1);
    }
  }
};

export default Object.freeze({
  driver: DRIVER,
  renderFrame,
});
