"use client";

/**
 * Tiny synthesized notification sounds (Web Audio). No asset files, no network,
 * nothing stored server-side. Audio is unlocked on the first user gesture to
 * satisfy browser autoplay policies.
 */
export type SoundName = "join" | "leave" | "request" | "message" | "success" | "error";

const STORAGE_KEY = "gw:sound";
let ctx: AudioContext | null = null;
let enabled = true;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

/** Resume the audio context after a user gesture (required by browsers). */
export function unlockAudio(): void {
  const context = audioContext();
  if (context && context.state === "suspended") void context.resume();
}

export function loadSoundPreference(): void {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value !== null) enabled = value === "1";
  } catch {
    /* preferences are best-effort */
  }
}

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (value) unlockAudio();
}

interface ToneOptions {
  freq: number;
  start: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
}

function tone(context: AudioContext, { freq, start, duration, type = "sine", gain = 0.06 }: ToneOptions): void {
  const osc = context.createOscillator();
  const amp = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  // Soft attack/decay so it never clicks.
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(context.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

const SEQUENCES: Record<SoundName, (t: number) => ToneOptions[]> = {
  join: (t) => [
    { freq: 587.33, start: t, duration: 0.16, gain: 0.05 },
    { freq: 880, start: t + 0.12, duration: 0.22, gain: 0.05 },
  ],
  leave: (t) => [
    { freq: 523.25, start: t, duration: 0.16, gain: 0.045 },
    { freq: 349.23, start: t + 0.12, duration: 0.22, gain: 0.045 },
  ],
  request: (t) => [
    { freq: 880, start: t, duration: 0.1, type: "triangle", gain: 0.06 },
    { freq: 880, start: t + 0.14, duration: 0.1, type: "triangle", gain: 0.06 },
    { freq: 1046.5, start: t + 0.28, duration: 0.16, type: "triangle", gain: 0.06 },
  ],
  message: (t) => [{ freq: 659.25, start: t, duration: 0.12, gain: 0.04 }],
  success: (t) => [
    { freq: 523.25, start: t, duration: 0.12, gain: 0.05 },
    { freq: 659.25, start: t + 0.1, duration: 0.12, gain: 0.05 },
    { freq: 783.99, start: t + 0.2, duration: 0.22, gain: 0.05 },
  ],
  error: (t) => [{ freq: 196, start: t, duration: 0.28, type: "sawtooth", gain: 0.04 }],
};

/** Play a notification sound (no-op when disabled or audio is unavailable). */
export function playSound(name: SoundName): void {
  if (!enabled) return;
  const context = audioContext();
  if (!context) return;
  if (context.state === "suspended") void context.resume();
  const now = context.currentTime + 0.02;
  for (const options of SEQUENCES[name](now)) tone(context, options);
}
