#!/usr/bin/env node
/** Writes a per-build version stamp so clients can detect new deployments. */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const publicDir = new URL("../public/", import.meta.url);
mkdirSync(publicDir, { recursive: true });
const id = randomUUID();
writeFileSync(
  new URL("version.json", publicDir),
  JSON.stringify({ id, builtAt: new Date().toISOString() }, null, 2),
);
console.log(`stamped build ${id}`);
