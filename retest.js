import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { createEmulatorFromManifestURL } from './emulator/create-emulator.js';

const cwdURL = pathToFileURL(path.resolve('./') + '/');
const baseURL = new URL('./emulator/', cwdURL);
const manifestURL = new URL('./platforms/z80.json5', baseURL);

console.log({ cwd: process.cwd(), baseURL: baseURL.href, manifestURL: manifestURL.href });

const emu = await createEmulatorFromManifestURL(manifestURL);

[0x3E,0x05,0xC6,0x08,0x00].forEach((b,i)=> emu.mmu.writeByte(emu, i, b));
emu.cpu.setRegister(emu,'pc',0x0000);
for (let i=0;i<3;i++){
  const pc = emu.cpu.getRegister(emu,'pc');
  const op = emu.mmu.readByte(emu, pc);
  emu.cpu.setRegister(emu,'pc', pc+1);
  const fn = emu.cpu.decoder.decode(emu, op);
  fn(emu);
}
console.log('A', emu.cpu.getRegister(emu,'a'));
