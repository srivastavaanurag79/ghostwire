import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "apps/web/public/icons");
mkdirSync(outDir, { recursive: true });

const logo = readFileSync(resolve(root, "apps/web/public/logo.svg"));
const maskable = readFileSync(resolve(root, "apps/web/public/logo-maskable.svg"));

const jobs = [
  [logo, 192, "icon-192.png"],
  [logo, 512, "icon-512.png"],
  [logo, 180, "apple-touch-icon.png"],
  [maskable, 512, "icon-maskable-512.png"],
];

for (const [input, size, name] of jobs) {
  await sharp(input, { density: 384 }).resize(size, size).png().toFile(resolve(outDir, name));
  console.log(`wrote ${name}`);
}
