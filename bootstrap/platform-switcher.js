export const DEFAULT_PLATFORM_ID = "midway-8080-arcade";

export const PLATFORM_OPTIONS = Object.freeze([
  {
    id: "midway-8080-arcade",
    label: "Midway 8080 Arcade",
    manifest: "./emulator/platforms/midway-8080-arcade.json5",
  },
  {
    id: "sinclair-zx80",
    label: "Sinclair ZX80",
    manifest: "./emulator/platforms/sinclair-zx80.json5",
  },
  {
    id: "commodore64",
    label: "Commodore 64",
    manifest: "./emulator/platforms/commodore64.json5",
  },
  {
    id: "atari2600",
    label: "Atari 2600",
    manifest: "./emulator/platforms/atari2600.json5",
  },
  {
    id: "psion-organiser-ii",
    label: "Psion Organiser II LZ",
    manifest: "./emulator/platforms/psion-organiser-ii-lz.json5",
  },
  {
    id: "psion-organiser-ii-xp",
    label: "Psion Organiser II XP",
    manifest: "./emulator/platforms/psion-organiser-ii.json5",
  },
]);

const canonicalManifestHref = (manifestPath) => new URL(manifestPath, document.baseURI).href;

export const resolvePlatformSelection = () => {
  const scriptNode = document.querySelector("script[data-manifest]");
  const defaultManifestPath = scriptNode?.dataset.manifest ?? PLATFORM_OPTIONS.find((platform) => platform.id === DEFAULT_PLATFORM_ID).manifest;
  const platformById = new Map(PLATFORM_OPTIONS.map((platform) => [platform.id, platform]));

  const requested = new URLSearchParams(window.location.search).get("platform");
  if (requested) {
    const byId = platformById.get(requested);
    if (byId) return { selectedPlatform: byId, manifestPath: byId.manifest, platformById };

    const byManifest = PLATFORM_OPTIONS.find((platform) => canonicalManifestHref(platform.manifest) === canonicalManifestHref(requested));
    if (byManifest) return { selectedPlatform: byManifest, manifestPath: byManifest.manifest, platformById };

    console.warn("Unknown emulator platform:", requested);
  }

  const selectedPlatform = PLATFORM_OPTIONS.find((platform) => canonicalManifestHref(platform.manifest) === canonicalManifestHref(defaultManifestPath))
    ?? platformById.get(DEFAULT_PLATFORM_ID)
    ?? PLATFORM_OPTIONS[0];

  return { selectedPlatform, manifestPath: selectedPlatform.manifest, platformById };
};

