#!/usr/bin/env node
/**
 * Writes a per-build version stamp so clients can detect new deployments, and
 * generates the service worker with that same build id baked in. Tying the SW
 * cache name to the build means every deploy installs a fresh worker and drops
 * the previous caches, so a device never keeps serving a stale JS chunk.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const publicDir = new URL("../public/", import.meta.url);
const templateUrl = new URL("sw.template.js", import.meta.url);
mkdirSync(publicDir, { recursive: true });

const id = randomUUID();
writeFileSync(
  new URL("version.json", publicDir),
  JSON.stringify({ id, builtAt: new Date().toISOString() }, null, 2),
);

const template = readFileSync(templateUrl, "utf8");
writeFileSync(new URL("sw.js", publicDir), template.replace("__GW_VERSION__", `ghostwire-${id}`));

console.log(`stamped build ${id}`);
