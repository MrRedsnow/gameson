import type { Resource } from "./catan";

/** Small synthesized effects: no network requests, also usable offline. */
export class CatanSoundPlayer {
  private context: AudioContext;
  private voices = new Set<AudioScheduledSourceNode>();
  private wood: AudioBuffer;

  constructor() {
    this.context = new AudioContext();
    this.wood = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * .28), this.context.sampleRate);
    const samples = this.wood.getChannelData(0);
    let seed = 42;
    for (let i = 0; i < samples.length; i++) {
      const t = i / this.context.sampleRate;
      seed = seed * 16807 % 2147483647;
      const noise = seed / 1073741823.5 - 1;
      samples[i] = .24 * (noise * Math.exp(-t * 95) + .7 * Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 23) + .4 * Math.sin(2 * Math.PI * 570 * t) * Math.exp(-t * 38));
    }
  }

  async resume() { await this.context.resume(); }

  private start(source: AudioScheduledSourceNode, at: number, duration: number, cleanup: () => void = () => {}) {
    this.voices.add(source);
    source.onended = () => { this.voices.delete(source); source.disconnect(); cleanup(); };
    source.start(at); source.stop(at + duration);
  }

  private chop(at: number) {
    for (const offset of [0, .32]) {
      const source = this.context.createBufferSource();
      source.buffer = this.wood; source.connect(this.context.destination);
      this.start(source, at + offset, this.wood.duration);
    }
  }

  private bleat(at: number) {
    const voice = this.context.createOscillator(); voice.type = "sawtooth";
    voice.frequency.setValueAtTime(135, at);
    voice.frequency.exponentialRampToValueAtTime(185, at + .12);
    voice.frequency.exponentialRampToValueAtTime(120, at + .7);
    const vibrato = this.context.createOscillator(); vibrato.frequency.value = 7;
    const wobble = this.context.createGain(); wobble.gain.value = 9;
    vibrato.connect(wobble); wobble.connect(voice.frequency);
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(.3, at + .06);
    envelope.gain.setValueAtTime(.3, at + .3);
    envelope.gain.exponentialRampToValueAtTime(.001, at + .72);
    envelope.connect(this.context.destination);
    const filters = [550, 1050, 2100].map((frequency, i) => {
      const filter = this.context.createBiquadFilter(); filter.type = "bandpass";
      filter.frequency.value = frequency; filter.Q.value = 4 + i;
      voice.connect(filter); filter.connect(envelope); return filter;
    });
    this.start(vibrato, at, .75, () => wobble.disconnect());
    this.start(voice, at, .75, () => { filters.forEach((filter) => filter.disconnect()); envelope.disconnect(); });
  }

  play(resources: Resource[]) {
    if (this.context.state !== "running") return;
    this.stop();
    const effects = [...new Set(resources.filter((r) => r === "wood" || r === "wool"))];
    effects.forEach((resource, i) => {
      const at = this.context.currentTime + .02 + i * .85;
      if (resource === "wood") this.chop(at); else this.bleat(at);
    });
  }

  stop() {
    for (const voice of this.voices) {
      try { voice.stop(); } catch { /* A voice may already have ended. */ }
    }
    this.voices.clear();
  }

  close() { this.stop(); void this.context.close().catch(() => {}); }
}
