import { parseJSONLike } from './utils/loader.js';

export const loadCPU = async (cpuConfigPath, memory) => {
  let config;
  if (typeof window !== 'undefined') {
    const res = await fetch(cpuConfigPath);
    config = parseJSONLike(await res.text(), cpuConfigPath);
  } else {
    const fs = await import('fs/promises');
    const path = await import('path');
    const __dirname = path.dirname(new URL(import.meta.url).pathname);
    const raw = await fs.readFile(path.join(__dirname, cpuConfigPath), 'utf-8');
    config = parseJSONLike(raw, cpuConfigPath);
  }

  const [RegMod, ALUMod, CtrlMod, DecoderMod] = await Promise.all([
    import(config.cpu.registers),
    import(config.cpu.alu),
    import(config.cpu.control),
    import(config.cpu.decoder),
  ]);

  const registers = RegMod.default();
  const control = CtrlMod.default();
  const alu = ALUMod.default({
    getRegister: registers.getRegister,
    setRegister: registers.setRegister,
    flagDefs: {
      carry: 0x01,
      parity: 0x04,
      halfcarry: 0x10,
      interrupt: 0x20,
      zero: 0x40,
      sign: 0x80
    }
  });
  const decoder = DecoderMod.default();

  return {
    name: 'z80',
    type: 'cpu',
    registers: registers.registers,
    getRegister: registers.getRegister,
    setRegister: registers.setRegister,
    pins: control.pins,
    setPins: control.setPins,
    clearPins: control.clearPins,
    alu,
    decoder
  };
};
