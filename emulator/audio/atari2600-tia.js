const DEFAULT_VOLUME = 0.3;
const CPU_CLOCK_HZ = 1193191;
const AUDIO_PARTS = Object.freeze([
  { id: "channel0", label: "Channel 0" },
  { id: "channel1", label: "Channel 1" },
]);
const AUDIO_REGISTERS = Object.freeze({
  0x15: ["control", 0],
  0x16: ["control", 1],
  0x17: ["frequency", 0],
  0x18: ["frequency", 1],
  0x19: ["volume", 0],
  0x1a: ["volume", 1],
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const createAtari2600TIAAudio = (config = {}) => {
  let context = null;
  let master = null;
  let enabled = config.enabled !== false;
  let volume = clamp(Number(config.volume ?? DEFAULT_VOLUME) || DEFAULT_VOLUME, 0, 1);
  const partConfig = config.parts ?? {};
  const partEnabled = new Map(AUDIO_PARTS.map(({ id }) => [id, partConfig[id] !== false]));
  const channels = [
    { control: 0, frequency: 0, volume: 0, source: null, gain: null, noise: false },
    { control: 0, frequency: 0, volume: 0, source: null, gain: null, noise: false },
  ];

  const AudioContextClass = () => globalThis.AudioContext ?? globalThis.webkitAudioContext;

  const applyMasterVolume = () => {
    if (master) master.gain.value = enabled ? volume : 0;
  };

  const ensureContext = () => {
    const Ctor = AudioContextClass();
    if (!Ctor || !enabled) return null;
    if (!context) {
      context = new Ctor();
      master = context.createGain();
      applyMasterVolume();
      master.connect(context.destination);
    }
    return context;
  };

  const channelFrequency = (channel) => {
    const divisor = Math.max(1, channel.frequency + 1);
    const controlScale = 1 + ((channel.control & 0x03) * 0.35);
    return clamp(CPU_CLOCK_HZ / 114 / divisor / controlScale, 18, 12000);
  };

  const channelType = (channel) => {
    const mode = channel.control & 0x0f;
    if (mode === 0) return "silent";
    if ([0x01, 0x02, 0x03, 0x08].includes(mode)) return "noise";
    if ([0x04, 0x05, 0x0c, 0x0d].includes(mode)) return "triangle";
    return "square";
  };

  const stopChannel = (index) => {
    const channel = channels[index];
    if (!channel?.source) return;
    try {
      channel.source.stop();
    } catch {
      // The node may have already stopped.
    }
    channel.source = null;
    channel.gain = null;
    channel.noise = false;
  };

  const createNoiseBuffer = (seconds = 1) => {
    const ctx = ensureContext();
    if (!ctx) return null;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lfsr = 0x1ff;
    for (let i = 0; i < length; i += 1) {
      const bit = ((lfsr >> 0) ^ (lfsr >> 5)) & 1;
      lfsr = ((lfsr >> 1) | (bit << 8)) & 0x1ff;
      data[i] = (lfsr & 1) ? 0.75 : -0.75;
    }
    return buffer;
  };

  const startChannel = (index) => {
    const ctx = ensureContext();
    if (!ctx || !master) return;
    const channel = channels[index];
    const type = channelType(channel);
    const level = (channel.volume & 0x0f) / 15 * 0.22;
    if (!enabled || type === "silent" || level <= 0) {
      stopChannel(index);
      return;
    }

    const frequency = channelFrequency(channel);
    if (channel.source && channel.noise === (type === "noise")) {
      if (!channel.noise && channel.source.frequency) channel.source.frequency.setTargetAtTime(frequency, ctx.currentTime, 0.01);
      if (channel.gain) channel.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.01);
      return;
    }

    stopChannel(index);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(level, ctx.currentTime, 0.01);
    gain.connect(master);

    let source;
    if (type === "noise") {
      source = ctx.createBufferSource();
      source.buffer = createNoiseBuffer(1);
      source.loop = true;
      source.playbackRate.value = clamp(frequency / 420, 0.15, 8);
    } else {
      source = ctx.createOscillator();
      source.type = type;
      source.frequency.value = frequency;
    }
    source.connect(gain);
    source.start();
    channel.source = source;
    channel.gain = gain;
    channel.noise = type === "noise";
  };

  const updateChannel = (index) => {
    if (enabled && partEnabled.get("channel" + index) !== false) startChannel(index);
    else stopChannel(index);
  };

  const writeRegister = (register, value) => {
    const entry = AUDIO_REGISTERS[register & 0x3f];
    if (!entry) return;
    const [field, index] = entry;
    channels[index][field] = value & 0xff;
    updateChannel(index);
  };

  const restoreTIAState = (registers = []) => {
    for (const register of Object.keys(AUDIO_REGISTERS)) writeRegister(Number(register), registers[Number(register)] ?? 0);
  };

  const reset = () => {
    for (const channel of channels) {
      channel.control = 0;
      channel.frequency = 0;
      channel.volume = 0;
    }
    stopChannel(0);
    stopChannel(1);
  };

  const resume = async () => {
    const ctx = ensureContext();
    if (ctx?.state === "suspended") await ctx.resume();
    updateChannel(0);
    updateChannel(1);
  };

  const suspend = async () => {
    silence();
    if (context?.state === "running") await context.suspend();
  };

  const silence = () => {
    stopChannel(0);
    stopChannel(1);
  };

  const getControls = () => AUDIO_PARTS.map(({ id, label }) => ({
    id,
    label,
    enabled: partEnabled.get(id) !== false,
  }));

  const setControlEnabled = (part, next) => {
    const id = String(part ?? "");
    if (!partEnabled.has(id)) return getControls();
    partEnabled.set(id, Boolean(next));
    updateChannel(Number(id.slice("channel".length)));
    return getControls();
  };

  const setEnabled = (next) => {
    enabled = Boolean(next);
    if (!enabled) silence();
    else {
      ensureContext();
      updateChannel(0);
      updateChannel(1);
    }
    applyMasterVolume();
  };

  const setVolume = (next) => {
    volume = clamp(Number(next) || 0, 0, 1);
    applyMasterVolume();
  };

  reset();

  return {
    name: "Atari 2600 TIA simple audio",
    getControls,
    reset,
    resume,
    suspend,
    silence,
    writeRegister,
    restoreTIAState,
    getEnabled: () => enabled,
    setControlEnabled,
    setPartEnabled: setControlEnabled,
    setEnabled,
    setVolume,
    getDebugState: () => channels.map(({ control, frequency, volume }) => ({ control, frequency, volume })),
  };
};

export default createAtari2600TIAAudio;
