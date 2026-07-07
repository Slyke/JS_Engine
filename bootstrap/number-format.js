export const parseNumber = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return 0;
  return text.startsWith("0x") ? parseInt(text, 16) : parseInt(text, 10);
};

export const toByte = (value) => value & 0xff;
export const toAddress = (value) => value & 0xffff;
export const hex = (value, width) => "0x" + (value >>> 0).toString(16).toUpperCase().padStart(width, "0");

export const parseOptionalOffset = (value, fallback = 0) => {
  const text = String(value ?? "").trim();
  return text ? toAddress(parseNumber(text)) : toAddress(fallback);
};

export const formatRomOffset = (offset) => hex(toAddress(offset), 4);
