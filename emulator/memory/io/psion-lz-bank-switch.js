const findBankedMemory = (emuState) => (emuState?.devices?.memory ?? [])
  .find((device) => typeof device.resetBanks === "function") ?? null;

const createPsionLzBankSwitch = (_size = 1, options = {}) => {
  const role = String(options.role ?? "reset");

  const trigger = (emuState) => {
    const memory = findBankedMemory(emuState);
    if (!memory) return;
    if (role === "nextRam") memory.nextRamBank?.();
    else if (role === "nextRom") memory.nextRomBank?.();
    else memory.resetBanks?.();
  };

  return {
    readByte: (emuState) => {
      trigger(emuState);
      return 0;
    },
    peekByte: () => 0,
    writeByte: (emuState) => {
      trigger(emuState);
    },
  };
};

export default createPsionLzBankSwitch;
