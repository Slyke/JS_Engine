const safeId = (value) => String(value ?? "").replace(/[^a-z0-9_-]/gi, "-");

const createCheckbox = ({ id, label, checked = false, disabled = false }) => {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = id;
  input.checked = Boolean(checked);
  input.disabled = Boolean(disabled);

  const text = document.createElement("span");
  text.textContent = label;

  const wrapper = document.createElement("label");
  wrapper.className = "choice choice-small";
  wrapper.htmlFor = id;
  wrapper.append(input, text);
  return { wrapper, input };
};

const createMidway8080AudioCard = () => {
  let container = null;
  let emu = null;
  let host = null;
  let masterInput = null;
  const partInputs = new Map();

  const audio = () => emu?.audio ?? null;
  const audioEnabled = () => audio()?.getEnabled?.() !== false;
  const controls = () => audio()?.getControls?.() ?? [];

  const sync = () => {
    const device = audio();
    const enabled = audioEnabled();
    if (masterInput) {
      masterInput.disabled = !device;
      masterInput.checked = Boolean(device && enabled);
    }
    for (const control of controls()) {
      const input = partInputs.get(String(control.id ?? ""));
      if (!input) continue;
      input.checked = control.enabled !== false;
      input.disabled = !enabled;
    }
  };

  const maybeResume = () => {
    if (audioEnabled() && host?.running) host?.resumeAudio?.();
  };

  const mount = (context) => {
    container = context.container;
    emu = context.emu;
    host = context.host;
    container.replaceChildren();
    partInputs.clear();

    const device = audio();
    if (!device) {
      const message = document.createElement("div");
      message.className = "platform-card-message";
      message.textContent = "Audio unavailable";
      container.appendChild(message);
      return;
    }

    const root = document.createElement("div");
    root.className = "platform-card-controls";

    const master = createCheckbox({ id: "debugger-audio-enabled", label: "Sound", checked: audioEnabled() });
    masterInput = master.input;
    master.input.addEventListener("change", () => {
      device.setEnabled?.(master.input.checked);
      if (master.input.checked) maybeResume();
      else host?.suspendAudio?.();
      sync();
    });
    root.appendChild(master.wrapper);

    const parts = document.createElement("div");
    parts.className = "platform-card-controls platform-card-controls-compact";
    for (const control of controls()) {
      const id = String(control.id ?? "");
      if (!id) continue;
      const part = createCheckbox({
        id: "debugger-audio-part-" + safeId(id),
        label: control.label ?? id,
        checked: control.enabled !== false,
        disabled: !audioEnabled(),
      });
      part.input.dataset.audioPart = id;
      part.input.addEventListener("change", () => {
        device.setControlEnabled?.(id, part.input.checked);
        maybeResume();
        sync();
      });
      partInputs.set(id, part.input);
      parts.appendChild(part.wrapper);
    }

    container.append(root, parts);
    sync();
  };

  return { mount, update: sync };
};

export default createMidway8080AudioCard;
