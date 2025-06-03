# WebSocket Debug API

Each platform may define websocket endpoints in its platform JSON:

```json
{
  "websocket": {
    "enabled": true,
    "autoConnect": false,
    "endpoints": [
      {
        "id": "debug",
        "label": "Debug API",
        "url": "ws://127.0.0.1:8765/debug",
        "autoConnect": false,
        "channels": ["commands", "events", "rules"]
      }
    ]
  }
}
```

The browser opens these endpoints manually from the expanded memory editor, or
automatically when `autoConnect` is true.

## Message Envelope

Client to emulator:

```json
{ "id": "req-1", "command": "memory.read", "params": { "address": "0x2400", "length": "0x20" } }
```

Emulator to client:

```json
{ "type": "response", "version": 1, "requestId": "req-1", "ok": true, "result": {} }
```

Events:

```json
{ "type": "event", "version": 1, "event": "websocket.rule.hit", "payload": {} }
```

## Commands

Core emulator control:

```json
{ "id": "1", "command": "emulator.run" }
{ "id": "2", "command": "emulator.pause" }
{ "id": "3", "command": "emulator.step" }
{ "id": "4", "command": "emulator.reset" }
{ "id": "5", "command": "state.get" }
```

Inputs:

```json
{ "id": "6", "command": "input.press", "params": { "input": "left" } }
{ "id": "7", "command": "input.release", "params": { "input": "left" } }
{ "id": "8", "command": "input.pulse", "params": { "input": "start1", "duration": 250 } }
{ "id": "9", "command": "input.type", "params": { "text": "hello\n" } }
```

Memory:

```json
{ "id": "10", "command": "memory.read", "params": { "address": "0x2400", "length": 16, "format": "hex" } }
{ "id": "11", "command": "memory.dump", "params": { "address": "0x0000", "length": "0x10000", "format": "base64" } }
{ "id": "12", "command": "memory.write", "params": { "address": "0xabcd", "value": "0x03" } }
{ "id": "13", "command": "memory.write", "params": { "address": "0x4000", "hex": "01020304" } }
```

Registers:

```json
{ "id": "14", "command": "registers.get" }
{ "id": "15", "command": "registers.set", "params": { "register": "pc", "value": "0x0100" } }
{ "id": "16", "command": "registers.set", "params": { "registers": { "a": "0x10", "sp": "0xffff" } } }
```

Rules:

```json
{
  "id": "17",
  "command": "rules.add",
  "params": {
    "endpointId": "debug",
    "trigger": { "type": "memory", "access": "write", "address": "0xabcd", "value": "0x03" },
    "pause": false
  }
}
```

```json
{
  "id": "18",
  "command": "rules.add",
  "params": {
    "endpointId": "*",
    "trigger": { "type": "memory", "access": "any", "address": "0xbced" },
    "pause": true,
    "once": false
  }
}
```

Other rule commands:

```json
{ "id": "19", "command": "rules.list" }
{ "id": "20", "command": "rules.remove", "params": { "id": 1 } }
{ "id": "21", "command": "rules.clear" }
```

## Test Server

Run:

```sh
npm run ws:debug
```

Open the emulator, expand Memory Editor, choose the Debug API endpoint, and
press Connect. The server prints all received events and responses. Type JSON
commands into the server terminal to send them to connected emulator clients.
