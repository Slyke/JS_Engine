export const refs = {};

export const collectRefs = () => {
  for (const id of [
    "screen", "memory-map", "registers", "flags", "ports", "hex-dump",
    "platform-picker", "platform-current", "platform-filter", "platform-option-list", "platform-options", "rom-select", "btn-refresh-roms", "btn-load-catalog-rom",
    "rom-catalog-controls", "rom-disk-controls", "btn-rom-mode-toggle", "btn-rom-advanced-toggle", "rom-advanced-controls",
    "disasm", "status", "mem-address", "mem-length", "patch-address", "patch-value",
    "search-value", "search-start", "search-end", "search-results", "btn-run-toggle", "run-toggle-label",
    "btn-step", "btn-reset", "btn-save-state", "btn-load-state", "btn-load-state-disk", "state-file", "autopause",
    "play-zone", "input-buttons", "screen-wrap", "app-shell", "debugger-pane", "debugger-pane-resize-handle", "debugger-card-grid",
    "btn-debugger-pane-toggle", "memory-map-large-frame", "memory-map-large", "map-modal",
    "btn-map-close", "btn-map-preload", "map-hover-readout", "map-selected-readout", "map-legend", "rom-file",
    "rom-offset", "rom-reset", "rom-autorun", "btn-load-rom", "btn-read-memory", "btn-write-memory", "btn-search", "btn-clear-search",
    "break-address", "btn-break-read", "btn-break-write", "btn-find-writer", "breakpoint-list", "watch-log",
    "mem-auto-read", "mem-auto-pause-only", "mem-expanded-auto-read", "mem-expanded-auto-pause-only",
    "btn-debug-reset-defaults", "btn-editor-expand", "editor-modal", "btn-editor-close", "mem-expanded-address", "mem-expanded-length",
    "mem-expanded-row-bytes", "btn-expanded-read-memory", "hex-dump-large", "patch-expanded-address",
    "patch-expanded-value", "btn-expanded-write-memory", "search-expanded-value", "search-expanded-start",
    "search-expanded-end", "btn-expanded-search", "btn-expanded-clear-search", "search-results-large", "break-expanded-address",
    "btn-expanded-break-read", "btn-expanded-break-write", "btn-expanded-find-writer", "hook-register-pc-address",
    "hook-register-name", "hook-register-value", "btn-add-register-hook", "hook-memory-pc-address",
    "hook-memory-address", "hook-memory-value", "btn-add-memory-hook", "btn-pc-help", "pc-hook-help", "pc-hook-list",
    "breakpoint-list-large", "watch-log-large", "btn-access-copy", "btn-access-import", "btn-access-clear",
    "btn-pc-copy", "btn-pc-import", "btn-pc-clear", "btn-rules-clear-all", "rules-modal",
    "rules-modal-title", "rules-json", "btn-rules-load", "btn-rules-close",
    "websocket-controls", "websocket-endpoint", "websocket-url", "btn-websocket-connect", "websocket-status",
    "websocket-rule-endpoint", "websocket-rule-access", "websocket-rule-address", "websocket-rule-value",
    "websocket-rule-pause", "btn-add-websocket-rule", "btn-websocket-copy", "btn-websocket-import",
    "btn-websocket-clear", "websocket-rule-list",
  ]) refs[id] = document.getElementById(id);
};
