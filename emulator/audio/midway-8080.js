const DEFAULT_VOLUME = 0.35;

const AUDIO_PARTS = Object.freeze([
  { id: 'p3b0', label: 'Port 3 Bit 0' },
  { id: 'p3b1', label: 'Port 3 Bit 1' },
  { id: 'p3b2', label: 'Port 3 Bit 2' },
  { id: 'p3b3', label: 'Port 3 Bit 3' },
  { id: 'p3b4', label: 'Port 3 Bit 4' },
  { id: 'p5b0', label: 'Port 5 Bit 0' },
  { id: 'p5b1', label: 'Port 5 Bit 1' },
  { id: 'p5b2', label: 'Port 5 Bit 2' },
  { id: 'p5b3', label: 'Port 5 Bit 3' },
  { id: 'p5b4', label: 'Port 5 Bit 4' },
]);

const SOUND_BITS = Object.freeze({
  0x03: [
    { bit: 0, name: 'p3b0', part: 'p3b0', loop: true, type: 'ufo' },
    { bit: 1, name: 'p3b1', part: 'p3b1', type: 'shot' },
    { bit: 2, name: 'p3b2', part: 'p3b2', type: 'playerDie' },
    { bit: 3, name: 'p3b3', part: 'p3b3', type: 'invaderDie' },
    { bit: 4, name: 'p3b4', part: 'p3b4', type: 'extraLife' },
  ],
  0x05: [
    { bit: 0, name: 'p5b0', part: 'p5b0', type: 'fleet', frequency: 78 },
    { bit: 1, name: 'p5b1', part: 'p5b1', type: 'fleet', frequency: 66 },
    { bit: 2, name: 'p5b2', part: 'p5b2', type: 'fleet', frequency: 58 },
    { bit: 3, name: 'p5b3', part: 'p5b3', type: 'fleet', frequency: 52 },
    { bit: 4, name: 'p5b4', part: 'p5b4', type: 'ufoHit' },
  ],
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const createMidway8080Audio = (config = {}) => {
  let context = null;
  let master = null;
  let enabled = config.enabled !== false;
  let volume = clamp(Number(config.volume ?? DEFAULT_VOLUME) || DEFAULT_VOLUME, 0, 1);
  const ports = new Uint8Array(0x100);
  const loops = new Map();
  const activeSources = new Set();
  const pendingTimers = new Set();
  const partConfig = config.parts ?? {};
  const partEnabled = new Map(AUDIO_PARTS.map(({ id }) => [id, partConfig[id] !== false]));

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

  const resume = async () => {
    const ctx = ensureContext();
    if (ctx?.state === 'suspended') await ctx.resume();
    startLatchedLoops();
  };

  const suspend = async () => {
    if (context?.state === 'running') await context.suspend();
  };

  const trackSource = (source) => {
    activeSources.add(source);
    source.addEventListener?.('ended', () => activeSources.delete(source), { once: true });
    return source;
  };

  const scheduleTimer = (callback, delay) => {
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      callback();
    }, delay);
    pendingTimers.add(timer);
    return timer;
  };

  const clearPendingTimers = () => {
    for (const timer of pendingTimers) clearTimeout(timer);
    pendingTimers.clear();
  };

  const stopActiveSources = () => {
    for (const source of Array.from(activeSources)) {
      try {
        source.stop();
      } catch {
        // Some browsers throw if a node has already been stopped.
      }
    }
    activeSources.clear();
  };

  const stopLoop = (name, immediate = false) => {
    const voice = loops.get(name);
    if (!voice) return;
    const now = context?.currentTime ?? 0;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      if (immediate) {
        voice.gain.gain.value = 0;
        for (const source of voice.sources) source.stop();
      } else {
        voice.gain.gain.setTargetAtTime(0, now, 0.025);
        for (const source of voice.sources) source.stop(now + 0.08);
      }
    } catch {
      // Some browsers throw if a node has already been stopped.
    }
    loops.delete(name);
  };

  const stopAllLoops = (immediate = false) => {
    for (const name of Array.from(loops.keys())) stopLoop(name, immediate);
  };

  const stopAllSounds = () => {
    clearPendingTimers();
    stopActiveSources();
    stopAllLoops(true);
  };

  const startLatchedLoops = () => {
    if (!enabled) return;
    for (const [port, events] of Object.entries(SOUND_BITS)) {
      const value = ports[Number(port) & 0xff];
      for (const event of events) {
        const mask = 1 << event.bit;
        if (event.loop && (value & mask) !== 0 && isPartEnabled(event.part)) playEffect(event);
      }
    }
  };

  const restorePortState = (outputPorts = [], options = {}) => {
    stopAllSounds();
    ports.fill(0);
    if (Array.isArray(outputPorts) || ArrayBuffer.isView(outputPorts)) {
      const length = Math.min(outputPorts.length, ports.length);
      for (let i = 0; i < length; i += 1) ports[i] = outputPorts[i] & 0xff;
    }
    if (options.playing) startLatchedLoops();
  };

  const isPartEnabled = (part) => partEnabled.get(part) !== false;

  const getControls = () => AUDIO_PARTS.map(({ id, label }) => ({
    id,
    label,
    enabled: isPartEnabled(id),
  }));

  const setControlEnabled = (part, next) => {
    const id = String(part ?? '');
    if (!partEnabled.has(id)) return getControls();
    const shouldEnable = Boolean(next);
    partEnabled.set(id, shouldEnable);
    if (!shouldEnable && id === 'p3b0') stopLoop('p3b0', true);
    if (shouldEnable && id === 'p3b0' && enabled && (ports[0x03] & 0x01)) startUfo();
    return getControls();
  };

  const setEnabled = (next) => {
    enabled = Boolean(next);
    if (!enabled) stopAllSounds();
    else {
      ensureContext();
      startLatchedLoops();
    }
    applyMasterVolume();
  };

  const getEnabled = () => enabled;

  const setVolume = (next) => {
    volume = clamp(Number(next) || 0, 0, 1);
    applyMasterVolume();
  };

  const makeGain = (level, attack = 0.004) => {
    const ctx = ensureContext();
    if (!ctx || !master) return null;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    gain.gain.setTargetAtTime(level, ctx.currentTime, attack);
    return gain;
  };

  const playTone = ({ frequency, duration, level = 0.28, type = 'square', endFrequency = null }) => {
    const ctx = ensureContext();
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = makeGain(level);
    if (!gain) return;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency != null) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
    gain.gain.setTargetAtTime(0, now + duration * 0.72, duration * 0.08);
    oscillator.connect(gain);
    trackSource(oscillator);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.08);
  };

  const makeNoiseBuffer = (duration, decay = 1) => {
    const ctx = ensureContext();
    if (!ctx) return null;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const envelope = Math.pow(1 - (i / length), decay);
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
    return buffer;
  };

  const playNoise = ({ duration, level = 0.22, playbackRate = 1, decay = 1.2, filter = null }) => {
    const ctx = ensureContext();
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const buffer = makeNoiseBuffer(duration, decay);
    const gain = makeGain(level, 0.002);
    if (!buffer || !gain) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    let output = source;
    if (filter) {
      const biquad = ctx.createBiquadFilter();
      biquad.type = filter.type;
      biquad.frequency.value = filter.frequency;
      biquad.Q.value = filter.q ?? 0.8;
      output.connect(biquad);
      output = biquad;
    }
    gain.gain.setTargetAtTime(0, now + duration * 0.58, duration * 0.12);
    output.connect(gain);
    trackSource(source);
    source.start(now);
    source.stop(now + duration + 0.08);
  };

  const startUfo = () => {
    const ctx = ensureContext();
    if (!ctx || !master || loops.has('p3b0')) return;
    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const wobble = ctx.createOscillator();
    const wobbleGain = ctx.createGain();
    const gain = makeGain(0.13, 0.035);
    if (!gain) return;
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = 84;
    wobble.type = 'sine';
    wobble.frequency.value = 5.2;
    wobbleGain.gain.value = 28;
    wobble.connect(wobbleGain);
    wobbleGain.connect(oscillator.frequency);
    oscillator.connect(gain);
    oscillator.start(now);
    wobble.start(now);
    loops.set('p3b0', { sources: [oscillator, wobble], gain });
  };

  const playEffect = (event) => {
    switch (event.type) {
      case 'ufo':
        startUfo();
        break;
      case 'shot':
        playTone({ frequency: 760, endFrequency: 115, duration: 0.22, level: 0.22, type: 'square' });
        break;
      case 'playerDie':
        playNoise({ duration: 0.72, level: 0.32, playbackRate: 0.72, decay: 0.65, filter: { type: 'lowpass', frequency: 900, q: 2 } });
        playTone({ frequency: 140, endFrequency: 35, duration: 0.58, level: 0.2, type: 'sawtooth' });
        break;
      case 'invaderDie':
        playNoise({ duration: 0.18, level: 0.24, playbackRate: 1.35, decay: 1.5, filter: { type: 'bandpass', frequency: 1200, q: 1.6 } });
        break;
      case 'extraLife':
        playTone({ frequency: 523, duration: 0.12, level: 0.16, type: 'square' });
        scheduleTimer(() => {
          if (isPartEnabled('p3b4')) playTone({ frequency: 784, duration: 0.16, level: 0.14, type: 'square' });
        }, 75);
        break;
      case 'fleet':
        playTone({ frequency: event.frequency, duration: 0.12, level: 0.2, type: 'square' });
        break;
      case 'ufoHit':
        stopLoop('p3b0');
        playNoise({ duration: 0.48, level: 0.3, playbackRate: 0.9, decay: 0.85, filter: { type: 'bandpass', frequency: 560, q: 1.2 } });
        playTone({ frequency: 260, endFrequency: 72, duration: 0.35, level: 0.16, type: 'triangle' });
        break;
      default:
        break;
    }
  };

  const writePort = (_emuState, port, value) => {
    const p = port & 0xff;
    const v = value & 0xff;
    const previous = ports[p];
    ports[p] = v;
    const events = SOUND_BITS[p];
    if (!events || !enabled) return;
    for (const event of events) {
      const mask = 1 << event.bit;
      const wasOn = (previous & mask) !== 0;
      const isOn = (v & mask) !== 0;
      if (isOn && !wasOn && isPartEnabled(event.part)) playEffect(event);
      if (!isOn && wasOn && event.loop) stopLoop(event.name);
    }
  };

  const reset = () => {
    ports.fill(0);
    stopAllSounds();
  };

  return {
    name: 'Midway 8080 discrete audio',
    getControls,
    reset,
    resume,
    suspend,
    silence: stopAllSounds,
    restorePortState,
    getEnabled,
    setControlEnabled,
    setPartEnabled: setControlEnabled,
    setEnabled,
    setVolume,
    writePort,
  };
};

export default createMidway8080Audio;
