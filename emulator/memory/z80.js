import { toBaseURL, resolveURL, dynImport } from '../utils/loader.js';

const setupZ80Memory = async (config, configBase = '.') => {
  const baseURL = await toBaseURL(configBase);

  const loadModule = async (relativePath) => {
    const href = resolveURL(relativePath, baseURL);
    return dynImport(href);
  };

  const mmuFactory = await loadModule(config.memory.mmu);

  const memDevices = [];
  for (const dev of config.memory.devices) {
    const modFactory = await loadModule(dev.module);
    const instance = modFactory(dev.size);
    memDevices.push({
      ...dev,
      readByte: instance.readByte,
      writeByte: instance.writeByte,
    });
  }

  const mmu = mmuFactory(memDevices);
  return {
    mmu,
    devices: memDevices
  };
};

export default setupZ80Memory;
