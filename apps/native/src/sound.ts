import { Audio } from "expo-av";

/**
 * Notification sounds for the native app. The short WAV tones are generated
 * (see `scripts/generate-sounds.mjs`) and bundled, so nothing is downloaded.
 */
export type SoundName = "join" | "leave" | "request" | "message" | "success" | "error";

const SOURCES: Record<SoundName, number> = {
  join: require("../assets/sounds/join.wav"),
  leave: require("../assets/sounds/leave.wav"),
  request: require("../assets/sounds/request.wav"),
  message: require("../assets/sounds/message.wav"),
  success: require("../assets/sounds/success.wav"),
  error: require("../assets/sounds/error.wav"),
};

let enabled = true;
const cache = new Map<SoundName, Audio.Sound>();

export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

export function isSoundEnabled(): boolean {
  return enabled;
}

export async function playSound(name: SoundName): Promise<void> {
  if (!enabled) return;
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, shouldDuckAndroid: true });
    let sound = cache.get(name);
    if (!sound) {
      sound = new Audio.Sound();
      await sound.loadAsync(SOURCES[name]);
      cache.set(name, sound);
    }
    await sound.setPositionAsync(0);
    await sound.playAsync();
  } catch {
    /* sound is best-effort */
  }
}
