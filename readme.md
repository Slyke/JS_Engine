# JS Emulator

This is a browser-based emulator side project. It started as a Z80 emulator and then turned into a little manifest-driven emulator shell with a debugger UI, ROM picker, memory view, and some very uneven platform experiments.

Some of these are more complete than others. If something boots and draws pixels, that does not mean it is accurate yet.

## Running

```sh
npm start
```

That serves `www/index.html` and opens it in the browser. The older root `index.html` is still around too, mostly because I have been keeping the GitHub Pages version working while moving files around.

Tests are just:

```sh
npm test
```

## Emulators In Here

- Midway 8080 arcade hardware, mainly for Space Invaders.
- Sinclair ZX80 on the Z80 core.
- Psion Organiser II XP and LZ on the HD6303 core.
- Commodore 64 on the 6510 core, with early VIC-II/SID pieces.
- Atari 2600 on the 6507/TIA pieces. Bring your own cartridge ROM for now.
- A generic Z80 manifest that is mostly useful for tests and experiments.

## Included ROMs

The checked-in ROM catalog is under `roms/manifest.json`. Right now it has:

- Space Invaders ROM parts for the Midway 8080 arcade platform.
- Psion Organiser II ROMs: CM OS 2.6, XP OS 2.6, XP OS 3.1, and LZ OS 4.6.
- Sinclair ZX80 4K BASIC ROM.
- Commodore 64 ROMs: 64C BASIC + KERNAL 251913-01, plus KERNAL 901227-02.

There are notes next to the ROM folders about where those files came from. I am trying to keep that stuff documented as I add things.

## Useful Files

- `emulator/platforms/*.json5`: platform manifests.
- `emulator/create-emulator.js`: shared manifest loader.
- `emulator/cpu/`: CPU cores.
- `emulator/memory/`: memory devices and MMU bits.
- `emulator/video/` and `emulator/audio/`: display and sound experiments.
- `www/browser-bootstrap.js`: browser runtime, debugger UI, controls, ROM loading, and websocket UI.
- `docs/websocket-api.md`: debugger websocket API notes.

## Future Plans

Stuff I want to poke at next, in no particular order:

- Apple II.
- Sega Master System and Mega Drive.
- Game Boy, Game Boy Color, and Game Boy Advance.
- SNES.
- A better CLI/headless mode for non-graphical use.
- WebSocket debugger/control support for that CLI mode, reusing the current browser debugger API where it makes sense.
- Less duplicated browser/bootstrap stuff once the GitHub Pages setup settles down.