export const createPlatformSwitcher = ({ refs, selectedPlatform, platformById }) => {
  let platformFilterActiveIndex = 0;

  const platformTargetUrl = (platformId) => {
    const url = new URL(window.location.href);
    if (platformId === DEFAULT_PLATFORM_ID) url.searchParams.delete("platform");
    else url.searchParams.set("platform", platformId);
    return url;
  };

  const platformMatchesFilter = (platform, filter) => {
    const query = String(filter ?? "").trim().toLowerCase();
    if (!query) return true;
    return [platform.id, platform.label, platform.manifest].some((value) => String(value).toLowerCase().includes(query));
  };

  const platformFilterValue = () => String(refs["platform-filter"]?.value ?? "");
  const filteredPlatformOptions = () => PLATFORM_OPTIONS.filter((platform) => platformMatchesFilter(platform, platformFilterValue()));
  const platformOptionListIsOpen = () => refs["platform-option-list"]?.hidden === false;
  const getPlatformOptionsContainer = () => refs["platform-options"] ?? refs["platform-option-list"];

  const renderPlatformCurrent = () => {
    const current = refs["platform-current"];
    if (!current) return;
    current.textContent = selectedPlatform.label;
    current.title = selectedPlatform.label;
    current.setAttribute("aria-expanded", String(platformOptionListIsOpen()));
  };

  const hidePlatformOptionList = () => {
    const list = refs["platform-option-list"];
    if (!list) return;
    list.hidden = true;
    refs["platform-current"]?.setAttribute("aria-expanded", "false");
  };

  const renderPlatformOptionList = (options = filteredPlatformOptions()) => {
    const container = getPlatformOptionsContainer();
    if (!container) return;
    container.innerHTML = "";
    if (!options.length) {
      const empty = document.createElement("div");
      empty.className = "filterable-dropdown-empty";
      empty.textContent = "No platforms";
      container.appendChild(empty);
      return;
    }

    platformFilterActiveIndex = Math.max(0, Math.min(platformFilterActiveIndex, options.length - 1));
    for (const [index, platform] of options.entries()) {
      const option = document.createElement("button");
      option.className = "filterable-dropdown-option";
      option.type = "button";
      option.role = "option";
      option.dataset.platformId = platform.id;
      option.setAttribute("aria-selected", String(index === platformFilterActiveIndex));
      option.setAttribute("aria-current", String(platform.id === selectedPlatform.id));
      option.textContent = platform.label;
      option.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        hidePlatformOptionList();
        if (platform.id === selectedPlatform.id) refs["platform-current"]?.focus();
        navigateToPlatform(platform.id);
      });
      container.appendChild(option);
      if (index === platformFilterActiveIndex) {
        window.requestAnimationFrame(() => option.scrollIntoView({ block: "nearest" }));
      }
    }
  };

  const showPlatformOptionList = ({ resetSearch = true, focusSearch = true } = {}) => {
    const list = refs["platform-option-list"];
    const input = refs["platform-filter"];
    if (!list) return;
    if (resetSearch && input) input.value = "";
    const options = filteredPlatformOptions();
    const selectedIndex = options.findIndex((platform) => platform.id === selectedPlatform.id);
    platformFilterActiveIndex = selectedIndex >= 0 ? selectedIndex : 0;
    renderPlatformOptionList(options);
    list.hidden = false;
    refs["platform-current"]?.setAttribute("aria-expanded", "true");
    if (focusSearch && input) window.requestAnimationFrame(() => input.focus());
  };

  const navigateToPlatform = (platformId) => {
    if (platformId === selectedPlatform.id || !platformById.has(platformId)) return;
    window.location.assign(platformTargetUrl(platformId).href);
  };

  const setPlatformFilterActiveIndex = (index) => {
    const options = filteredPlatformOptions();
    if (!options.length) {
      platformFilterActiveIndex = 0;
      renderPlatformOptionList(options);
      return;
    }
    platformFilterActiveIndex = Math.max(0, Math.min(options.length - 1, index));
    renderPlatformOptionList(options);
  };

  const platformFromFilterValue = () => {
    const options = filteredPlatformOptions();
    const value = platformFilterValue().trim().toLowerCase();
    return (value
      ? options.find((platform) => platform.label.toLowerCase() === value || platform.id.toLowerCase() === value)
      : null)
      ?? options[platformFilterActiveIndex]
      ?? options[0]
      ?? null;
  };

  const schedulePlatformHideIfFocusLeaves = () => {
    setTimeout(() => {
      const picker = refs["platform-picker"];
      if (picker?.contains(document.activeElement)) return;
      hidePlatformOptionList();
    }, 120);
  };

  const populatePlatformSwitcher = () => {
    const current = refs["platform-current"];
    const input = refs["platform-filter"];
    if (!current || !input) return;
    renderPlatformCurrent();
    renderPlatformOptionList();
    current.addEventListener("click", () => {
      if (platformOptionListIsOpen()) hidePlatformOptionList();
      else showPlatformOptionList({ resetSearch: true });
    });
    current.addEventListener("keydown", (event) => {
      if (event.code === "ArrowDown" || event.code === "ArrowUp") {
        event.preventDefault();
        showPlatformOptionList({ resetSearch: true });
        if (event.code === "ArrowUp") setPlatformFilterActiveIndex(platformFilterActiveIndex - 1);
      }
    });
    input.addEventListener("input", () => {
      platformFilterActiveIndex = 0;
      renderPlatformOptionList();
    });
    input.addEventListener("keydown", (event) => {
      if (event.code === "ArrowDown") {
        event.preventDefault();
        setPlatformFilterActiveIndex(platformFilterActiveIndex + 1);
      } else if (event.code === "ArrowUp") {
        event.preventDefault();
        setPlatformFilterActiveIndex(platformFilterActiveIndex - 1);
      } else if (event.code === "Enter") {
        event.preventDefault();
        const platform = platformFromFilterValue();
        hidePlatformOptionList();
        if (platform) navigateToPlatform(platform.id);
      } else if (event.code === "Escape") {
        event.preventDefault();
        input.value = "";
        hidePlatformOptionList();
        current.focus();
      }
    });
    current.addEventListener("blur", schedulePlatformHideIfFocusLeaves);
    input.addEventListener("blur", schedulePlatformHideIfFocusLeaves);
    document.addEventListener("pointerdown", (event) => {
      const picker = refs["platform-picker"];
      if (picker && event.target instanceof Node && !picker.contains(event.target)) hidePlatformOptionList();
    });
    hidePlatformOptionList();
  };

  return {
    hidePlatformOptionList,
    populatePlatformSwitcher,
    renderPlatformCurrent,
    showPlatformOptionList,
  };
};
