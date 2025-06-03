import assert from "assert";
import createZ80MMU from "../../emulator/memory/mmu/z80.js";
import { createMappedDevice } from "../helpers/mmu-harness.js";

describe("Hitachi HD6303 platform MMU", () => {
  it("blocks writes to read-only mapped segments", () => {
    const device = createMappedDevice({ start: 0x8000, size: 0x100, writable: true, type: "rom" });
    const mmu = createZ80MMU([device], {
      segments: [{ type: "rom", start: 0x8000, size: 0x100, writable: false }],
    });

    mmu.writeByte(null, 0x8000, 0xab);

    assert.strictEqual(mmu.readByte(null, 0x8000), 0x00);
  });
});
