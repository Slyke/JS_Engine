const DEFAULT_VOLUME = 0.28;
const SID_CLOCK_HZ = 1022727;
const SID_FREQ_DIVISOR = 16777216;

const AUDIO_PARTS = Object.freeze([
  { id: "voice1", label: "Voice 1" },
  { id: "voice2", label: "Voice 2" },
  { id: "voice3", label: "Voice 3" },
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const createVoiceState = () => ({
  freqLo: 0,
  freqHi: 0,
  pulseLo: 0,
  pulseHi: 0,
  control: 0,
  attackDecay: 0,
  sustainRelease: 0,
  oscillator: null,
  gain: null,
  enabled: true,
});

const sidFrequency = (voice) => {
  const reg = ((voice.freqHi << 8) | voice.freqLo) & 0xffff;
  return clamp((reg * SID_CLOCK_HZ) / SID_FREQ_DIVISOR, 1, 12000);
};

const waveformForControl = (control) => {
  if ((control & 0x20) !== 0) return "sawtooth";
  if ((control & 0x10) !== 0) return "triangle";
  return "square";
};

const createCommodore64SidAudio = (config = {}) => {
  let context = null;
  let master = null;
  let enabled = config.enabled !== false;
  let volume = clamp(Number(config.volume ?? DEFAULT_VOLUME) || DEFAULT_VOLUME, 0, 1);
  const registers = new Uint8Array(0x20);
  const voices = [createVoiceState(), createVoiceState(), createVoiceState()];
  const partEnabled = new Map(AUDIO_PARTS.map(({ id }) => [id, config.parts?.[id] !== false]));

  const AudioContextClass = () => globalThis.AudioContext ?? globalThis.webkitAudioContext;

  const applyMasterVolume = () => {
    if (master) master.gain.value = enabled ? volume * ((registers[0x18] & 0x0f) / 15 || 0) : 0;
  };

  const ensureContext = () => {
    const Ctor = AudioContextClass();
    if (!Ctor || !enabled) return null;
    if (!context) {
      context = new Ctor();
      master = context.createGain();
      master.connect(context.destination);
      applyMasterVolume();
    }
    return context;
  };

  const stopVoice = (index, immediate = false) => {
    const voice = voices[index];
    if (!voice?.oscillator) return;
    const now = context?.currentTime ?? 0;
    try {
      voice.gain?.gain.cancelScheduledValues(now);
      if (immediate) voice.gain.gain.value = 0;
      else voice.gain?.gain.setTargetAtTime(0, now, 0.025);
      voice.oscillator.stop(now + (immediate ? 0 : 0.08));
    } catch {
      // Some browsers throw if a node was already stopped.
    }
    voice.oscillator = null;
    voice.gain = null;
  };

  const startVoice = (index) => {
    const ctx = ensureContext();
    const voice = voices[index];
    if (!ctx || !master || !voice.enabled || !partEnabled.get("voice" + (index + 1))) return;
    if (voice.oscillator) return;
    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = waveformForControl(voice.control);
    oscillator.frequency.value = sidFrequency(voice);
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.32, now, 0.006);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(now);
    oscillator.addEventListener?.("ended", () => {
      if (voice.oscillator === oscillator) {
        voice.oscillator = null;
        voice.gain = null;
      }
    }, { once: true });
    voice.oscillator = oscillator;
    voice.gain = gain;
  };

  const updateVoice = (index) => {
    const voice = voices[index];
    if (!voice) return;
    const gate = (voice.control & 0x01) !== 0;
    const partOn = partEnabled.get("voice" + (index + 1)) !== false;
    if (!enabled || !gate || !partOn) {
      stopVoice(index);
      return;
    }
    startVoice(index);
    if (voice.oscillator) {
      const now = context?.currentTime ?? 0;
      voice.oscillator.type = waveformForControl(voice.control);
      voice.oscillator.frequency.setTargetAtTime(sidFrequency(voice), now, 0.008);
    }
  };

  const updateAllVoices = () => {
    applyMasterVolume();
    for (let index = 0; index < voices.length; index += 1) updateVoice(index);
  };

  const writeRegister = (register, value) => {
    const reg = register & 0x1f;
    const next = value & 0xff;
    registers[reg] = next;
    if (reg <= 0x14) {
      const index = Math.floor(reg / 7);
      const slot = reg % 7;
      const voice = voices[index];
      if (voice) {
        if (slot === 0) voice.freqLo = next;
        else if (slot === 1) voice.freqHi = next;
        else if (slot === 2) voice.pulseLo = next;
        else if (slot === 3) voice.pulseHi = next;
        else if (slot === 4) voice.control = next;
        else if (slot === 5) voice.attackDecay = next;
        else if (slot === 6) voice.sustainRelease = next;
        updateVoice(index);
      }
    } else if (reg === 0x18) {
      applyMasterVolume();
    }
  };

  const reset = () => {
    registers.fill(0);
    for (let index = 0; index < voices.length; index += 1) {
      stopVoice(index, true);
      Object.assign(voices[index], createVoiceState(), { enabled: voices[index].enabled });
    }
  };

  const resume = async () => {
    const ctx = ensureContext();
    if (ctx?.state === "suspended") await ctx.resume();
    updateAllVoices();
  };

  const suspend = async () => {
    if (context?.state === "running") await context.suspend();
  };

  const silence = () => {
    for (let index = 0; index < voices.length; index += 1) stopVoice(index, true);
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
    updateAllVoices();
    return getControls();
  };

  const setEnabled = (next) => {
    enabled = Boolean(next);
    if (!enabled) silence();
    else updateAllVoices();
    applyMasterVolume();
  };

  const setVolume = (next) => {
    volume = clamp(Number(next) || 0, 0, 1);
    applyMasterVolume();
  };

  return {
    name: "Commodore 64 SID-compatible simple audio",
    getControls,
    reset,
    resume,
    suspend,
    silence,
    getEnabled: () => enabled,
    setControlEnabled,
    setPartEnabled: setControlEnabled,
    setEnabled,
    setVolume,
    writeRegister,
    registers,
  };
};

export default createCommodore64SidAudio;
