import type { Resource } from "./catan";

const AUDIO_ROOT = "/audio/catan/v1/";
export const CATAN_SOUND_FILES = {
  resource_wood_gain: "resource-wood-gain.mp3",
  resource_brick_gain: "resource-brick-gain.mp3",
  resource_wool_gain: "resource-wool-gain.mp3",
  resource_grain_gain: "resource-grain-gain.mp3",
  resource_ore_gain: "resource-ore-gain.mp3",
  dice_roll: "dice-roll.mp3",
  build_road: "build-road.mp3",
  build_settlement: "build-settlement.mp3",
  build_city: "build-city.mp3",
  development_draw: "development-draw.mp3",
  development_play: "development-play.mp3",
  trade_offer_received: "trade-offer-received.mp3",
  trade_complete: "trade-complete.mp3",
  robber_seven: "robber-seven.mp3",
  robber_move: "robber-move.mp3",
  resource_steal: "resource-steal.mp3",
  turn_start: "turn-start.mp3",
  special_award: "special-award.mp3",
  game_won: "game-won.mp3",
  ui_select: "ui-select.mp3",
  ui_cancel: "ui-cancel.mp3",
  ui_error: "ui-error.mp3",
} as const;

export type CatanSoundId = keyof typeof CATAN_SOUND_FILES;
export const RESOURCE_SOUNDS: Record<Resource, CatanSoundId> = {
  wood: "resource_wood_gain", brick: "resource_brick_gain", wool: "resource_wool_gain",
  grain: "resource_grain_gain", ore: "resource_ore_gain",
};
type SoundChannel = "game" | "ui" | "preview";

/** Decoded local samples are reused; pending playback is cancelled when muted or closed. */
export class CatanSoundPlayer {
  private context = new AudioContext();
  private output = this.context.createGain();
  private buffers = new Map<CatanSoundId, Promise<AudioBuffer | null>>();
  private voices = new Map<AudioBufferSourceNode, SoundChannel>();
  private loading = new AbortController();
  private queue: Promise<void> = Promise.resolve();
  private scheduledUntil = 0;
  private generation = 0;
  private previewGeneration = 0;
  private closed = false;

  constructor() {
    this.output.gain.value = .75;
    this.output.connect(this.context.destination);
  }

  private load(id: CatanSoundId) {
    const cached = this.buffers.get(id);
    if (cached) return cached;
    const pending = fetch(AUDIO_ROOT + CATAN_SOUND_FILES[id], { signal: this.loading.signal })
      .then((response) => { if (!response.ok) throw new Error("Sound unavailable"); return response.arrayBuffer(); })
      .then((data) => this.context.decodeAudioData(data))
      .catch(() => { this.buffers.delete(id); return null; });
    this.buffers.set(id, pending);
    return pending;
  }

  async resume() {
    if (this.closed) return;
    await this.context.resume();
    if (!this.closed) {
      for (const id of Object.keys(CATAN_SOUND_FILES) as CatanSoundId[]) void this.load(id);
    }
  }

  play(effects: readonly CatanSoundId[], channel: SoundChannel = "game") {
    if (this.closed || this.context.state !== "running" || !effects.length) return Promise.resolve();
    const generation = this.generation;
    const previewGeneration = channel === "preview" ? ++this.previewGeneration : this.previewGeneration;
    if (channel === "preview") this.stopVoices("preview");
    const prepared = Promise.all(effects.map((id) => this.load(id)));
    const run = async () => {
      const buffers = await prepared;
      if (this.closed || this.generation !== generation || this.context.state !== "running" ||
        (channel === "preview" && previewGeneration !== this.previewGeneration)) return;
      let at = channel === "game" ? Math.max(this.context.currentTime + .02, this.scheduledUntil) : this.context.currentTime + .01;
      for (const buffer of buffers) {
        if (!buffer) continue;
        // Bound simultaneous voices even when controls are clicked rapidly.
        if (this.voices.size >= 16) this.release(this.voices.keys().next().value!, true);
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.output);
        this.voices.set(source, channel);
        source.onended = () => this.release(source);
        source.start(at);
        at += buffer.duration + .06;
      }
      if (channel === "game") this.scheduledUntil = at;
    };
    if (channel !== "game") return run();
    this.queue = this.queue.then(run).catch(() => {});
    return this.queue;
  }

  private release(source: AudioBufferSourceNode, stop = false) {
    source.onended = null;
    if (stop) { try { source.stop(); } catch { /* It may have ended already. */ } }
    source.disconnect();
    this.voices.delete(source);
  }

  private stopVoices(channel?: SoundChannel) {
    for (const [source, sourceChannel] of this.voices) {
      if (!channel || channel === sourceChannel) this.release(source, true);
    }
  }

  stop() {
    this.generation++;
    this.previewGeneration++;
    this.queue = Promise.resolve();
    this.scheduledUntil = 0;
    this.stopVoices();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stop();
    this.loading.abort();
    this.output.disconnect();
    void this.context.close().catch(() => {});
  }
}
