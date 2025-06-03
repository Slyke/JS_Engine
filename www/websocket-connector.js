const PROTOCOL_VERSION = 1;

const bytesToHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const bytesFromHex = (value) => {
  const clean = String(value ?? "").replace(/[^0-9a-f]/gi, "");
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(clean.slice(i * 2, (i * 2) + 2), 16) & 0xff;
  return bytes;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isOpenSocket = (socket) => socket?.readyState === WebSocket.OPEN;

export const createWebSocketConnector = (context) => {
  const refs = context.refs;
  let endpoints = [];
  let selectedEndpointId = "";
  let rules = [];
  let nextRuleId = 1;
  let lastRuleHit = null;
  const connections = new Map();

  const emu = () => context.getEmu();

  const normalizeEndpoints = (config = {}) => {
    if (typeof WebSocket === "undefined" || config?.enabled === false) return [];
    const raw = Array.isArray(config.endpoints) ? config.endpoints : [];
    const normalized = raw.map((endpoint, index) => {
      const id = String(endpoint?.id ?? endpoint?.name ?? "endpoint-" + String(index + 1)).trim();
      const url = String(endpoint?.url ?? endpoint?.href ?? "").trim();
      if (!id || !url) return null;
      return {
        id,
        label: String(endpoint?.label ?? endpoint?.name ?? id),
        url,
        autoConnect: Boolean(endpoint?.autoConnect ?? config.autoConnect),
        channels: Array.isArray(endpoint?.channels) ? endpoint.channels.map(String) : [],
      };
    }).filter(Boolean);

    if (!normalized.length && config?.url) {
      normalized.push({
        id: "debug",
        label: String(config.label ?? "Debug API"),
        url: String(config.url),
        autoConnect: Boolean(config.autoConnect),
        channels: ["commands", "events", "rules"],
      });
    }
    return normalized;
  };

  const endpointById = (id) => endpoints.find((endpoint) => endpoint.id === id) ?? null;
  const selectedEndpoint = () => endpointById(selectedEndpointId) ?? endpoints[0] ?? null;

  const stateFor = (endpoint) => {
    if (!connections.has(endpoint.id)) {
      connections.set(endpoint.id, { endpoint, socket: null, status: "idle", lastError: "" });
    }
    const state = connections.get(endpoint.id);
    state.endpoint = endpoint;
    return state;
  };

  const endpointIsOpen = (endpointId) => isOpenSocket(connections.get(endpointId)?.socket);

  const populateEndpointSelect = (select, includeAll = false) => {
    if (!select) return;
    const current = select.value;
    select.innerHTML = "";
    if (includeAll) {
      const option = document.createElement("option");
      option.value = "*";
      option.textContent = "All connected endpoints";
      select.appendChild(option);
    }
    for (const endpoint of endpoints) {
      const option = document.createElement("option");
      option.value = endpoint.id;
      option.textContent = endpoint.label;
      select.appendChild(option);
    }
    if (current && Array.from(select.options).some((option) => option.value === current)) select.value = current;
    else select.value = includeAll ? "*" : (selectedEndpointId || endpoints[0]?.id || "");
  };

  const statusText = () => {
    if (typeof WebSocket === "undefined") return "WebSocket unavailable";
    if (!endpoints.length) return "No endpoints";
    return endpoints.map((endpoint) => {
      const state = connections.get(endpoint.id);
      return endpoint.label + ": " + (endpointIsOpen(endpoint.id) ? "open" : (state?.status ?? "idle"));
    }).join(" | ");
  };

  const renderRules = () => {
    const list = refs["websocket-rule-list"];
    if (!list) return;
    list.innerHTML = "";
    if (!rules.length) {
      list.textContent = "No websocket rules";
      return;
    }
    for (const rule of rules) {
      const button = document.createElement("button");
      button.className = "button button-ghost";
      button.type = "button";
      button.textContent = describeRule(rule) + " x";
      button.addEventListener("click", () => removeRule(rule.id));
      list.appendChild(button);
    }
  };

  const renderControls = () => {
    const controls = refs["websocket-controls"];
    if (!controls) return;
    const available = endpoints.length > 0 && typeof WebSocket !== "undefined";
    controls.hidden = !available;
    if (!available) return;

    if (!selectedEndpointId || !endpointById(selectedEndpointId)) selectedEndpointId = endpoints[0].id;
    populateEndpointSelect(refs["websocket-endpoint"]);
    populateEndpointSelect(refs["websocket-rule-endpoint"], true);
    if (refs["websocket-endpoint"]) refs["websocket-endpoint"].value = selectedEndpointId;

    const endpoint = selectedEndpoint();
    if (refs["websocket-url"] && endpoint) refs["websocket-url"].value = endpoint.url;
    const connected = endpoint ? endpointIsOpen(endpoint.id) : false;
    if (refs["btn-websocket-connect"]) {
      refs["btn-websocket-connect"].textContent = connected ? "Disconnect" : "Connect";
      refs["btn-websocket-connect"].classList.toggle("active", connected);
      refs["btn-websocket-connect"].setAttribute("aria-pressed", String(connected));
    }
    if (refs["websocket-status"]) refs["websocket-status"].textContent = statusText();
    renderRules();
  };

  const configureFromManifest = () => {
    for (const state of connections.values()) {
      if (state.socket && state.socket.readyState <= WebSocket.OPEN) state.socket.close(1000, "platform changed");
    }
    connections.clear();
    endpoints = normalizeEndpoints(emu()?.manifest?.websocket ?? emu()?.manifest?.externalConnections?.websocket ?? {});
    selectedEndpointId = endpoints[0]?.id ?? "";
    renderControls();
  };

  const helloPayload = (endpoint) => ({
    type: "hello",
    version: PROTOCOL_VERSION,
    endpoint: endpoint.id,
    platform: {
      id: context.selectedPlatform.id,
      label: context.selectedPlatform.label,
      manifest: context.manifestPath,
      name: emu()?.manifest?.name ?? context.selectedPlatform.label,
    },
    capabilities: [
      "ping", "emulator.run", "emulator.pause", "emulator.step", "emulator.reset",
      "input.press", "input.release", "input.pulse", "input.type",
      "memory.read", "memory.write", "memory.dump",
      "registers.get", "registers.set", "state.get",
      "rules.add", "rules.remove", "rules.clear", "rules.list",
    ],
  });

  const send = (endpointId, payload) => {
    const targetIds = endpointId === "*"
      ? endpoints.filter((endpoint) => endpointIsOpen(endpoint.id)).map((endpoint) => endpoint.id)
      : [endpointId];
    let sent = 0;
    for (const targetId of targetIds) {
      const socket = connections.get(targetId)?.socket;
      if (!isOpenSocket(socket)) continue;
      socket.send(JSON.stringify(payload));
      sent += 1;
    }
    return sent;
  };

  const respond = (endpointId, requestId, ok, payload) => send(endpointId, ok
    ? { type: "response", version: PROTOCOL_VERSION, requestId, ok: true, result: payload }
    : { type: "response", version: PROTOCOL_VERSION, requestId, ok: false, error: payload });

  const emitEvent = (event, payload, endpointId = "*") => send(endpointId, {
    type: "event",
    version: PROTOCOL_VERSION,
    event,
    emittedAt: new Date().toISOString(),
    payload,
  });

  const connect = (endpointId, overrideUrl = null) => {
    const endpoint = endpointById(endpointId);
    if (!endpoint) throw new Error("Unknown websocket endpoint: " + endpointId);
    const state = stateFor(endpoint);
    if (state.socket && state.socket.readyState <= WebSocket.OPEN) return;
    if (overrideUrl) endpoint.url = String(overrideUrl).trim();

    state.status = "connecting";
    state.lastError = "";
    const socket = new WebSocket(endpoint.url);
    state.socket = socket;
    renderControls();

    socket.addEventListener("open", () => {
      state.status = "open";
      send(endpoint.id, helloPayload(endpoint));
      renderControls();
      context.setStatus(["WebSocket connected", endpoint.label + " -> " + endpoint.url]);
    });
    socket.addEventListener("message", (event) => handleRawMessage(endpoint, event.data).catch((error) => {
      respond(endpoint.id, null, false, { message: error.message || String(error) });
    }));
    socket.addEventListener("close", () => {
      state.status = "closed";
      state.socket = null;
      renderControls();
    });
    socket.addEventListener("error", () => {
      state.status = "error";
      state.lastError = "Connection error";
      renderControls();
    });
  };

  const disconnect = (endpointId) => {
    const state = connections.get(endpointId);
    if (!state?.socket) return;
    state.socket.close(1000, "manual disconnect");
    state.socket = null;
    state.status = "closed";
    renderControls();
  };

  const toggleSelected = () => {
    const endpoint = selectedEndpoint();
    if (!endpoint) return;
    if (endpointIsOpen(endpoint.id)) disconnect(endpoint.id);
    else connect(endpoint.id, refs["websocket-url"]?.value);
  };

  const startAutoConnections = () => {
    for (const endpoint of endpoints) {
      if (!endpoint.autoConnect) continue;
      try {
        connect(endpoint.id);
      } catch (error) {
        console.warn("Failed to auto-connect websocket endpoint", endpoint.id, error);
      }
    }
  };

  const bytesForCommand = (params = {}) => {
    if (Array.isArray(params.bytes)) return Uint8Array.from(params.bytes.map(context.toByte));
    if (params.base64 != null) return context.base64ToBytes(String(params.base64));
    if (params.hex != null) return bytesFromHex(params.hex);
    if (params.value != null) return Uint8Array.of(context.toByte(context.parseNumber(params.value)));
    return new Uint8Array(0);
  };

  const encodeBytes = (bytes, format = "hex") => {
    const normalized = String(format ?? "hex").toLowerCase();
    if (normalized === "array" || normalized === "bytes") return { format: "array", bytes: Array.from(bytes) };
    if (normalized === "base64") return { format: "base64", base64: context.bytesToBase64(bytes) };
    return { format: "hex", hex: bytesToHex(bytes) };
  };

  const readMemory = (address, length) => context.withWatchIgnore(() => {
    const start = context.normalizeMemoryAddress(address);
    const count = Math.max(0, Math.min(context.memoryAddressSpaceSize(), Math.trunc(Number(length) || 0)));
    const bytes = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) bytes[i] = emu().mmu.readByte(emu(), context.normalizeMemoryAddress(start + i));
    return { start, bytes };
  });

  const writeMemory = (address, bytes) => context.withWatchIgnore(() => {
    const start = context.normalizeMemoryAddress(address);
    const touched = [];
    for (let i = 0; i < bytes.length; i += 1) {
      const target = context.normalizeMemoryAddress(start + i);
      emu().mmu.writeByte(emu(), target, bytes[i]);
      if (context.isVideoAddress(target)) context.markVideoAddress(target);
      touched.push(target);
    }
    return { start, touched };
  });

  const refreshAfterExternalWrite = () => {
    context.renderVideo();
    context.refreshMemoryEditors();
    context.updateDebugger(true);
  };

  const debugSnapshot = () => {
    const debug = emu().cpu.getDebugState();
    return {
      cpu: debug.name,
      registers: debug.registers,
      flags: debug.flags,
      totalCycles: debug.totalCycles,
      instructionCount: debug.instructionCount,
      lastOpcode: debug.lastOpcode,
      lastAddress: debug.lastAddress,
      halted: debug.halted,
      haltedReason: debug.haltedReason,
    };
  };

  const inputForTextChar = (char) => {
    const map = emu()?.manifest?.controls?.textInputMap ?? {};
    const mapped = map[char] ?? map[String(char).toLowerCase()];
    return mapped == null ? String(char) : String(mapped);
  };

  const typeText = async (text, options = {}) => {
    const duration = Math.max(1, Number.parseInt(options.duration ?? 45, 10) || 45);
    const gap = Math.max(0, Number.parseInt(options.gap ?? 25, 10) || 0);
    let count = 0;
    for (const char of String(text ?? "")) {
      const input = inputForTextChar(char);
      if (!input) continue;
      context.setInputPressed(input, true);
      await delay(duration);
      context.setInputPressed(input, false);
      if (gap) await delay(gap);
      count += 1;
    }
    return count;
  };

  const parseRuleAddress = (value) => context.toAddress(context.parseNumber(value));

  const normalizeRule = (value = {}, source = "user", defaultEndpointId = "*") => {
    const trigger = value.trigger && typeof value.trigger === "object" ? value.trigger : value;
    const rawValue = trigger.value ?? value.value;
    const hasValue = rawValue != null && String(rawValue).trim() !== "";
    const access = String(trigger.access ?? value.access ?? "write").toLowerCase();
    return {
      id: nextRuleId,
      source,
      endpointId: String((value.endpointId ?? value.endpoint ?? defaultEndpointId) || "*"),
      access: ["read", "write", "any"].includes(access) ? access : "write",
      address: parseRuleAddress(trigger.address ?? value.address),
      value: hasValue ? context.toByte(context.parseNumber(rawValue)) : null,
      pause: Boolean(value.pause ?? value.break ?? value.stop ?? false),
      once: Boolean(value.once ?? false),
      label: String(value.label ?? "").trim(),
      hits: 0,
    };
  };

  const describeRule = (rule) => {
    const endpointLabel = rule.endpointId === "*" ? "all endpoints" : (endpointById(rule.endpointId)?.label ?? rule.endpointId);
    const value = rule.value == null ? "any" : context.hex(rule.value, 2);
    return rule.access + " " + context.hex(rule.address, 4) + " = " + value + " -> " + endpointLabel + (rule.pause ? " + pause" : "") + " hits " + String(rule.hits ?? 0);
  };

  const addRule = (rawRule, source = "user", defaultEndpointId = refs["websocket-rule-endpoint"]?.value ?? "*") => {
    const rule = normalizeRule(rawRule, source, defaultEndpointId);
    nextRuleId += 1;
    rules.push(rule);
    renderRules();
    return rule;
  };

  const removeRule = (id) => {
    const index = rules.findIndex((rule) => rule.id === Number(id));
    if (index < 0) return false;
    rules.splice(index, 1);
    renderRules();
    return true;
  };

  const clearRules = () => {
    rules = [];
    nextRuleId = 1;
    lastRuleHit = null;
    renderRules();
  };

  const addUserRule = () => {
    context.pauseForOverlayButton();
    const rule = addRule({
      endpointId: refs["websocket-rule-endpoint"]?.value ?? "*",
      access: refs["websocket-rule-access"]?.value ?? "write",
      address: refs["websocket-rule-address"]?.value ?? "0x0000",
      value: refs["websocket-rule-value"]?.value ?? "",
      pause: Boolean(refs["websocket-rule-pause"]?.checked),
    }, "user");
    context.setStatus(["Added websocket rule", describeRule(rule)]);
  };

  const rulesToJson = () => rules.map((rule) => ({
    endpointId: rule.endpointId,
    trigger: {
      type: "memory",
      access: rule.access,
      address: context.hex(rule.address, 4),
      value: rule.value == null ? null : context.hex(rule.value, 2),
    },
    pause: rule.pause,
    once: rule.once,
    label: rule.label,
  }));

  const rulesPlaceholder = () => JSON.stringify([
    { endpointId: "debug", trigger: { type: "memory", access: "write", address: "0xabcd", value: "0x03" }, pause: false },
    { endpointId: "*", trigger: { type: "memory", access: "any", address: "0xbced" }, pause: true },
  ], null, 2);

  const importRulesFromJson = (payload) => {
    const rawRules = Array.isArray(payload)
      ? payload
      : Object.entries(payload ?? {}).map(([address, value]) => ({ address, ...(value && typeof value === "object" ? value : { value }) }));
    if (!Array.isArray(rawRules)) throw new Error("WebSocket rules must be an array or an object keyed by address.");
    clearRules();
    for (const raw of rawRules) addRule(raw, "import", raw.endpointId ?? raw.endpoint ?? "*");
    context.setStatus(["Imported websocket rules", String(rules.length) + " rules loaded."]);
  };

  const handleMemoryAccess = (type, event) => {
    if (context.watchIgnoreActive() || !rules.length) return;
    const address = event.address & 0xffff;
    const value = event.value & 0xff;
    const matched = [];
    for (const rule of rules.slice()) {
      if (rule.access !== "any" && rule.access !== type) continue;
      if (rule.address !== address) continue;
      if (rule.value != null && rule.value !== value) continue;
      rule.hits = (rule.hits ?? 0) + 1;
      matched.push(rule);
      emitEvent("websocket.rule.hit", {
        rule: {
          id: rule.id,
          source: rule.source,
          label: rule.label,
          access: rule.access,
          address: context.hex(rule.address, 4),
          value: rule.value == null ? null : context.hex(rule.value, 2),
          pause: rule.pause,
          hits: rule.hits,
        },
        access: { type, address: context.hex(address, 4), value: context.hex(value, 2) },
        debug: debugSnapshot(),
      }, rule.endpointId);
      lastRuleHit = describeRule(rule);
      if (rule.once) removeRule(rule.id);
      if (rule.pause) {
        emu().debugBreakRequested = true;
        context.setRunning(false);
        context.releaseAllInputs();
      }
    }
    if (matched.length) {
      renderRules();
      if (matched.some((rule) => rule.pause)) context.setStatus(["WebSocket rule pause", matched.map(describeRule).join("\n")]);
    }
  };

  const commandParams = (message) => message.params ?? message.payload ?? message;

  const handleCommand = async (endpoint, message) => {
    const command = String(message.command ?? message.action ?? message.type ?? "").trim();
    const params = commandParams(message);
    switch (command) {
      case "ping":
        return { pong: true, receivedAt: new Date().toISOString() };
      case "emulator.run":
        context.setRunning(true);
        context.updateDebugger(true);
        return { running: true };
      case "emulator.pause":
        context.setRunning(false);
        context.updateDebugger(true);
        return { running: false };
      case "emulator.step":
        context.stepEmulator();
        return debugSnapshot();
      case "emulator.reset":
        await context.resetEmulator();
        return debugSnapshot();
      case "input.press":
        context.setInputPressed(String(params.input ?? params.key), true);
        return { input: String(params.input ?? params.key), pressed: true };
      case "input.release":
        context.setInputPressed(String(params.input ?? params.key), false);
        return { input: String(params.input ?? params.key), pressed: false };
      case "input.pulse": {
        const input = String(params.input ?? params.key);
        context.pulseInput(input, Number.parseInt(params.duration, 10) || undefined);
        return { input, pulse: true };
      }
      case "input.type":
        return { typed: await typeText(params.text ?? params.value ?? "", params) };
      case "memory.read": {
        const length = Math.max(1, Math.min(context.memoryAddressSpaceSize(), context.parseNumber(params.length ?? 1)));
        const { start, bytes } = readMemory(context.parseNumber(params.address ?? 0), length);
        return { address: context.formatMemoryAddress(start), length: bytes.length, ...encodeBytes(bytes, params.format ?? "hex") };
      }
      case "memory.dump": {
        const length = Math.max(1, Math.min(context.memoryAddressSpaceSize(), context.parseNumber(params.length ?? context.memoryAddressSpaceSize())));
        const { start, bytes } = readMemory(context.parseNumber(params.address ?? 0), length);
        return { address: context.formatMemoryAddress(start), length: bytes.length, ...encodeBytes(bytes, params.format ?? "base64") };
      }
      case "memory.write": {
        const bytes = bytesForCommand(params);
        if (!bytes.length) throw new Error("memory.write requires value, bytes, hex, or base64");
        const { start } = writeMemory(context.parseNumber(params.address ?? 0), bytes);
        refreshAfterExternalWrite();
        return { address: context.formatMemoryAddress(start), length: bytes.length };
      }
      case "registers.get":
        return debugSnapshot().registers;
      case "registers.set": {
        const registers = params.registers && typeof params.registers === "object" ? params.registers : { [params.register]: params.value };
        for (const [name, value] of Object.entries(registers)) context.setCpuRegisterValue(name, context.parseNumber(value));
        context.updateDebugger(true);
        return debugSnapshot().registers;
      }
      case "state.get":
        return debugSnapshot();
      case "rules.add":
      case "websocket.rules.add": {
        const rule = addRule(params, "remote", params.endpointId ?? endpoint.id);
        return { id: rule.id, rule: rulesToJson().at(-1) };
      }
      case "rules.remove":
      case "websocket.rules.remove":
        return { removed: removeRule(params.id) };
      case "rules.clear":
      case "websocket.rules.clear":
        clearRules();
        return { cleared: true };
      case "rules.list":
      case "websocket.rules.list":
        return rulesToJson();
      default:
        throw new Error("Unsupported websocket command: " + command);
    }
  };

  const handleMessage = async (endpoint, message) => {
    const requestId = message.id ?? message.requestId ?? null;
    try {
      const command = message.command ?? (message.type === "command" ? message.action : message.type);
      respond(endpoint.id, requestId, true, await handleCommand(endpoint, { ...message, command }));
    } catch (error) {
      respond(endpoint.id, requestId, false, { message: error.message || String(error) });
    }
  };

  const handleRawMessage = async (endpoint, raw) => {
    const text = typeof raw === "string" ? raw : await raw.text?.() ?? String(raw);
    const payload = JSON.parse(text);
    if (Array.isArray(payload)) {
      for (const item of payload) await handleMessage(endpoint, item);
      return;
    }
    await handleMessage(endpoint, payload);
  };

  const bindControls = () => {
    if (refs["websocket-controls"]?.dataset.websocketBound === "true") return;
    if (refs["websocket-controls"]) refs["websocket-controls"].dataset.websocketBound = "true";
    refs["websocket-endpoint"]?.addEventListener("change", () => {
      selectedEndpointId = refs["websocket-endpoint"].value;
      renderControls();
    });
    refs["btn-websocket-connect"]?.addEventListener("click", () => {
      try {
        toggleSelected();
      } catch (error) {
        context.handleControlError(error);
      }
    });
    refs["btn-add-websocket-rule"]?.addEventListener("click", () => {
      try {
        addUserRule();
      } catch (error) {
        context.handleControlError(error);
      }
    });
    refs["btn-websocket-copy"]?.addEventListener("click", () => {
      context.pauseForOverlayButton();
      context.copyJsonToClipboard(rulesToJson(), "WebSocket rules", "websocket").catch(context.handleControlError);
    });
    refs["btn-websocket-import"]?.addEventListener("click", () => {
      context.pauseForOverlayButton();
      context.openRulesImport("websocket");
    });
    refs["btn-websocket-clear"]?.addEventListener("click", () => {
      context.pauseForOverlayButton();
      clearRules();
      context.setStatus(["Cleared websocket rules"]);
    });
  };

  return {
    configureFromManifest,
    renderControls,
    bindControls,
    startAutoConnections,
    handleMemoryAccess,
    clearRules,
    rulesToJson,
    importRulesFromJson,
    rulesPlaceholder,
    getLastRuleHit: () => lastRuleHit,
  };
};

export default createWebSocketConnector;
