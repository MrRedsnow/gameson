"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type PointerEvent as ReactPointerEvent } from "react";
import {
  BoardCameraFrameScheduler, BoardGestureController, cameraMetrics, fitCamera, resizeCamera, zoomCamera,
  type BoardBounds, type BoardCameraFrame, type BoardGestureResult, type ScreenPoint, type ViewportSize,
} from "@/lib/catan-camera";

const WHEEL_IDLE_MS = 160;

type BoardCameraOptions = { onFrame?: (frame: BoardCameraFrame) => void };

export function useBoardCamera({ x, y, width, height }: BoardBounds, { width: viewportWidth, height: viewportHeight }: ViewportSize, { onFrame }: BoardCameraOptions = {}) {
  const bounds = useMemo(() => ({ x, y, width, height }), [x, y, width, height]);
  const size = useMemo(() => ({ width: viewportWidth, height: viewportHeight }), [viewportWidth, viewportHeight]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const controller = useRef<BoardGestureController | null>(null);
  if (controller.current === null) controller.current = new BoardGestureController(bounds, size);
  const [chosenCamera, setCamera] = useState(() => ({ camera: fitCamera(bounds), bounds, size }));
  const [interactionActive, setInteractionActive] = useState(false);
  const interaction = useRef(false);
  const wheelIdle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportRect = useRef<DOMRect | null>(null);
  const capturedPointers = useRef(new Set<number>());
  const frameContext = useRef({ bounds, size, onFrame });
  const scheduler = useRef<BoardCameraFrameScheduler | null>(null);
  // React owns settled camera-dependent controls and hit areas. Pointer and wheel
  // movement paint through the frame callback without rebuilding the SVG tree.
  const camera = resizeCamera(chosenCamera.camera, chosenCamera.bounds, chosenCamera.size, bounds, size);
  const { viewBox, scale } = cameraMetrics(bounds, size, camera);

  const snapshot = useCallback((result: BoardGestureResult, explicit = false) => {
    const { bounds, size } = frameContext.current;
    setCamera((previous) => {
      const visible = resizeCamera(previous.camera, previous.bounds, previous.size, bounds, size);
      // Taps preserve the original scale reference across temporary resize limits.
      return !explicit && visible.x === result.camera.x && visible.y === result.camera.y && visible.zoom === result.camera.zoom
        ? previous : { camera: result.camera, bounds, size };
    });
  }, []);

  const publish = useCallback((result: BoardGestureResult, settled = false, explicit = false) => {
    const active = result.interactionActive || wheelIdle.current !== null;
    const changed = interaction.current !== active;
    if (changed) {
      interaction.current = active;
      setInteractionActive(active);
    }
    if (explicit || changed || settled && !active) snapshot(result, explicit);
    scheduler.current!.request();
  }, [snapshot, setInteractionActive]);

  useLayoutEffect(() => {
    controller.current!.updateViewport(bounds, size);
    viewportRect.current = null;
  }, [bounds, size]);

  useLayoutEffect(() => {
    frameContext.current = { bounds, size, onFrame };
    // An unrelated game update can move the viewport without resizing it.
    // Re-read its position on the next input, never on every movement event.
    viewportRect.current = null;
    if (scheduler.current === null) scheduler.current = new BoardCameraFrameScheduler(() => {
      const current = frameContext.current;
      const camera = controller.current!.camera;
      current.onFrame?.({ camera, ...cameraMetrics(current.bounds, current.size, camera) });
    }, (callback) => window.requestAnimationFrame(callback), (id) => window.cancelAnimationFrame(id));
    // A game update can render while a gesture is moving. Restore the current
    // camera before paint rather than letting its settled React snapshot jump.
    scheduler.current!.flush();
  });

  const pointAt = useCallback((clientX: number, clientY: number, refresh = false): ScreenPoint => {
    const rect = !refresh && viewportRect.current || viewportRef.current!.getBoundingClientRect();
    viewportRect.current = rect;
    return { x: (clientX - rect.left) * size.width / (rect.width || 1), y: (clientY - rect.top) * size.height / (rect.height || 1) };
  }, [size.width, size.height]);

  const capture = useCallback((result: BoardGestureResult) => {
    const node = viewportRef.current;
    if (!node) return;
    for (const id of result.capture) {
      try {
        if (!node.hasPointerCapture(id)) node.setPointerCapture(id);
        capturedPointers.current.add(id);
      } catch {
        // A pointer may have ended before its final movement reaches this handler.
      }
    }
  }, []);

  const releaseCapture = useCallback((id?: number) => {
    const node = viewportRef.current;
    const ids = id === undefined ? [...capturedPointers.current] : [id];
    for (const pointer of ids) {
      capturedPointers.current.delete(pointer);
      try {
        if (node?.hasPointerCapture(pointer)) node.releasePointerCapture(pointer);
      } catch {
        // The browser may already have released an ended or cancelled pointer.
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
    const result = controller.current!.pointerUp(event.pointerId);
    releaseCapture(event.pointerId);
    publish(result, true);
    viewportRect.current = null;
  }, [pointAt, publish, releaseCapture]);

  const cancel = useCallback((id: number) => {
    if (!controller.current!.hasPointer(id)) return;
    const result = controller.current!.pointerCancel(id);
    releaseCapture(id);
    publish(result, true);
  }, [publish, releaseCapture]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
      const delta = Math.max(-600, Math.min(600, event.deltaY * unit));
      const factor = Math.exp(-delta * (event.ctrlKey ? .01 : .002));
      const next = zoomCamera(controller.current!.camera, bounds, size, factor, pointAt(event.clientX, event.clientY, wheelIdle.current === null));
      if (wheelIdle.current !== null) clearTimeout(wheelIdle.current);
      wheelIdle.current = setTimeout(() => {
        wheelIdle.current = null;
        viewportRect.current = null;
        publish({ camera: controller.current!.camera, capture: [], interactionActive: controller.current!.interactionActive }, true);
      }, WHEEL_IDLE_MS);
      publish(controller.current!.setCamera(next));
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
    const outsideCancel = (event: PointerEvent) => { if (outside(event)) cancel(event.pointerId); };
    const blur = () => {
      if (wheelIdle.current !== null) clearTimeout(wheelIdle.current);
      wheelIdle.current = null;
      viewportRect.current = null;
      const result = controller.current!.cancelAll();
      releaseCapture();
      publish(result, true);
    };
    const invalidateRect = () => { viewportRect.current = null; };
    // Pending taps intentionally have no explicit capture, so also observe a
    // pointer that leaves the viewport before reaching the pan threshold.
    window.addEventListener("pointermove", outsideMove);
    window.addEventListener("pointerup", outsideUp);
    window.addEventListener("pointercancel", outsideCancel);
    window.addEventListener("blur", blur);
    window.addEventListener("scroll", invalidateRect, true);
    return () => {
      window.removeEventListener("pointermove", outsideMove);
      window.removeEventListener("pointerup", outsideUp);
      window.removeEventListener("pointercancel", outsideCancel);
      window.removeEventListener("blur", blur);
      window.removeEventListener("scroll", invalidateRect, true);
    };
  }, [move, finish, cancel, publish, releaseCapture]);

  useEffect(() => () => {
    controller.current!.cancelAll();
    releaseCapture();
    scheduler.current!.cancel();
    if (wheelIdle.current !== null) clearTimeout(wheelIdle.current);
    wheelIdle.current = null;
  }, [releaseCapture]);

  const viewportProps: Pick<HTMLAttributes<HTMLDivElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onLostPointerCapture" | "onClickCapture"> = {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const result = controller.current!.pointerDown({ id: event.pointerId, ...pointAt(event.clientX, event.clientY, true) });
      capture(result);
      publish(result);
    },
    onPointerMove: (event) => { if (controller.current!.hasPointer(event.pointerId)) move(event); },
    onPointerUp: (event) => { if (controller.current!.hasPointer(event.pointerId)) finish(event); },
    onPointerCancel: (event) => cancel(event.pointerId),
    onLostPointerCapture: (event) => {
      // Taking explicit viewport capture from a touched SVG child causes that
      // child's implicit capture to be lost. Only our own loss is cancellation.
      if (event.target === event.currentTarget) cancel(event.pointerId);
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

  const reset = () => publish(controller.current!.setCamera(fitCamera(bounds)), true, true);
  const zoomBy = (factor: number) => publish(controller.current!.setCamera(zoomCamera(controller.current!.camera, bounds, size, factor)), true, true);
  return { camera, viewBox, scale, reset, zoomBy, viewportRef, viewportProps, interactionActive };
}
