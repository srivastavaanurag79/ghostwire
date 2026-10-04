#!/usr/bin/env node
/** CLI entry point for the GhostWire relay. See relay.mjs for the core. */
import { resolve } from "node:path";
import { createRelay } from "./relay.mjs";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const port = Number(arg("--port", process.env.PORT ?? "8787"));
const host = arg("--host", "0.0.0.0");
const serveDir = arg("--serve", null);

const relay = createRelay({ port, host, serveDir });
await relay.ready;
console.log(`GhostWire relay listening on ws://${host}:${relay.port}`);
if (serveDir) console.log(`Serving static files from ${resolve(serveDir)}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void relay.close().then(() => process.exit(0));
  });
}
