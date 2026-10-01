"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IslandFullscreenController } from "@/lib/catan-fullscreen";

export function useIslandFullscreen(onCollapse: () => void) {
  const [expanded, setExpanded] = useState(false);
  const controller = useRef<IslandFullscreenController | null>(null);

  useEffect(() => {
    const current = new IslandFullscreenController(document, (value) => {
      setExpanded(value);
      if (!value) onCollapse();
    });
    controller.current = current;
    return () => { controller.current = null; current.dispose(); };
  }, [onCollapse]);

  const close = useCallback(() => { controller.current?.exit(); }, []);
  const toggle = useCallback(() => {
    const current = controller.current;
    if (current?.expanded) current.exit();
    else current?.enter();
  }, []);

  return { expanded, toggle, close };
}
