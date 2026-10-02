// Observe real Web Audio playback. No fake buffers, shortened clips or clock.
// Installed before the application starts, only in the Playwright browser.
export function observeDemoAudio() {
  const activity = { contexts: [], voices: new Set(), started: 0, ended: 0, cancelled: 0, decoded: 0, decodeErrors: 0 };
  window.__catanDemoAudio = activity;
  const originalCreate = AudioContext.prototype.createBufferSource;
  const originalDecode = AudioContext.prototype.decodeAudioData;
  AudioContext.prototype.decodeAudioData = async function (...args) {
    try {
      const buffer = await originalDecode.apply(this, args);
      activity.decoded++;
      return buffer;
    } catch (error) { activity.decodeErrors++; throw error; }
  };
  AudioContext.prototype.createBufferSource = function (...args) {
    if (!activity.contexts.includes(this)) activity.contexts.push(this);
    const source = originalCreate.apply(this, args);
    const originalStart = source.start;
    const originalStop = source.stop;
    source.start = function (...startArgs) {
      originalStart.apply(this, startArgs);
      activity.voices.add(source);
      activity.started++;
      source.addEventListener("ended", () => {
        if (activity.voices.delete(source)) activity.ended++;
      }, { once: true });
    };
    source.stop = function (...stopArgs) {
      originalStop.apply(this, stopArgs);
      if (activity.voices.delete(source)) activity.cancelled++;
    };
    return source;
  };
}

export async function waitForDemoAudio(page, minimumPause, waitForAudio = true, expectedStarted = 0) {
  if (waitForAudio && expectedStarted) {
    // The HTTP response can precede React's effects. Wait for the actual
    // confirmed cues to start before deciding that an empty queue is idle.
    await page.waitForFunction((count) => window.__catanDemoAudio?.started >= count, expectedStarted, { timeout: 60000 });
  }
  // Even fast verification waits for the real dice overlay and UI transitions.
  await page.waitForFunction(() => !document.documentElement.classList.contains("catan-dice-rolling"));
  if (waitForAudio) {
    await page.waitForFunction(() => window.__catanDemoAudio?.voices.size === 0, null, { timeout: 60000 });
  }
  if (minimumPause > 0) await page.waitForTimeout(minimumPause);
}
