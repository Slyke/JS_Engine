import assert from "assert";
import createZ80MMU from "../../emulator/memory/mmu/z80.js";
import { createMappedDevice } from "../helpers/mmu-harness.js";

describe("Intel 8080 platform MMU", () => {
  it("routes reads and writes through mapped devices", () => {
    const device = createMappedDevice({ start: 0x2000, size: 0x100 });
    const mmu = createZ80MMU([device], {});

    mmu.writeByte(null, 0x2010, 0xab);

    assert.strictEqual(mmu.readByte(null, 0x2010), 0xab);
  });
});
