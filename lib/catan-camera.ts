export type BoardBounds = { x: number; y: number; width: number; height: number };
export type ViewportSize = { width: number; height: number };
export type BoardCamera = { x: number; y: number; zoom: number };
export type ScreenPoint = { x: number; y: number };
export type BoardPointer = ScreenPoint & { id: number };

export const MIN_BOARD_ZOOM = 1;
export const MAX_BOARD_ZOOM = 6;
export const BOARD_PAN_THRESHOLD = 8;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const positive = (value: number) => Number.isFinite(value) && value > 0 ? value : 1;

export function fitCamera(bounds: BoardBounds): BoardCamera {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, zoom: MIN_BOARD_ZOOM };
}

export function cameraMetrics(bounds: BoardBounds, size: ViewportSize, camera: BoardCamera) {
  const fitScale = Math.min(positive(size.width) / positive(bounds.width), positive(size.height) / positive(bounds.height));
  const scale = fitScale * clamp(positive(camera.zoom), MIN_BOARD_ZOOM, MAX_BOARD_ZOOM);
  const width = positive(size.width) / scale;
  const height = positive(size.height) / scale;
  return { fitScale, scale, width, height, viewBox: `${camera.x - width / 2} ${camera.y - height / 2} ${width} ${height}` };
}

export type BoardCameraFrame = ReturnType<typeof cameraMetrics> & { camera: BoardCamera };

/** Coalesce input bursts into one paint with the newest controller camera. */
export class BoardCameraFrameScheduler {
  private pending: number | null = null;

  constructor(
    private paint: () => void,
    private requestFrame: (callback: () => void) => number,
    private cancelFrame: (id: number) => void,
  ) {}

  request() {
    if (this.pending !== null) return;
    this.pending = this.requestFrame(() => {
      this.pending = null;
      this.paint();
    });
  }

  flush() {
    this.cancel();
    this.paint();
  }

  cancel() {
    if (this.pending === null) return;
    this.cancelFrame(this.pending);
    this.pending = null;
  }
}

export function constrainCamera(camera: BoardCamera, bounds: BoardBounds, size: ViewportSize): BoardCamera {
  const center = fitCamera(bounds);
  const zoom = clamp(positive(camera.zoom), MIN_BOARD_ZOOM, MAX_BOARD_ZOOM);
  const { width, height } = cameraMetrics(bounds, size, { ...camera, zoom });
  return {
    x: width >= bounds.width ? center.x : clamp(Number.isFinite(camera.x) ? camera.x : center.x, bounds.x + width / 2, bounds.x + bounds.width - width / 2),
    y: height >= bounds.height ? center.y : clamp(Number.isFinite(camera.y) ? camera.y : center.y, bounds.y + height / 2, bounds.y + bounds.height - height / 2),
    zoom,
  };
}

/** Preserve a chosen physical scale; an explicitly fitted overview keeps fitting. */
export function resizeCamera(camera: BoardCamera, previousBounds: BoardBounds, previousSize: ViewportSize, bounds: BoardBounds, size: ViewportSize): BoardCamera {
  const zoom = camera.zoom === MIN_BOARD_ZOOM ? MIN_BOARD_ZOOM
    : cameraMetrics(previousBounds, previousSize, camera).scale / cameraMetrics(bounds, size, fitCamera(bounds)).fitScale;
  return constrainCamera({ ...camera, zoom }, bounds, size);
}

export function panCamera(camera: BoardCamera, bounds: BoardBounds, size: ViewportSize, dx: number, dy: number): BoardCamera {
  const { scale } = cameraMetrics(bounds, size, camera);
  return constrainCamera({ ...camera, x: camera.x - dx / scale, y: camera.y - dy / scale }, bounds, size);
}

// Keep the world point under `from` beneath `to`, including a moving pinch midpoint.
export function transformCamera(camera: BoardCamera, bounds: BoardBounds, size: ViewportSize, factor: number, from: ScreenPoint, to: ScreenPoint): BoardCamera {
  const { scale } = cameraMetrics(bounds, size, camera);
  const zoomFactor = Number.isFinite(factor) && factor >= 0 ? factor : 1;
  const zoom = clamp(camera.zoom * zoomFactor, MIN_BOARD_ZOOM, MAX_BOARD_ZOOM);
  const nextScale = cameraMetrics(bounds, size, { ...camera, zoom }).scale;
  const anchorX = camera.x + (from.x - size.width / 2) / scale;
  const anchorY = camera.y + (from.y - size.height / 2) / scale;
  return constrainCamera({
    x: anchorX - (to.x - size.width / 2) / nextScale,
    y: anchorY - (to.y - size.height / 2) / nextScale,
    zoom,
  }, bounds, size);
}

export function zoomCamera(camera: BoardCamera, bounds: BoardBounds, size: ViewportSize, factor: number, anchor: ScreenPoint = { x: size.width / 2, y: size.height / 2 }): BoardCamera {
  return transformCamera(camera, bounds, size, factor, anchor, anchor);
}

type GestureReference = { camera: BoardCamera; point: ScreenPoint; distance: number; ids: number[] };
type CameraReference = { camera: BoardCamera; bounds: BoardBounds; size: ViewportSize };
export type BoardGestureResult = { camera: BoardCamera; capture: number[]; interactionActive: boolean };

