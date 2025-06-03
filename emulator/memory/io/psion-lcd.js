const DDRAM_SIZE = 0x80;
const CGRAM_SIZE = 0x40;
const restoreBytes = (target, source) => {
  target.fill(0);
  if (source == null) return;
  const bytes = source instanceof Uint8Array ? source : Uint8Array.from(source);
  target.set(bytes.subarray(0, target.length));
};

const createPsionLcd = () => {
  const ddram = new Uint8Array(DDRAM_SIZE);
  const cgram = new Uint8Array(CGRAM_SIZE);
  let address = 0;
  let cgramSelected = false;
  let displayOn = false;
  let cursorOn = false;
  let blinkOn = false;
  let increment = true;

  const reset = () => {
    ddram.fill(0x20);
    cgram.fill(0);
    address = 0;
    cgramSelected = false;
    displayOn = false;
    cursorOn = false;
    blinkOn = false;
    increment = true;
  };

  const advanceAddress = () => {
    address = (address + (increment ? 1 : -1)) & 0x7f;
  };

  const readControl = () => address & 0x7f;

  const writeControl = (_emuState, value) => {
    const command = value & 0xff;
    if (command & 0x80) {
      address = command & 0x7f;
      cgramSelected = false;
    } else if (command & 0x40) {
      address = command & 0x3f;
      cgramSelected = true;
    } else if (command === 0x01) {
      ddram.fill(0x20);
      address = 0;
      cgramSelected = false;
    } else if (command === 0x02) {
      address = 0;
      cgramSelected = false;
    } else if ((command & 0xfc) === 0x04) {
      increment = (command & 0x02) !== 0;
    } else if ((command & 0xf8) === 0x08) {
      displayOn = (command & 0x04) !== 0;
      cursorOn = (command & 0x02) !== 0;
      blinkOn = (command & 0x01) !== 0;
    } else if ((command & 0xf0) === 0x10 && (command & 0x08) === 0) {
      address = (address + ((command & 0x04) ? 1 : -1)) & 0x7f;
      cgramSelected = false;
    }
  };

  const readData = () => {
    const buffer = cgramSelected ? cgram : ddram;
    const value = buffer[address & (buffer.length - 1)];
    advanceAddress();
    return value;
  };

  const peekData = () => {
    const buffer = cgramSelected ? cgram : ddram;
    return buffer[address & (buffer.length - 1)];
  };

  const writeData = (_emuState, value) => {
    const buffer = cgramSelected ? cgram : ddram;
    buffer[address & (buffer.length - 1)] = value & 0xff;
    advanceAddress();
  };

  const readByte = (_emuState, offset) => (offset & 1) === 0 ? readControl() : readData();
  const peekByte = (_emuState, offset) => (offset & 1) === 0 ? readControl() : peekData();
  const writeByte = (emuState, offset, value) => {
    if ((offset & 1) === 0) writeControl(emuState, value);
    else writeData(emuState, value);
  };

  reset();

  return {
    readByte,
    peekByte,
    writeByte,
    reset,
    serializeState: () => ({
      address,
      cgramSelected,
      displayOn,
      cursorOn,
      blinkOn,
      increment,
      ddram: Array.from(ddram),
      cgram: Array.from(cgram),
      byteLength: ddram.length + cgram.length,
    }),
    restoreState: (_emuState, snapshot = {}) => {
      restoreBytes(ddram, snapshot.ddram);
      restoreBytes(cgram, snapshot.cgram);
      address = snapshot.address & 0x7f;
      cgramSelected = Boolean(snapshot.cgramSelected);
      displayOn = Boolean(snapshot.displayOn);
      cursorOn = Boolean(snapshot.cursorOn);
      blinkOn = Boolean(snapshot.blinkOn);
      increment = snapshot.increment !== false;
    },
    getState: () => ({
      address,
      cgramSelected,
      displayOn,
      cursorOn,
      blinkOn,
      ddram: ddram.slice(),
      cgram: cgram.slice(),
    }),
  };
};

export default createPsionLcd;
