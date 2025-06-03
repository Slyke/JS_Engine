const createZ80PinInterface = () => {
  const pins = {
    m1: false,     // Instruction fetch
    mreq: false,   // Memory request
    iorq: false,   // I/O request
    rd: false,     // Read signal
    wr: false,     // Write signal
    hlt: false     // CPU is halted
  };

  const setPins = (newStates) => {
    for (const k in newStates) {
      if (k in pins) pins[k] = newStates[k];
    }
  };

  const clearPins = () => {
    for (const k in pins) pins[k] = false;
  };

  return {
    pins,
    setPins,
    clearPins
  };
};

export default createZ80PinInterface;
