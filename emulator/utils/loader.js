export const toBaseURL = async (baseDirLike) => {
  if (typeof window !== 'undefined') {
    return new URL(baseDirLike ?? './', import.meta.url);
  } else {
    const path = await import('path');
    const { pathToFileURL } = await import('url');
    const p = baseDirLike ?? '.';
    const withSlash = p.endsWith(path.sep) ? p : p + path.sep;
    return pathToFileURL(withSlash);
  }
};

export const resolveURL = (relativePath, baseURL) => new URL(relativePath, baseURL).href;

export const dynImport = async (urlHref) => (await import(urlHref)).default;

export const dirOf = (href) => new URL('./', href).href;

export const parseJSONLike = (text, urlHref = 'config') => {
  try {
    return JSON.parse(text);
  } catch (jsonError) {
    try {
      return Function('"use strict"; return (' + text + '\n);')();
    } catch (json5Error) {
      throw new SyntaxError(`Failed to parse ${urlHref} as JSON or JSON5: ${json5Error.message || jsonError.message}`);
    }
  }
};

export const fetchJSON = async (urlHref) => {
  const u = new URL(urlHref);
  if (u.protocol === 'file:') {
    const fs = await import('fs/promises');
    const txt = await fs.readFile(u, { encoding: 'utf-8' });
    return parseJSONLike(txt, urlHref);
  }
  const res = await fetch(urlHref);
  if (!res.ok) throw new Error(`fetch ${urlHref} ${res.status}`);
  return parseJSONLike(await res.text(), urlHref);
};

export const importJSON = async (urlHref) => {
  try {
    return (await import(urlHref, { assert: { type: 'json' } })).default;
  } catch {
    return fetchJSON(urlHref);
  }
};