const midpoint = (a: ScreenPoint, b: ScreenPoint): ScreenPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: ScreenPoint, b: ScreenPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/** DOM-independent gesture state. A complete pointer gesture owns its click suppression. */
export class BoardGestureController {
  camera: BoardCamera;
  private bounds: BoardBounds;
  private size: ViewportSize;
  private pointers = new Map<number, ScreenPoint>();
  private reference: GestureReference | null = null;
  private cameraReference: CameraReference;
  private gestureSuppressed = false;
  private clickBlocked = false;

  constructor(bounds: BoardBounds, size: ViewportSize) {
    this.bounds = bounds;
    this.size = size;
    this.camera = fitCamera(bounds);
    this.cameraReference = { camera: this.camera, bounds: { ...bounds }, size: { ...size } };
  }

  get interactionActive() { return this.pointers.size > 0 && this.gestureSuppressed; }

  hasPointer(id: number) { return this.pointers.has(id); }

  private result(capture: number[] = []): BoardGestureResult {
    return { camera: this.camera, capture, interactionActive: this.interactionActive };
  }

  private rebase() {
    const entries = [...this.pointers.entries()].slice(0, 2);
    this.reference = !entries.length ? null : {
      camera: { ...this.camera },
      point: entries.length === 2 ? midpoint(entries[0][1], entries[1][1]) : { ...entries[0][1] },
      distance: entries.length === 2 ? Math.max(1, distance(entries[0][1], entries[1][1])) : 0,
      ids: entries.map(([id]) => id),
    };
  }

  private chooseCamera(camera: BoardCamera, explicit = false) {
    if (explicit || camera.x !== this.camera.x || camera.y !== this.camera.y || camera.zoom !== this.camera.zoom) {
      this.cameraReference = { camera, bounds: { ...this.bounds }, size: { ...this.size } };
    }
    this.camera = camera;
  }

  updateViewport(bounds: BoardBounds, size: ViewportSize) {
    const chosen = this.cameraReference;
    this.bounds = bounds;
    this.size = size;
    // Derive every resize from the last user choice, avoiding cumulative scale
    // drift and allowing a temporary size/zoom clamp to reverse on restoration.
    this.camera = resizeCamera(chosen.camera, chosen.bounds, chosen.size, bounds, size);
    this.rebase();
  }

  setCamera(camera: BoardCamera): BoardGestureResult {
    this.chooseCamera(constrainCamera(camera, this.bounds, this.size), true);
    this.rebase();
    return this.result();
  }

  pointerDown(pointer: BoardPointer): BoardGestureResult {
    if (this.pointers.has(pointer.id)) return this.result();
    if (!this.pointers.size) this.gestureSuppressed = false;
    this.pointers.set(pointer.id, { x: pointer.x, y: pointer.y });
    if (this.pointers.size > 1) {
      this.gestureSuppressed = true;
      this.clickBlocked = true;
    }
    this.rebase();
    return this.result(this.gestureSuppressed ? [...this.pointers.keys()] : []);
  }

  pointerMove(pointer: BoardPointer): BoardGestureResult {
    if (!this.pointers.has(pointer.id) || !this.reference) return this.result();
    this.pointers.set(pointer.id, { x: pointer.x, y: pointer.y });
    const reference = this.reference;
    const a = this.pointers.get(reference.ids[0])!;
    const b = reference.ids.length === 2 ? this.pointers.get(reference.ids[1]) : undefined;
    if (b) {
      this.chooseCamera(transformCamera(reference.camera, this.bounds, this.size, distance(a, b) / reference.distance, reference.point, midpoint(a, b)));
    } else {
      const dx = a.x - reference.point.x;
      const dy = a.y - reference.point.y;
      if (!this.gestureSuppressed && Math.hypot(dx, dy) < BOARD_PAN_THRESHOLD) return this.result();
      this.gestureSuppressed = true;
      this.clickBlocked = true;
      this.chooseCamera(panCamera(reference.camera, this.bounds, this.size, dx, dy));
    }
    return this.result([...this.pointers.keys()]);
  }

  pointerUp(id: number): BoardGestureResult {
    if (!this.pointers.has(id)) return this.result();
    this.pointers.delete(id);
    // A new complete, stationary single-pointer tap is the only pointer action that
    // unlocks clicks. Lifting one finger after pinching cannot become a tap.
    if (!this.pointers.size) this.clickBlocked = this.gestureSuppressed;
    this.rebase();
    return this.result();
  }

  pointerCancel(id: number): BoardGestureResult {
    if (!this.pointers.has(id)) return this.result();
    this.gestureSuppressed = true;
    this.clickBlocked = true;
    this.pointers.delete(id);
    this.rebase();
    return this.result();
  }

  lostPointerCapture(id: number): BoardGestureResult { return this.pointerCancel(id); }

  cancelAll(): BoardGestureResult {
    if (this.pointers.size) {
      this.gestureSuppressed = true;
      this.clickBlocked = true;
      this.pointers.clear();
      this.reference = null;
    }
    return this.result();
  }

  suppressClick(pointerGenerated = true) {
    return pointerGenerated && (this.clickBlocked || this.pointers.size > 0);
  }
}
