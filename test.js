import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { parseJSONLike } from './emulator/utils/loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configBaseDir = path.resolve(__dirname, 'emulator');
const configPath = path.join(configBaseDir, 'platforms/z80.json5');
const configRaw = await fs.readFile(configPath, 'utf-8');
const config = parseJSONLike(configRaw, configPath);

import setupZ80Memory from './emulator/memory/z80.js';
import createZ80CPU from './emulator/cpu/z80.js';



// Sample Z80 program:
// LD A, 5     ; 0x3E 0x05
// ADD A, 8    ; 0xC6 0x08
// NOP         ; 0x00
const program = [0x3E, 0x05, 0xC6, 0x08, 0x00];

const main = async () => {
  const { mmu, devices } = await setupZ80Memory(config, configBaseDir);
  const cpu = await createZ80CPU(config, configBaseDir);
  
  const emuState = { cpu, mmu, devices };
  console.log('emuState:', emuState);

  // Load program into RAM (start at 0x0000)
  program.forEach((byte, i) => {
    mmu.writeByte(emuState, i, byte);
  });

  // Set PC to 0x0000
  cpu.setRegister(emuState, 'pc', 0x0000);

  // Step through instructions
  for (let i = 0; i < 3; i++) {
    const pc = cpu.getRegister(emuState, 'pc');
    const opcode = mmu.readByte(emuState, pc);
    cpu.setRegister(emuState, 'pc', pc + 1); // increment before decode reads operands
    const instr = cpu.decoder.decode(emuState, opcode);
    instr(emuState); // execute instruction
  }

  // Output final value in A
  const a = cpu.getRegister(emuState, 'a');
  console.log(`A register: ${a} (0x${a.toString(16).padStart(2, '0')})`);
};

main().catch(err => console.error(err));
