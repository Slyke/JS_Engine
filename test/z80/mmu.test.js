import assert from "assert";
import createZ80MMU from "../../emulator/memory/mmu/z80.js";
import { createMappedDevice } from "../helpers/mmu-harness.js";

describe("Z80 platform MMU", () => {
  it("reports segment metadata for mapped devices", () => {
    const device = createMappedDevice({ start: 0x0000, size: 0x2000, writable: true });
    const mmu = createZ80MMU([device], {
      segments: [{ type: "ram", label: "Main RAM", start: 0x0000, size: 0x2000, writable: true }],
    });

    assert.deepStrictEqual(mmu.getMemoryMap()[0], {
      type: "ram",
      index: 0,
      label: "Main RAM",
      start: 0x0000,
      end: 0x1fff,
      size: 0x2000,
      writable: true,
    });
  });

  it("aliases instruction fetches without changing ordinary reads", () => {
    const device = createMappedDevice({ start: 0x0000, size: 0x10000, writable: true });
    const mmu = createZ80MMU([device], {
      fetchAliases: [{ start: 0x8000, end: 0xffff, targetStart: 0x0000, defaultOpcode: 0x00, preserveOpcodes: [0x76] }],
    });

    device.raw[0x402b] = 0x76;
    device.raw[0x402c] = 0x2b;
    device.raw[0xc02b] = 0xff;
    device.raw[0xc02c] = 0xee;

    assert.strictEqual(mmu.fetchByte(null, 0xc02b), 0x76);
    assert.strictEqual(mmu.fetchByte(null, 0xc02c), 0x00);
    assert.strictEqual(mmu.readByte(null, 0xc02b), 0xff);
    assert.strictEqual(mmu.readByte(null, 0xc02c), 0xee);
  });
});
