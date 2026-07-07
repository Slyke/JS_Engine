import { formatRomOffset, hex, parseNumber, parseOptionalOffset, toAddress } from './number-format.js';

const ROMS_ROOT_PATH = './roms/';
const ROM_CATALOG_MANIFEST_PATH = './roms/manifest.json';
const ROM_CATALOG_MAX_DEPTH = 3;
const ROM_FILE_EXTENSIONS = Object.freeze(['.bin', '.rom', '.json', '.gb', '.gbc', '.gba', '.smc', '.sfc', '.nes', '.tap', '.tzx', '.z80', '.sna']);

export const romNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const createRomCatalog = ({
  refs,
  getEmu,
  platformDefaultRomOffset,
  platformSettingsStorageKey,
  readSettingsBucket,
  selectedPlatform,
  setStatus,
  writeSettingsBucket,
}) => {
  let romCatalogOptions = [];

  const trimTrailingSlashes = (value) => {
    let text = String(value ?? '');
    while (text.endsWith('/')) text = text.slice(0, -1);
    return text;
  };

  const safeDecodeURIComponent = (value) => {
    try {
      return decodeURIComponent(String(value));
    } catch {
      return String(value);
    }
  };

  const stripRomFileExtensions = (name) => {
    let next = String(name ?? '');
    let changed = true;
    while (changed) {
      changed = false;
      const lower = next.toLowerCase();
      for (const extension of ROM_FILE_EXTENSIONS) {
        if (!lower.endsWith(extension)) continue;
        next = next.slice(0, -extension.length);
        changed = true;
        break;
      }
    }
    return next;
  };

  const humanizeRomName = (value) => {
    const clean = trimTrailingSlashes(safeDecodeURIComponent(value));
    const name = stripRomFileExtensions(clean.split('/').filter(Boolean).pop() ?? clean)
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return name || 'ROM';
  };

  const hasRomFileExtension = (path) => {
    const lower = String(path ?? '').toLowerCase();
    return ROM_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
  };

  const isIgnoredRomPath = (path) => {
    const parts = String(path ?? '').split('/').filter(Boolean);
    const filename = (parts[parts.length - 1] ?? '').toLowerCase();
    return parts.some((part) => part.startsWith('.') || part.includes(':'))
      || filename === 'readme'
      || filename === 'readme.md';
  };

  const isSupportedRomFilePath = (path) => hasRomFileExtension(path) && !isIgnoredRomPath(path);

  const compareRomEntries = (a, b) => romNameCollator.compare(
    String(a?.label ?? a?.name ?? a?.path ?? a ?? ''),
    String(b?.label ?? b?.name ?? b?.path ?? b ?? '')
  );

  const romRootUrl = () => new URL(ROMS_ROOT_PATH, document.baseURI);

  const normalizeDirectoryUrl = (urlLike) => {
    const url = new URL(urlLike, document.baseURI);
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url;
  };

  const romRelativePath = (urlLike) => {
    const url = new URL(urlLike, document.baseURI);
    const rootPath = safeDecodeURIComponent(romRootUrl().pathname);
    const pathname = safeDecodeURIComponent(url.pathname);
    return pathname.startsWith(rootPath) ? pathname.slice(rootPath.length) : pathname.replace(/^\/+/, '');
  };

  const fetchDirectoryLinks = async (directoryPath) => {
    const directoryUrl = normalizeDirectoryUrl(directoryPath);
    const response = await fetch(directoryUrl.href, { cache: 'no-store' });
    if (!response.ok) throw new Error('Failed to list ' + directoryUrl.pathname + ' (' + response.status + ')');
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const linksByPath = new Map();

    for (const anchor of doc.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('?') || href.startsWith('#')) continue;
      const url = new URL(href, directoryUrl);
      if (url.origin !== directoryUrl.origin) continue;
      if (url.pathname === directoryUrl.pathname) continue;
      if (!url.pathname.startsWith(directoryUrl.pathname)) continue;

      const relative = safeDecodeURIComponent(url.pathname.slice(directoryUrl.pathname.length));
      const name = relative.split('/').filter(Boolean)[0] ?? '';
      if (!name || name === '..') continue;

      const path = safeDecodeURIComponent(url.pathname);
      if (isIgnoredRomPath(path)) continue;
      linksByPath.set(url.pathname, {
        url,
        name: safeDecodeURIComponent(name),
        path,
        isDirectory: url.pathname.endsWith('/'),
      });
    }

    return [...linksByPath.values()].sort(compareRomEntries);
  };

  const selectedRomCatalogEntry = () => {
    const id = refs['rom-select']?.value;
    return romCatalogOptions.find((candidate) => candidate.id === id) ?? null;
  };

  const catalogEntryDefaultOffset = (entry) => {
    const firstRomOffset = entry?.roms?.[0]?.offset;
    return parseOptionalOffset(firstRomOffset, platformDefaultRomOffset());
  };

  const setRomOffsetInputValue = (offset) => {
    if (refs['rom-offset'] == null) return;
    refs['rom-offset'].value = formatRomOffset(offset);
  };

  const syncRomOffsetFromCatalogSelection = () => {
    const entry = selectedRomCatalogEntry();
    setRomOffsetInputValue(entry ? catalogEntryDefaultOffset(entry) : platformDefaultRomOffset());
  };

  const currentRomOffsetInputValue = (fallback = 0) => parseOptionalOffset(refs['rom-offset']?.value, fallback);

  const romSourceFromCatalogEntry = (entry, options = {}) => {
    const defaultOffset = catalogEntryDefaultOffset(entry);
    const baseOffset = parseOptionalOffset(options.baseOffset, defaultOffset);
    return {
      type: 'catalog',
      id: entry.id,
      label: entry.label,
      baseOffset,
      roms: entry.roms.map((rom, index) => {
        if (rom.target != null || rom.physical === true) return { ...rom, offset: parseOptionalOffset(rom.offset, 0) };
        if (rom.offset == null) return index === 0 ? { ...rom, offset: baseOffset } : { ...rom };
        const relativeOffset = parseOptionalOffset(rom.offset, 0) - defaultOffset;
        return { ...rom, offset: toAddress(baseOffset + relativeOffset) };
      }),
    };
  };

  const fileCatalogEntry = (file) => ({
    id: romRelativePath(file.url),
    label: humanizeRomName(file.path),
    roms: [{ path: file.path, label: file.name, offset: 0 }],
  });

  const directoryCatalogEntry = (directoryPath, files) => {
    const id = romRelativePath(directoryPath).replace(/\/+$/, '') + '/';
    return {
      id,
      label: humanizeRomName(id) + ' (multi-file)',
      roms: files.map((file) => ({ path: file.path, label: file.name })),
    };
  };

  const scanRomDirectory = async (directoryPath = ROMS_ROOT_PATH, depth = 0) => {
    const links = await fetchDirectoryLinks(directoryPath);
    const files = links.filter((link) => !link.isDirectory && isSupportedRomFilePath(link.path));
    const binaryFiles = files.filter((file) => !file.path.toLowerCase().endsWith('.json')).sort(compareRomEntries);
    const jsonFiles = files.filter((file) => file.path.toLowerCase().endsWith('.json')).sort(compareRomEntries);
    const entries = [];

    if (depth > 0 && binaryFiles.length > 1) {
      entries.push(directoryCatalogEntry(directoryPath, binaryFiles));
    } else {
      entries.push(...binaryFiles.map(fileCatalogEntry));
    }

    entries.push(...jsonFiles.map(fileCatalogEntry));

    if (depth < ROM_CATALOG_MAX_DEPTH) {
      for (const directory of links.filter((link) => link.isDirectory).sort(compareRomEntries)) {
        entries.push(...await scanRomDirectory(directory.url.href, depth + 1));
      }
    }

    return entries;
  };

  const setRomSelectMessage = (message) => {
    const select = refs['rom-select'];
    if (select) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = message;
      select.replaceChildren(option);
      select.disabled = true;
    }
    if (refs['btn-load-catalog-rom']) refs['btn-load-catalog-rom'].disabled = true;
  };

  const readLastRomSetting = () => {
    const setting = readSettingsBucket(platformSettingsStorageKey()).lastRom;
    return setting && typeof setting === 'object' ? setting : null;
  };

  const saveLastCatalogRomSetting = (source) => {
    if (source?.type !== 'catalog') return;
    writeSettingsBucket(platformSettingsStorageKey(), { lastRom: { type: 'catalog', id: source.id } });
  };

  const renderRomCatalog = () => {
    const select = refs['rom-select'];
    if (!select) return;
    if (!romCatalogOptions.length) {
      setRomSelectMessage('No ROMs found');
      return;
    }

    const saved = readLastRomSetting();
    const currentValue = select.value;
    const selectedId = romCatalogOptions.some((entry) => entry.id === saved?.id)
      ? saved.id
      : romCatalogOptions.some((entry) => entry.id === currentValue)
        ? currentValue
        : romCatalogOptions[0].id;

    select.replaceChildren();
    for (const entry of romCatalogOptions) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.label;
      select.appendChild(option);
    }
    select.value = selectedId;
    select.disabled = false;
    syncRomOffsetFromCatalogSelection();
    if (refs['btn-load-catalog-rom']) refs['btn-load-catalog-rom'].disabled = false;
  };

  const normalizeCatalogRomPath = (path, baseUrl) => {
    const text = String(path ?? '').trim();
    if (text === '') return '';
    return safeDecodeURIComponent(new URL(text, baseUrl).pathname);
  };

  const normalizeCatalogFile = (file, baseUrl) => {
    const raw = typeof file === 'string' ? { path: file } : file ?? {};
    const path = normalizeCatalogRomPath(raw.path ?? raw.url, baseUrl);
    if (path === '' || isSupportedRomFilePath(path) === false) return null;
    const rom = { path, label: String(raw.label ?? raw.name ?? humanizeRomName(path)) };
    if (raw.target != null) rom.target = String(raw.target);
    if (raw.physical != null) rom.physical = Boolean(raw.physical);
    if (raw.offset == null) return rom;
    rom.offset = raw.offset;
    return rom;
  };

  const normalizeRomCatalogManifest = (payload, manifestUrl) => {
    const rawEntries = Array.isArray(payload?.roms) ? payload.roms : Array.isArray(payload) ? payload : [];
    return rawEntries.map((entry) => {
      const raw = typeof entry === 'string' ? { path: entry } : entry ?? {};
      const platforms = Array.isArray(raw.platforms) ? raw.platforms.map(String) : [];
      if (platforms.length > 0 && platforms.includes(selectedPlatform.id) === false) return null;
      const rawFiles = Array.isArray(raw.files)
        ? raw.files
        : Array.isArray(raw.roms)
          ? raw.roms
          : Array.isArray(raw.paths)
            ? raw.paths
            : raw.path
              ? [raw]
              : [];
      const roms = rawFiles.map((file) => normalizeCatalogFile(file, manifestUrl)).filter(Boolean);
      if (roms.length === 0) return null;
      const fallbackId = roms.map((rom) => romRelativePath(rom.path)).join('_');
      const id = String(raw.id ?? raw.slug ?? fallbackId).trim() || romRelativePath(roms[0].path);
      return {
        id,
        label: String(raw.label ?? raw.name ?? humanizeRomName(id)),
        roms,
      };
    }).filter(Boolean);
  };

  const fetchRomCatalogManifest = async () => {
    const manifestUrl = new URL(ROM_CATALOG_MANIFEST_PATH, document.baseURI);
    const response = await fetch(manifestUrl.href, { cache: 'no-store' });
    if (response.ok === false) throw new Error('Failed to load ' + manifestUrl.pathname + ' (' + response.status + ')');
    return normalizeRomCatalogManifest(await response.json(), manifestUrl);
  };

  const refreshRomCatalog = async (options = {}) => {
    setRomSelectMessage('Scanning ROMs...');
    try {
      romCatalogOptions = (await fetchRomCatalogManifest()).sort(compareRomEntries);
      renderRomCatalog();
      if (options.showStatus) setStatus(['ROM catalog refreshed', 'Found: ' + romCatalogOptions.length]);
    } catch (manifestError) {
      try {
        romCatalogOptions = (await scanRomDirectory()).sort(compareRomEntries);
        renderRomCatalog();
        if (options.showStatus) setStatus(['ROM catalog refreshed from directory listing', 'Found: ' + romCatalogOptions.length]);
      } catch (error) {
        romCatalogOptions = [];
        setRomSelectMessage('Unable to load ROM catalog');
        console.warn('Failed to load ROM catalog manifest', manifestError);
        console.warn('Failed to list ROM catalog', error);
        if (options.showStatus) setStatus(error.stack || error.message || String(error), true);
      }
    }
  };

  const selectedCatalogRomSource = () => {
    const entry = selectedRomCatalogEntry();
    if (entry == null) throw new Error('Choose a ROM from the catalog first');
    return romSourceFromCatalogEntry(entry, { baseOffset: currentRomOffsetInputValue(catalogEntryDefaultOffset(entry)) });
  };

  const savedCatalogRomSource = () => {
    const setting = readLastRomSetting();
    if (setting?.type !== 'catalog' || !setting.id) return null;
    const entry = romCatalogOptions.find((candidate) => candidate.id === setting.id);
    return entry ? romSourceFromCatalogEntry(entry) : null;
  };

  const manifestRomSource = () => {
    const emu = getEmu();
    return {
      type: 'manifest',
      id: 'manifest',
      label: emu?.manifest?.name ?? selectedPlatform.label,
      roms: (emu?.manifest?.roms ?? []).map((rom) => ({ ...rom })),
    };
  };

  return {
    currentRomOffsetInputValue,
    manifestRomSource,
    refreshRomCatalog,
    saveLastCatalogRomSetting,
    savedCatalogRomSource,
    selectedCatalogRomSource,
    setRomOffsetInputValue,
    syncRomOffsetFromCatalogSelection,
    get options() {
      return romCatalogOptions;
    },
  };
};
