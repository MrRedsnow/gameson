import type { WerewolfPhase } from "./werewolf";

type Wave = OscillatorType;
type Tone = { frequency: number; endFrequency?: number; offset: number; duration: number; gain: number; wave: Wave };

const tone = (frequency: number, offset: number, duration: number, wave: Wave = "sine", gain = 0.1, endFrequency?: number): Tone => ({ frequency, endFrequency, offset, duration, gain, wave });

export const WEREWOLF_AUDIO_CUES: Partial<Record<WerewolfPhase, readonly Tone[]>> = {
  mayor_vote: [tone(523, 0, 0.22, "triangle"), tone(784, 0.24, 0.42, "sine")],
  thief: [tone(330, 0, 0.12, "square", 0.055), tone(659, 0.16, 0.16, "triangle"), tone(880, 0.35, 0.3, "triangle")],
  cupid: [tone(659, 0, 0.5, "sine"), tone(880, 0.08, 0.52, "sine"), tone(1047, 0.42, 0.42, "sine", 0.075)],
  wild_child: [tone(196, 0, 0.65, "sawtooth", 0.055, 294), tone(392, 0.5, 0.28, "triangle", 0.07)],
  healer: [tone(330, 0, 0.34, "sine"), tone(440, 0.3, 0.34, "sine"), tone(554, 0.6, 0.48, "sine")],
  seer: [tone(784, 0, 0.22, "sine"), tone(1047, 0.2, 0.26, "sine"), tone(1319, 0.44, 0.52, "sine", 0.065)],
  wolves: [tone(196, 0, 0.95, "sawtooth", 0.065, 147), tone(98, 0.18, 1.05, "triangle", 0.08, 123)],
  witch: [tone(277, 0, 0.2, "triangle"), tone(415, 0.16, 0.2, "triangle"), tone(554, 0.32, 0.22, "triangle"), tone(370, 0.52, 0.48, "sine")],
  white_werewolf: [tone(233, 0, 0.78, "sawtooth", 0.06, 175), tone(1175, 0.62, 0.24, "triangle", 0.065), tone(131, 0.72, 0.54, "sine", 0.08)],
  piper: [tone(880, 0, 0.24, "sine"), tone(988, 0.22, 0.24, "sine"), tone(1175, 0.44, 0.5, "sine", 0.075)],
  hunter: [tone(110, 0, 0.13, "square", 0.085), tone(82, 0.18, 0.34, "square", 0.07)],
  dawn: [tone(392, 0, 0.28, "sine"), tone(523, 0.24, 0.3, "sine"), tone(659, 0.5, 0.5, "sine")],
};

export const SECRET_AUDIO_PHASES = Object.freeze(Object.keys(WEREWOLF_AUDIO_CUES) as WerewolfPhase[]);

const CLOSE_EYES_CUE: readonly Tone[] = [
  tone(494, 0, 0.22, "sine", 0.065),
  tone(330, 0.2, 0.42, "sine", 0.075),
];

let context: AudioContext | null = null;

function getContext() {
  if (typeof window === "undefined") return null;
  const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  context ??= new AudioContextConstructor();
  return context;
}

function schedulePattern(audio: AudioContext, pattern: readonly Tone[], startAt: number) {
  for (const note of pattern) {
    const oscillator = audio.createOscillator();
    const volume = audio.createGain();
    const starts = startAt + note.offset;
    const ends = starts + note.duration;
    oscillator.type = note.wave;
    oscillator.frequency.setValueAtTime(note.frequency, starts);
    if (note.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(note.endFrequency, ends);
    volume.gain.setValueAtTime(0.0001, starts);
    volume.gain.exponentialRampToValueAtTime(note.gain, starts + Math.min(0.035, note.duration / 4));
    volume.gain.exponentialRampToValueAtTime(0.0001, ends);
    oscillator.connect(volume).connect(audio.destination);
    oscillator.start(starts);
    oscillator.stop(ends + 0.04);
  }
}

export async function unlockWerewolfAudio() {
  const audio = getContext();
  if (!audio) throw new Error("Dieses Gerät unterstützt keine Spieltöne.");
  if (audio.state !== "running") await audio.resume();
  schedulePattern(audio, [tone(523, 0, 0.1, "sine", 0.045), tone(784, 0.12, 0.16, "sine", 0.045)], audio.currentTime + 0.02);
}

export function playWerewolfPhaseCue(phase: WerewolfPhase, delayMs = 0) {
  const audio = getContext();
  const cue = WEREWOLF_AUDIO_CUES[phase];
  if (!audio || audio.state !== "running" || !cue) return false;
  const begins = audio.currentTime + Math.max(0, delayMs) / 1000;
  schedulePattern(audio, CLOSE_EYES_CUE, begins);
  schedulePattern(audio, cue, begins + 0.72);
  return true;
}
