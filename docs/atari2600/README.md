# Atari 2600 Reference Notes

This directory contains the Atari 2600 references used for the platform implementation.

## Saved References

- `stella-programmers-guide.html`: Steve Wright's *Stella Programmer's Guide* HTML edition, saved from https://alienbill.com/2600/101/docs/stella.html
- `nocash-atari-2600-specs.html`: no$2k6 Atari 2600 hardware notes, saved from https://problemkaputt.de/2k6specs.htm

## Implementation Scope

- CPU: MOS 6507 profile, using the existing 6502-family CPU core through `emulator/cpu/6507.js`.
- Bus: 13-bit CPU address bus with TIA, RIOT RAM/I/O, and cartridge ROM mirrors.
- Cartridge support: unbanked 2K/4K and common 4K bank-switched F8/F6/F4 layouts.
- TIA: register latches, coarse scanline rendering, playfield/player/missile/ball drawing, collision latches, console input ports, and joystick trigger reads.
- RIOT: 128 bytes RAM, SWCHA/SWCHB switch input, data-direction registers, and interval timer.
- Audio: two-channel TIA register tracking with simple Web Audio tone/noise generation.

This is intentionally not cycle-exact TIA emulation. It aims to run simple and common cartridges well enough for debugging in this emulator shell while keeping the implementation platform-local.
