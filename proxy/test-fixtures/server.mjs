import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const port = 18787;
const cassetteDirectory = new URL("./cassettes/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("./cassettes/manifest.json", import.meta.url), "utf8"),
);
const responses = new Map();
const faults = new Map();
const pendingTimers = new Set();
const allowedFaults = new Map([
  ["/info/rainbow", new Set(["not-found", "delay"])],
  ["/gems/rainbow-3.1.1.gem", new Set(["corrupt"])],
]);

for (const entry of Object.values(manifest.responses)) {
  const body = await readFile(new URL(entry.body.file, cassetteDirectory));
  const sha256 = createHash("sha256").update(body).digest("hex");
  if (body.byteLength !== entry.body.bytes || sha256 !== entry.body.sha256)
    throw new Error(`Invalid cassette body: ${entry.body.file}`);
  responses.set(new URL(entry.url).pathname, { ...entry, body });
}

function send(response, status, headers, body) {
  response.writeHead(status, headers);
  response.end(body);
}

function sendJson(response, status, value) {
  send(
    response,
    status,
    {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    JSON.stringify(value),
  );
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 4096) throw new Error("Request body is too large");
  }
  return JSON.parse(body);
}

function scheduleResponse(response, delayMs, callback) {
  const timer = setTimeout(() => {
    pendingTimers.delete(timer);
    if (!response.destroyed) callback();
  }, delayMs);
  pendingTimers.add(timer);
  response.on("close", () => {
    if (response.writableEnded) return;
    clearTimeout(timer);
    pendingTimers.delete(timer);
  });
}

async function setFault(request, response) {
  try {
    const fault = await readJson(request);
    const allowed = allowedFaults.get(fault.path);
    if (!allowed?.has(fault.kind)) {
      sendJson(response, 400, { error: "Unsupported fixture fault" });
      return;
    }
    const delayMs =
      fault.kind === "delay" ? (fault.delayMs ?? 10_000) : undefined;
    if (
      delayMs !== undefined &&
      (!Number.isSafeInteger(delayMs) || delayMs < 1 || delayMs > 30_000)
    ) {
      sendJson(response, 400, { error: "Invalid delayMs" });
      return;
    }
    faults.set(fault.path, { kind: fault.kind, delayMs });
    sendJson(response, 201, { path: fault.path, kind: fault.kind });
  } catch {
    sendJson(response, 400, { error: "Invalid fixture fault" });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.search) {
    send(
      response,
      404,
      { "Content-Type": "text/plain; charset=utf-8" },
      "not found",
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/health") {
    send(
      response,
      200,
      { "Content-Type": "text/plain; charset=utf-8" },
      "ready",
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/__faults") {
    await setFault(request, response);
    return;
  }
  if (request.method === "POST" && url.pathname === "/__reset") {
    faults.clear();
    sendJson(response, 200, { reset: true });
    return;
  }
  if (request.method !== "GET") {
    send(
      response,
      405,
      { Allow: "GET, POST", "Content-Type": "text/plain; charset=utf-8" },
      "method not allowed",
    );
    return;
  }

  const entry = responses.get(url.pathname);
  if (!entry) {
    send(
      response,
      404,
      { "Content-Type": "text/plain; charset=utf-8" },
      "not found",
    );
    return;
  }
  const fault = faults.get(url.pathname);
  if (fault?.kind === "not-found") {
    const notFound = responses.get("/info/gla183-vcr-missing-20261101");
    send(response, notFound.status, notFound.headers, notFound.body);
    return;
  }
  if (fault?.kind === "corrupt") {
    const headers = { ...entry.headers };
    delete headers["content-length"];
    delete headers.etag;
    send(response, entry.status, headers, entry.body.subarray(0, 128));
    return;
  }
  const replay = () => send(response, entry.status, entry.headers, entry.body);
  if (fault?.kind === "delay") {
    scheduleResponse(response, fault.delayMs, replay);
    return;
  }
  replay();
});

server.on("error", (error) => {
  console.error(
    `Unable to start RubyGems cassette server on 127.0.0.1:${port}:`,
    error.message,
  );
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  console.log(`RubyGems cassette server listening on http://127.0.0.1:${port}`);
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const timer of pendingTimers) clearTimeout(timer);
  pendingTimers.clear();
  if (!server.listening) return;
  server.close(() => {
    process.exitCode = 0;
  });
  server.closeAllConnections();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
