"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type PointerEvent as ReactPointerEvent } from "react";
import {
  BoardGestureController, cameraMetrics, fitCamera, resizeCamera, zoomCamera,
  type BoardBounds, type BoardGestureResult, type ScreenPoint, type ViewportSize,
} from "@/lib/catan-camera";

export function useBoardCamera({ x, y, width, height }: BoardBounds, { width: viewportWidth, height: viewportHeight }: ViewportSize) {
  const bounds = useMemo(() => ({ x, y, width, height }), [x, y, width, height]);
  const size = useMemo(() => ({ width: viewportWidth, height: viewportHeight }), [viewportWidth, viewportHeight]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const controller = useRef<BoardGestureController | null>(null);
  if (controller.current === null) controller.current = new BoardGestureController(bounds, size);
  const [chosenCamera, setCamera] = useState(() => ({ camera: fitCamera(bounds), bounds, size }));
  const [interactionActive, setInteractionActive] = useState(false);
  const camera = resizeCamera(chosenCamera.camera, chosenCamera.bounds, chosenCamera.size, bounds, size);
  const { viewBox, scale } = cameraMetrics(bounds, size, camera);

  const publish = useCallback((result: BoardGestureResult, explicit = false) => {
    setCamera((previous) => {
      const visible = resizeCamera(previous.camera, previous.bounds, previous.size, bounds, size);
      // Taps and gesture bookkeeping leave the user's original scale reference
      // intact. A camera change or explicit zoom/reset records the current size.
      return !explicit && visible.x === result.camera.x && visible.y === result.camera.y && visible.zoom === result.camera.zoom
        ? previous : { camera: result.camera, bounds, size };
    });
    setInteractionActive(result.interactionActive);
  }, [bounds, size]);

  useLayoutEffect(() => {
    controller.current!.updateViewport(bounds, size);
  }, [bounds, size]);

  const pointAt = useCallback((clientX: number, clientY: number): ScreenPoint => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) * size.width / (rect.width || 1), y: (clientY - rect.top) * size.height / (rect.height || 1) };
  }, [size.width, size.height]);

  const capture = useCallback((result: BoardGestureResult) => {
    const node = viewportRef.current;
    if (!node) return;
    for (const id of result.capture) {
      try {
        if (!node.hasPointerCapture(id)) node.setPointerCapture(id);
      } catch {
        // A pointer may have ended before its final movement reaches this handler.
      }
    }
  }, []);

  const move = useCallback((event: { pointerId: number; clientX: number; clientY: number }) => {
    const result = controller.current!.pointerMove({ id: event.pointerId, ...pointAt(event.clientX, event.clientY) });
    capture(result);
    publish(result);
  }, [pointAt, capture, publish]);

  const finish = useCallback((event: { pointerId: number; clientX: number; clientY: number }) => {
    // Include movement that arrived only with pointerup in the tap decision.
    controller.current!.pointerMove({ id: event.pointerId, ...pointAt(event.clientX, event.clientY) });
    publish(controller.current!.pointerUp(event.pointerId));
  }, [pointAt, publish]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
      const delta = Math.max(-600, Math.min(600, event.deltaY * unit));
      const factor = Math.exp(-delta * (event.ctrlKey ? .01 : .002));
      const next = zoomCamera(controller.current!.camera, bounds, size, factor, pointAt(event.clientX, event.clientY));
      publish(controller.current!.setCamera(next), true);
    };
    // React delegates wheel handlers passively; a local native listener keeps wheel
    // and trackpad pinch confined to this viewport without changing page gestures.
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [bounds, size, pointAt, publish]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const node = viewportRef.current;
      return node && controller.current!.hasPointer(event.pointerId) && !(event.target instanceof Node && node.contains(event.target));
    };
    const outsideMove = (event: PointerEvent) => { if (outside(event)) move(event); };
    const outsideUp = (event: PointerEvent) => { if (outside(event)) finish(event); };
    const outsideCancel = (event: PointerEvent) => { if (outside(event)) publish(controller.current!.pointerCancel(event.pointerId)); };
    const blur = () => publish(controller.current!.cancelAll());
    // Pending taps intentionally have no explicit capture, so also observe a
    // pointer that leaves the viewport before reaching the pan threshold.
    window.addEventListener("pointermove", outsideMove);
    window.addEventListener("pointerup", outsideUp);
    window.addEventListener("pointercancel", outsideCancel);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointermove", outsideMove);
      window.removeEventListener("pointerup", outsideUp);
      window.removeEventListener("pointercancel", outsideCancel);
      window.removeEventListener("blur", blur);
    };
  }, [move, finish, publish]);

  const viewportProps: Pick<HTMLAttributes<HTMLDivElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onLostPointerCapture" | "onClickCapture"> = {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const result = controller.current!.pointerDown({ id: event.pointerId, ...pointAt(event.clientX, event.clientY) });
      capture(result);
      publish(result);
    },
    onPointerMove: (event) => { if (controller.current!.hasPointer(event.pointerId)) move(event); },
    onPointerUp: (event) => { if (controller.current!.hasPointer(event.pointerId)) finish(event); },
    onPointerCancel: (event) => publish(controller.current!.pointerCancel(event.pointerId)),
    onLostPointerCapture: (event) => {
      // Taking explicit viewport capture from a touched SVG child causes that
      // child's implicit capture to be lost. Only our own loss is cancellation.
      if (event.target === event.currentTarget) publish(controller.current!.lostPointerCapture(event.pointerId));
    },
    onClickCapture: (event) => {
      const native = event.nativeEvent as MouseEvent & { pointerType?: string };
      const pointerGenerated = event.detail !== 0 || Boolean(native.pointerType);
      if (controller.current!.suppressClick(pointerGenerated)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };

  const reset = () => publish(controller.current!.setCamera(fitCamera(bounds)), true);
  const zoomBy = (factor: number) => publish(controller.current!.setCamera(zoomCamera(controller.current!.camera, bounds, size, factor)), true);
  return { camera, viewBox, scale, reset, zoomBy, viewportRef, viewportProps, interactionActive };
}
