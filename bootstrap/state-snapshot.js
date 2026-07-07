export const bytesToBase64 = (bytes) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

export const base64ToBytes = (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

const downloadJson = (filename, payload) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
};

const cloneStatePayload = (payload) => JSON.parse(JSON.stringify(payload));

export const createStateSnapshots = ({
  clearFocusPaused,
  getEmu,
  getLoadedFiles,
  getManifestPath,
  getRawMemory,
  getRunning,
  refs,
  refreshMemoryViews,
  releaseAllInputs,
  setLoadedFiles,
  setRunning,
  setStatus,
}) => {
  let savedStatePayload = null;
  let savedStateSource = null;

  const cacheStatePayload = (payload, source) => {
    savedStatePayload = cloneStatePayload(payload);
    savedStateSource = source;
  };

  const createMemoryDeviceSnapshots = () => (getEmu().devices.memory ?? []).map((device, index) => {
    const emu = getEmu();
    if (typeof device.serializeState === "function") {
      const state = device.serializeState(emu);
      return {
        index,
        type: device.type ?? null,
        label: device.label ?? null,
        state,
        byteLength: Number(state?.byteLength) || 0,
      };
    }
    if (device.raw) {
      return {
        index,
        type: device.type ?? null,
        label: device.label ?? null,
        raw: bytesToBase64(device.raw),
        byteLength: device.raw.length,
      };
    }
    return null;
  }).filter(Boolean);

  const restoreMemoryDeviceSnapshots = (snapshots = []) => {
    const emu = getEmu();
    let restored = 0;
    for (const snapshot of snapshots) {
      const device = emu.devices.memory?.[snapshot.index];
      if (!device) continue;
      if (snapshot.state && typeof device.restoreState === "function") {
        device.restoreState(emu, snapshot.state);
        restored += 1;
      } else if (snapshot.raw && device.raw) {
        const bytes = base64ToBytes(snapshot.raw);
        device.raw.fill(0);
        device.raw.set(bytes.subarray(0, device.raw.length));
        restored += 1;
      }
    }
    return restored;
  };

  const createStatePayload = () => {
    const emu = getEmu();
    const raw = getRawMemory();
    if (!emu.cpu.serializeState) throw new Error("This CPU does not support state snapshots yet");
    const memoryDevices = createMemoryDeviceSnapshots();
    if (!memoryDevices.length && !raw) throw new Error("No memory device is available for state snapshots");
    const memoryLength = memoryDevices.length
      ? memoryDevices.reduce((sum, snapshot) => sum + (Number(snapshot.byteLength) || 0), 0)
      : raw.length;
    return {
      payload: {
        version: 1,
        manifest: emu.manifest.name ?? getManifestPath(),
        savedAt: new Date().toISOString(),
        running: getRunning(),
        loadedFiles: getLoadedFiles().slice(),
        cpu: emu.cpu.serializeState(),
        memory: raw ? bytesToBase64(raw) : null,
        memoryDevices,
      },
      memoryLength,
    };
  };

  const saveState = () => {
    const emu = getEmu();
    const slug = String(emu.manifest.name ?? "emulator").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "emulator";
    const filename = slug + "-state.json";
    const { payload, memoryLength } = createStatePayload();
    cacheStatePayload(payload, filename);
    downloadJson(filename, payload);
    setStatus(["Saved state to " + filename, "Cached for quick Load State", "Memory: " + memoryLength + " bytes"]);
  };

  const applyStatePayload = (payload, source, extraStatusLine = null, options = {}) => {
    const emu = getEmu();
    if (!payload || typeof payload !== "object") throw new Error("Invalid state payload");
    const snapshot = cloneStatePayload(payload);
    if (!snapshot.memory && !Array.isArray(snapshot.memoryDevices)) throw new Error("State file is missing memory data");
    if (!emu.cpu.restoreState) throw new Error("This CPU does not support state restore yet");
    let restoredBytes = 0;
    if (Array.isArray(snapshot.memoryDevices) && snapshot.memoryDevices.length) {
      const restoredDevices = restoreMemoryDeviceSnapshots(snapshot.memoryDevices);
      if (!restoredDevices) throw new Error("State file memory devices do not match this platform");
      restoredBytes = snapshot.memoryDevices.reduce((sum, entry) => sum + (Number(entry.byteLength) || 0), 0);
    } else {
      const raw = getRawMemory();
      if (!raw) throw new Error("No raw memory device is available for state restore");
      const bytes = base64ToBytes(snapshot.memory);
      raw.fill(0);
      raw.set(bytes.subarray(0, raw.length));
      restoredBytes = Math.min(bytes.length, raw.length);
    }
    emu.cpu.restoreState(snapshot.cpu);
    if (Array.isArray(snapshot.loadedFiles)) setLoadedFiles(snapshot.loadedFiles.slice());
    const shouldResume = Boolean(options.resumeAfterLoad) && !refs["autopause"]?.checked;
    emu?.audio?.restorePortState?.(snapshot.cpu?.outputPorts, { playing: shouldResume });
    releaseAllInputs();
    clearFocusPaused();
    refreshMemoryViews();
    setRunning(shouldResume);
    setStatus([
      "Loaded state from " + source,
      "Memory: " + restoredBytes + " bytes",
      shouldResume ? "Resumed running state" : null,
      extraStatusLine,
    ].filter(Boolean));
  };

  const loadSavedState = (options = {}) => {
    if (!savedStatePayload) throw new Error("No state is saved in browser memory. Save a state or load one from disk first.");
    applyStatePayload(savedStatePayload, (savedStateSource ?? "browser memory") + " (cached)", null, options);
  };

  const loadStateFile = async (file, options = {}) => {
    if (!file) return;
    const payload = JSON.parse(await file.text());
    applyStatePayload(payload, file.name, "Cached for quick Load State", options);
    cacheStatePayload(payload, file.name);
  };

  return {
    loadSavedState,
    loadStateFile,
    saveState,
  };
};
