import type { WerewolfPhase, Winner } from "./werewolf";

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

export const WEREWOLF_RECORDED_CUES: Partial<Record<WerewolfPhase, string>> = {
  thief: "/audio/werwolf/thief.mp3",
  cupid: "/audio/werwolf/cupid.mp3",
  wild_child: "/audio/werwolf/wild-child.mp3",
  seer: "/audio/werwolf/seer.mp3",
  wolves: "/audio/werwolf/wolves.mp3",
  witch: "/audio/werwolf/witch.mp3",
  hunter: "/audio/werwolf/hunter.mp3",
  day_vote: "/audio/werwolf/village-vote.mp3",
  runoff: "/audio/werwolf/village-vote.mp3",
};

export const WEREWOLF_TRANSITION_CUES = {
  "sleep-all": "/audio/werwolf/sleep-all.mp3",
  "sleep-again": "/audio/werwolf/sleep-again.mp3",
  "night-start": "/audio/werwolf/night-start.mp3",
  "day-start": "/audio/werwolf/day-start.mp3",
} as const;

export const WEREWOLF_WINNER_CUES: Partial<Record<Exclude<Winner, null>, string>> = {
  village: "/audio/werwolf/victory-village.mp3",
  wolves: "/audio/werwolf/victory-wolves.mp3",
};

export const AUDIO_ANNOUNCEMENT_GAP_SECONDS = 5;

export type WerewolfAudioTransition = keyof typeof WEREWOLF_TRANSITION_CUES | null;
export const SECRET_AUDIO_PHASES = Object.freeze([...new Set([
  ...Object.keys(WEREWOLF_AUDIO_CUES),
  ...Object.keys(WEREWOLF_RECORDED_CUES),
])] as WerewolfPhase[]);

const CLOSE_EYES_CUE: readonly Tone[] = [
  tone(494, 0, 0.22, "sine", 0.065),
  tone(330, 0.2, 0.42, "sine", 0.075),
];

let context: AudioContext | null = null;
const recordings = new Map<string, AudioBuffer>();
let recordingsLoading: Promise<void> | null = null;

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
  return Math.max(0, ...pattern.map((note) => note.offset + note.duration));
}

function recordingPaths() {
  return [...new Set([...Object.values(WEREWOLF_RECORDED_CUES), ...Object.values(WEREWOLF_TRANSITION_CUES), ...Object.values(WEREWOLF_WINNER_CUES)].filter((path): path is string => Boolean(path)))];
}

async function preloadRecordings(audio: AudioContext) {
  recordingsLoading ??= Promise.all(recordingPaths().map(async (path) => {
    try {
      const response = await fetch(path, { cache: "force-cache" });
      if (!response.ok) return;
      recordings.set(path, await audio.decodeAudioData(await response.arrayBuffer()));
    } catch { /* synthesized cues remain available as a fallback */ }
  })).then(() => undefined);
  await recordingsLoading;
}

function scheduleRecording(audio: AudioContext, path: string | undefined, startAt: number) {
  if (!path) return 0;
  const buffer = recordings.get(path);
  if (!buffer) return 0;
  const source = audio.createBufferSource();
  const volume = audio.createGain();
  source.buffer = buffer;
  volume.gain.setValueAtTime(0.92, startAt);
  source.connect(volume).connect(audio.destination);
  source.start(startAt);
  return buffer.duration;
}

export async function unlockWerewolfAudio() {
  const audio = getContext();
  if (!audio) throw new Error("Dieses Gerät unterstützt keine Spieltöne.");
  if (audio.state !== "running") await audio.resume();
  await preloadRecordings(audio);
  schedulePattern(audio, [tone(523, 0, 0.1, "sine", 0.045), tone(784, 0.12, 0.16, "sine", 0.045)], audio.currentTime + 0.02);
}

export function playWerewolfPhaseCue(phase: WerewolfPhase, delayMs = 0, transition: WerewolfAudioTransition = "sleep-again") {
  const audio = getContext();
  const cue = WEREWOLF_AUDIO_CUES[phase];
  const recordedCue = WEREWOLF_RECORDED_CUES[phase];
  if (!audio || audio.state !== "running" || (!cue && !recordedCue)) return false;
  const begins = audio.currentTime + Math.max(0, delayMs) / 1000;
  if (transition === "day-start") {
    if (!scheduleRecording(audio, WEREWOLF_TRANSITION_CUES[transition], begins)) {
      if (!cue) return false;
      schedulePattern(audio, cue, begins);
    }
    return true;
  }
  let transitionDuration = transition ? scheduleRecording(audio, WEREWOLF_TRANSITION_CUES[transition], begins) : 0;
  if (transition && !transitionDuration) transitionDuration = schedulePattern(audio, CLOSE_EYES_CUE, begins);
  const cueStarts = begins + (transition ? transitionDuration + AUDIO_ANNOUNCEMENT_GAP_SECONDS : 0);
  if (!scheduleRecording(audio, recordedCue, cueStarts)) {
    if (!cue) return false;
    schedulePattern(audio, cue, cueStarts);
  }
  return true;
}

export function playWerewolfWinnerCue(winner: Winner, delayMs = 0) {
  const audio = getContext();
  const path = winner ? WEREWOLF_WINNER_CUES[winner] : undefined;
  if (!audio || audio.state !== "running" || !path) return false;
  return scheduleRecording(audio, path, audio.currentTime + Math.max(0, delayMs) / 1000) > 0;
}
