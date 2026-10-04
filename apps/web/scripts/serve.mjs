#!/usr/bin/env node
/** Minimal static server for the exported `out/` directory (local preview). */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(new URL("../out", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const port = Number(process.env.PORT ?? 3000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  const candidates = [];
  if (pathname === "/") candidates.push("index.html");
  else {
    candidates.push(pathname.replace(/^\//, ""));
    candidates.push(`${pathname.replace(/^\//, "")}.html`);
    candidates.push(join(pathname.replace(/^\//, ""), "index.html"));
  }
  for (const rel of candidates) {
    const file = normalize(join(root, rel));
    if (!file.startsWith(root)) continue;
    try {
      const info = await stat(file);
      if (info.isFile()) {
        const data = await readFile(file);
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
        res.end(data);
        return;
      }
    } catch {
      /* try next candidate */
    }
  }
  try {
    const data = await readFile(join(root, "404.html"));
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => {
  console.log(`GhostWire web (static) on http://localhost:${port}`);
});
