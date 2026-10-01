"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CatanBuildHandoff, type BuildHandoff } from "@/lib/catan-build-handoff";

const serverSnapshot = () => null;

export function useBuildHandoff(onFinish: () => void) {
  const [controller] = useState(() => new CatanBuildHandoff(onFinish));
  const transition = useSyncExternalStore(controller.subscribe, controller.getSnapshot, serverSnapshot);
  useEffect(() => () => controller.finish(), [controller]);

  const start = (value: BuildHandoff) => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    return controller.start(value, {
      canAnimate: () => !document.hidden && !motion.matches,
      afterPaint: (callback) => {
        const frame = requestAnimationFrame(callback);
        return () => cancelAnimationFrame(frame);
      },
      delay: (callback, duration) => {
        const timer = window.setTimeout(callback, duration);
        return () => clearTimeout(timer);
      },
      onInterruption: (callback) => {
        const check = () => { if (document.hidden || motion.matches) callback(); };
        document.addEventListener("visibilitychange", check);
        motion.addEventListener("change", check);
        return () => {
          document.removeEventListener("visibilitychange", check);
          motion.removeEventListener("change", check);
        };
      },
    });
  };
  return { transition, start, finish: controller.finish };
}
