"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "catan-ambient-enabled";
const EVENT = "catan-ambient-preference";
let memory = true;
let storageUnavailable = false;
function snapshot() {
  if (storageUnavailable) return memory;
  try { return window.localStorage.getItem(KEY) !== "false"; } catch { return memory; }
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) listener(); };
  window.addEventListener("storage", storage);
  window.addEventListener(EVENT, listener);
  return () => { window.removeEventListener("storage", storage); window.removeEventListener(EVENT, listener); };
}
export function useAmbientPreference() {
  const enabled = useSyncExternalStore(subscribe, snapshot, () => true);
  const setEnabled = useCallback((value: boolean) => {
    memory = value;
    try { window.localStorage.setItem(KEY, String(value)); storageUnavailable = false; } catch { storageUnavailable = true; }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { enabled, setEnabled };
}
