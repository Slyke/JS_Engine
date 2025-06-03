import create6510CPU from "./6510.js";

const create6507CPU = async (manifest = {}, baseURL = "") => {
  const cpu = await create6510CPU(manifest, baseURL);
  const clockHz = Math.max(1, Number(manifest.cpu?.clockHz ?? 1193191) || 1193191);
  const fps = Math.max(1, Number(manifest.video?.fps ?? 60) || 60);
  const runsPerHostFrame = Math.max(1, Number(manifest.cpu?.runsPerHostFrame ?? 2) || 2);
  const defaultCyclesPerRun = Math.max(1, Math.round(clockHz / fps / runsPerHostFrame));
  const defaultInstructionLimit = Math.max(1, Number(manifest.cpu?.maxInstructionsPerRun ?? 7000) || 7000);

  cpu.name = "MOS 6507";
  cpu.addressBits = 13;
  cpu.runUntilInterrupt = (emuState, cycleBudget = manifest.cpu?.cyclesPerRun ?? defaultCyclesPerRun) => {
    const targetCycles = Math.max(1, Number(cycleBudget) || defaultCyclesPerRun);
    const instructionLimit = Math.max(1, Number(manifest.cpu?.maxInstructionsPerRun ?? defaultInstructionLimit) || defaultInstructionLimit);
    const startCycles = cpu.cycles;
    let count = 0;

    while (count < instructionLimit && (cpu.cycles - startCycles) < targetCycles) {
      cpu.step(emuState);
      count += 1;
      if (emuState?.debugBreakRequested) break;
      if (cpu.getDebugState?.({ historyLength: 0 })?.halted) break;
    }

    const debug = cpu.getDebugState?.({ historyLength: 0 }) ?? {};
    return {
      instructions: count,
      cycles: cpu.cycles - startCycles,
      cycleRollover: (cpu.cycles - startCycles) >= targetCycles,
      halted: Boolean(debug.halted),
    };
  };
  return cpu;
};

export default create6507CPU;
