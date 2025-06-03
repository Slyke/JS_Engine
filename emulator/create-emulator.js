// emulator/create-emulator.js
import { dirOf, dynImport, fetchJSON, resolveURL } from './utils/loader.js';

const loadManifestObj = async (u) => {
  const href = typeof u === 'string' ? u : u.href;
  return href.endsWith('.js') ? await dynImport(href) : await fetchJSON(href);
};

export const createEmulatorFromManifestURL = async (manifestURLlike) => {
  const manifestHref = typeof manifestURLlike === 'string' ? manifestURLlike : manifestURLlike.href;
  const manifest = await loadManifestObj(manifestHref);

  const manifestDir = dirOf(manifestHref);
  const modulesBase = new URL('../', manifestDir);
  const load = (rel) => dynImport(resolveURL(rel, modulesBase));

  const mmuFactory = await load(manifest.memory.mmu);
  const memDevices = [];
  for (const d of manifest.memory.devices ?? []) {
    const F = await load(d.module);
    const inst = F(d.size, d);
    memDevices.push({ ...d, ...inst });
  }
  const mmu = mmuFactory(memDevices, manifest.memory ?? {});

  const parseManifestNumber = (value, fallback = 0) => {
    const number = typeof value === "number" ? value : Number(String(value ?? "").trim());
    return Number.isFinite(number) ? number : fallback;
  };

  const applyMemoryInitialBytes = (emuState = null) => {
    for (const entry of manifest.memory?.initialBytes ?? manifest.memory?.initial ?? []) {
      const address = parseManifestNumber(entry.address ?? entry.start, 0) & 0xffff;
      const values = Array.from(entry.data ?? entry.values ?? []).map((value) => parseManifestNumber(value, 0) & 0xff);
      if (values.length) {
        if (mmu.loadBytes) mmu.loadBytes(emuState, address, Uint8Array.from(values));
        else for (let i = 0; i < values.length; i += 1) mmu.writeByte(emuState, address + i, values[i]);
      }
    }
  };

  applyMemoryInitialBytes();

  const ioDevices = [];
  const io = (() => {
    const raw = new Uint8Array(0x10000);
    const findDevice = (port) => {
      const address = port & 0xffff;
      return ioDevices.find((dev) => address >= dev.portStart && address < dev.portStart + dev.size);
    };
    const inByte = (e, p) => {
      const port = p & 0xffff;
      const dev = findDevice(port);
      return dev?.inByte ? dev.inByte(e, port) & 0xff : raw[port];
    };
    const outByte = (e, p, v) => {
      const port = p & 0xffff;
      const value = v & 0xff;
      raw[port] = value;
      const dev = findDevice(port);
      if (dev?.outByte) dev.outByte(e, port, value);
    };
    return { inByte, outByte, read: inByte, write: outByte, raw };
  })();

  for (const d of (manifest.io?.devices ?? [])) {
    const F = await load(d.module);
    const size = Math.max(1, d.size >>> 0);
    const start = d.portStart >>> 0;
    const mask = size - 1;
    const inst = F(size, d);
    const read = inst.inByte ?? inst.readByte;
    const write = inst.outByte ?? inst.writeByte;
    const mapPort = (port) => d.absolutePorts ? (port & 0xffff) : ((port - start) & mask);
    ioDevices.push({
      ...d,
      ...inst,
      portStart: start,
      size,
      inByte: read ? (_e, port) => read(_e, mapPort(port)) : undefined,
      outByte: write ? (_e, port, v) => write(_e, mapPort(port), v) : undefined,
    });
  }

  const createCPU = await load(manifest.cpu.module ?? './cpu/z80.js');
  const cpuBase = typeof window !== 'undefined'
    ? new URL('../', manifestDir).href
    : (await import('url')).fileURLToPath(new URL('../', manifestDir));
  const cpu = await createCPU(manifest, cpuBase);
  if (cpu.cycles == null) cpu.cycles = 0;

  let audio = null;
  if (manifest.audio?.module) {
    const createAudio = await load(manifest.audio.module);
    audio = await createAudio(manifest.audio, manifest, modulesBase.href);
  }

  const emuState = {
    cpu,
    mmu,
    io,
    audio,
    devices: { memory: memDevices, io: ioDevices },
    manifest,
    baseURL: modulesBase.href,
    cycles: 0,
    resetMemoryInitialBytes: () => applyMemoryInitialBytes(emuState),
  };

  cpu.attach?.(emuState);

  if (manifest.video?.module) {
    try {
      emuState.video = await load(manifest.video.module);
    } catch {
      emuState.video = null;
    }
  } else {
    emuState.video = null;
  }

  return emuState;
};

export default createEmulatorFromManifestURL;
