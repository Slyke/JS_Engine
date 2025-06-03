import crypto from "crypto";
import http from "http";
import readline from "readline";

const port = Number.parseInt(process.env.PORT ?? "8765", 10);
const clients = new Set();

const sha1Base64 = (value) => crypto.createHash("sha1").update(value).digest("base64");

const encodeFrame = (payload) => {
  const data = Buffer.from(JSON.stringify(payload), "utf8");
  if (data.length < 126) return Buffer.concat([Buffer.from([0x81, data.length]), data]);
  if (data.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
    return Buffer.concat([header, data]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(data.length), 2);
  return Buffer.concat([header, data]);
};

const decodeFrames = (buffer) => {
  const messages = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }
    const maskLength = masked ? 4 : 0;
    const frameEnd = offset + headerLength + maskLength + length;
    if (frameEnd > buffer.length) break;
    const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : null;
    const payload = Buffer.from(buffer.subarray(offset + headerLength + maskLength, frameEnd));
    if (mask) {
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    }
    if (opcode === 0x1) messages.push(payload.toString("utf8"));
    offset = frameEnd;
  }
  return { messages, rest: buffer.subarray(offset) };
};

const send = (client, payload) => {
  if (client.socket.destroyed) return;
  client.socket.write(encodeFrame(payload));
};

const broadcast = (payload) => {
  for (const client of clients) send(client, payload);
};

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end("JS Emulator websocket debug server. Connect to ws://127.0.0.1:" + port + "/debug\\n");
});

server.on("upgrade", (request, socket) => {
  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = sha1Base64(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    "Sec-WebSocket-Accept: " + accept,
    "",
    "",
  ].join("\\r\\n"));

  const client = { socket, path: request.url ?? "/", buffer: Buffer.alloc(0) };
  clients.add(client);
  console.log("client connected", client.path);

  socket.on("data", (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    const decoded = decodeFrames(client.buffer);
    client.buffer = decoded.rest;
    for (const message of decoded.messages) {
      try {
        const payload = JSON.parse(message);
        console.log("recv", JSON.stringify(payload, null, 2));
      } catch {
        console.log("recv", message);
      }
    }
  });
  socket.on("close", () => {
    clients.delete(client);
    console.log("client disconnected", client.path);
  });
  socket.on("error", (error) => {
    clients.delete(client);
    console.error("client error", error.message);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log("websocket debug server listening on ws://127.0.0.1:" + port + "/debug");
  console.log("type JSON commands, for example: {\"id\":\"1\",\"command\":\"state.get\"}");
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  try {
    broadcast(JSON.parse(text));
  } catch (error) {
    console.error("stdin JSON error:", error.message);
  }
});
