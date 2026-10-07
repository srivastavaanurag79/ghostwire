#!/usr/bin/env node
/**
 * Generates tiny notification-tone WAV files (16-bit PCM, mono) for the native
 * app, so no external audio assets are needed. Mirrors the web sound palette.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "apps/native/assets/sounds");
mkdirSync(outDir, { recursive: true });

const RATE = 22050;

function tone({ freq, start, duration, gain = 0.3, type = "sine" }) {
  const samples = Math.floor(duration * RATE);
  const out = new Float32Array(samples);
  const startSample = Math.floor(start * RATE);
  for (let i = 0; i < samples; i++) {
    const t = i / RATE;
    const env = Math.min(1, i / (0.01 * RATE)) * Math.exp(-t * 6);
    let value = Math.sin(2 * Math.PI * freq * t);
    if (type === "sawtooth") {
      value = 2 * ((freq * t) % 1) - 1;
    }
    out[i] = value * env * gain;
    void startSample;
  }
  return out;
}

function sequence(notes) {
  const total = Math.max(...notes.map((n) => n.start + n.duration));
  const buffer = new Float32Array(Math.ceil(total * RATE));
  for (const note of notes) {
    const part = tone(note);
    for (let i = 0; i < part.length; i++) buffer[i] += part[i];
  }
  // clamp
  for (let i = 0; i < buffer.length; i++) buffer[i] = Math.max(-1, Math.min(1, buffer[i]));
  return buffer;
}

function toWav(samples) {
  const dataLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(Math.round(samples[i] * 32767), 44 + i * 2);
  }
  return buffer;
}

const sounds = {
  message: [{ freq: 659.25, start: 0, duration: 0.14, gain: 0.25 }],
  join: [
    { freq: 587.33, start: 0, duration: 0.16, gain: 0.3 },
    { freq: 880, start: 0.12, duration: 0.22, gain: 0.3 },
  ],
  leave: [
    { freq: 523.25, start: 0, duration: 0.16, gain: 0.28 },
    { freq: 349.23, start: 0.12, duration: 0.22, gain: 0.28 },
  ],
  request: [
    { freq: 880, start: 0, duration: 0.1, gain: 0.3 },
    { freq: 880, start: 0.14, duration: 0.1, gain: 0.3 },
    { freq: 1046.5, start: 0.28, duration: 0.16, gain: 0.3 },
  ],
  success: [
    { freq: 523.25, start: 0, duration: 0.12, gain: 0.28 },
    { freq: 659.25, start: 0.1, duration: 0.12, gain: 0.28 },
    { freq: 783.99, start: 0.2, duration: 0.22, gain: 0.28 },
  ],
  error: [{ freq: 196, start: 0, duration: 0.28, gain: 0.25, type: "sawtooth" }],
};

for (const [name, notes] of Object.entries(sounds)) {
  writeFileSync(resolve(outDir, `${name}.wav`), toWav(sequence(notes)));
  console.log(`wrote ${name}.wav`);
}
