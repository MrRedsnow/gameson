import assert from "node:assert/strict";
import test from "node:test";
import {
  playWerewolfPhaseCue,
  playWerewolfWinnerCue,
  stopWerewolfAudio,
  unlockWerewolfAudio,
} from "../lib/werewolf-audio.ts";

test("lässt bei schnellen Phasenwechseln nur die neueste Audioansage laufen", async (t) => {
  const bufferSources = [];
  const oscillators = [];

  class FakeAudioParam {
    setValueAtTime() {}
    exponentialRampToValueAtTime() {}
  }

  class FakeGainNode {
    gain = new FakeAudioParam();
    disconnected = false;
    connect(node) { return node; }
    disconnect() { this.disconnected = true; }
  }

  class FakeScheduledSource {
    onended = null;
    starts = [];
    stops = [];
    disconnected = false;
    connect(node) { return node; }
    disconnect() { this.disconnected = true; }
    start(at) { this.starts.push(at); }
    stop(at) { this.stops.push(at); }
  }

  class FakeBufferSource extends FakeScheduledSource {
    buffer = null;
  }

  class FakeOscillator extends FakeScheduledSource {
    frequency = new FakeAudioParam();
    type = "sine";
  }

  class FakeAudioContext {
    currentTime = 10;
    destination = {};
    state = "running";
    createBufferSource() { const source = new FakeBufferSource(); bufferSources.push(source); return source; }
    createGain() { return new FakeGainNode(); }
    createOscillator() { const source = new FakeOscillator(); oscillators.push(source); return source; }
    async decodeAudioData() { return { duration: 2 }; }
    async resume() { this.state = "running"; }
  }

  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { AudioContext: FakeAudioContext };
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  t.after(() => {
    stopWerewolfAudio();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  });

  await unlockWerewolfAudio();
  assert.equal(playWerewolfPhaseCue("seer", 800, "sleep-again", 3), true);
  const firstAnnouncement = bufferSources.slice();
  assert.equal(firstAnnouncement.length, 2, "Übergang und Rollenansage werden gemeinsam eingeplant");
  assert.ok(firstAnnouncement[1].starts[0] > firstAnnouncement[0].starts[0], "die Rollenansage liegt nach Übergang und Pause");

  assert.equal(playWerewolfPhaseCue("witch", 0, null, 0), true);
  const latestPhase = bufferSources.at(-1);
  assert.ok(firstAnnouncement.every((source) => source.stops.length === 1 && source.disconnected), "alle alten, auch später geplanten Quellen werden gestoppt");
  assert.equal(latestPhase.stops.length, 0, "die neueste Phasenansage bleibt aktiv");

  assert.equal(playWerewolfWinnerCue("village"), true);
  const winnerAnnouncement = bufferSources.at(-1);
  assert.equal(latestPhase.stops.length, 1, "die Siegeransage ersetzt die vorherige Phasenansage");
  assert.equal(winnerAnnouncement.stops.length, 0, "nur die Siegeransage bleibt aktiv");

  stopWerewolfAudio();
  assert.equal(winnerAnnouncement.stops.length, 1, "explizites Aufräumen stoppt auch die letzte Ansage");
  assert.ok(oscillators.every((source) => source.disconnected), "auch synthetische Freischalttöne werden aufgeräumt");
});
