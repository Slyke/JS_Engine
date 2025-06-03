# Emulator Reference Documents

Retrieved: 2026-07-06

These files are third-party reference documents kept with the repo for emulator development and historical record keeping. Check the upstream source and document notices before redistributing outside this project.

## Z80 CPU and Opcodes

| File | Source | Notes |
| --- | --- | --- |
| [z80/zilog-z80-cpu-user-manual-um0080.pdf](z80/zilog-z80-cpu-user-manual-um0080.pdf) | https://www.zilog.com/docs/z80/um0080.pdf | Official Zilog Z80 CPU user manual. Covers architecture, timing, pin behavior, and instruction details. |
| [z80/z80-instruction-set-wikipedia.pdf](z80/z80-instruction-set-wikipedia.pdf) | https://en.wikipedia.org/api/rest_v1/page/pdf/Z80_instruction_set | Downloaded PDF rendering of the Z80 instruction set article, useful as a compact opcode and encoding reference. |

## Intel 8080 CPU and Opcodes

| File | Source | Notes |
| --- | --- | --- |
| [i8080/intel-8080-microcomputer-systems-users-manual-sep-1975.pdf](i8080/intel-8080-microcomputer-systems-users-manual-sep-1975.pdf) | http://www.nj7p.info/Manuals/PDFs/Intel/9800153B.pdf | Intel 8080 Microcomputer Systems User's Manual, September 1975. Added as an opcode and timing reference for the Midway 8080 platform. |

## Midway 8080 Arcade Hardware

The Midway arcade platform in this repository targets the Intel 8080 CPU, so this archive keeps Midway/Space Invaders 8080-board references that match the emulator target.

| File | Source | Notes |
| --- | --- | --- |
| [midway-8080/space-invaders-parts-catalog-oct-1978.pdf](midway-8080/space-invaders-parts-catalog-oct-1978.pdf) | https://arcarc.xmission.com/PDF_Arcade_Bally_Midway/Space_Invaders_Parts_Catalog_(Oct_1978).pdf | Midway Space Invaders parts catalog. |
| [midway-8080/space-invaders-game-logic-m051-00739-a005.pdf](midway-8080/space-invaders-game-logic-m051-00739-a005.pdf) | https://arcarc.xmission.com/PDF_Arcade_Bally_Midway/Space_Invaders_Game_Logic_(M051-00739-A005).pdf | Space Invaders game logic schematics. |
| [midway-8080/space-invaders-wiring-diagram-m051-00739-a002.pdf](midway-8080/space-invaders-wiring-diagram-m051-00739-a002.pdf) | https://arcarc.xmission.com/PDF_Arcade_Bally_Midway/Space_Invaders_Wiring_Diagram_(M051-00739-A002).pdf | Space Invaders wiring diagram. |
| [midway-8080/midway-standard-test-procedures-processor-boards-m1700-1-july-1976.pdf](midway-8080/midway-standard-test-procedures-processor-boards-m1700-1-july-1976.pdf) | https://arcarc.xmission.com/PDF_Arcade_Bally_Midway/Midway_Standard_Test_Procedures_for_Processor_Boards_(M1700-1_July_1976).pdf | Midway processor-board diagnostic and test procedure reference. |

## Sinclair ZX80 Hardware

| File | Source | Notes |
| --- | --- | --- |
| [zx80/sinclair-zx80-assembly-instructions.pdf](zx80/sinclair-zx80-assembly-instructions.pdf) | https://www.8bity.cz/files/zx80const.pdf | ZX80 assembly instructions, including component and circuit reference material. |
| [zx80/the-zx80-companion-2nd-ed.pdf](zx80/the-zx80-companion-2nd-ed.pdf) | https://ia600501.us.archive.org/14/items/the-zx80-companion/TheZX80Companion%282ndEd%29.pdf | The ZX80 Companion, second edition; useful hardware and software reference for ZX80 behavior. |

## Commodore 64 Hardware and ROM Behavior

See [commodore64/README.md](commodore64/README.md) for the downloaded C64
programmer reference, memory-map reference, and MOS/CSG chip datasheets used by
the Commodore 64 platform implementation.

## Atari 2600 Hardware

See [atari2600/README.md](atari2600/README.md) for the downloaded Stella
Programmer's Guide HTML edition, no$2k6 hardware notes, and implementation
scope used by the Atari 2600 platform.
