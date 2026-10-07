#!/usr/bin/env node
/**
 * Guard against React Native / Hermes runtime crashes before building an APK.
 *
 * Hermes has no `TextEncoder`, `TextDecoder` or `Buffer`. Using them compiles
 * fine but throws "Property 'X' doesn't exist" at launch. This scans our built
 * output and native sources for those globals so the mistake is caught in CI
 * (and by `pnpm check:runtime`) instead of on a device.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["packages", "apps/native/src", "apps/native/App.tsx"];
const banned = [
  { pattern: /\bnew\s+TextEncoder\s*\(/, name: "TextEncoder" },
  { pattern: /\bnew\s+TextDecoder\s*\(/, name: "TextDecoder" },
  { pattern: /\bBuffer\.from\s*\(/, name: "Buffer" },
];
const skipDir = /(node_modules|\.test\.|dist\/.*\.d\.ts$)/;

/** @type {string[]} */
const files = [];
function walk(path) {
  let info;
  try {
    info = statSync(path);
  } catch {
    return;
  }
  if (info.isDirectory()) {
    for (const entry of readdirSync(path)) walk(join(path, entry));
    return;
  }
  if (/\.(ts|tsx|js|mjs|jsx)$/.test(path) && !skipDir.test(path) && !/\.test\./.test(path)) {
    files.push(path);
  }
}
for (const root of roots) walk(root);

const violations = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    // Ignore comment lines that merely mention the names.
    const trimmed = line.trim();
    if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
    for (const { pattern, name } of banned) {
      if (pattern.test(line)) violations.push(`${file}:${index + 1}: uses ${name}`);
    }
  });
}

if (violations.length > 0) {
  console.error("Hermes-unsafe globals found (these crash on React Native):\n");
  for (const violation of violations) console.error("  " + violation);
  console.error("\nUse @ghostwire/crypto's encodeUtf8/decodeUtf8 and base64 helpers instead.");
  process.exit(1);
}
console.log(`Hermes globals check passed (${files.length} files scanned).`);
