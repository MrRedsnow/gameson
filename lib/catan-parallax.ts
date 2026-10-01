import { cameraMetrics, constrainCamera, fitCamera, type BoardBounds, type BoardCamera, type ViewportSize } from "./catan-camera";

const SEA_PARALLAX = .20;
const positive = (value: number) => Number.isFinite(value) && value > 0 ? value : 1;

/** A slower sea camera, with enough image coverage for every permitted island position. */
export function seaParallax(bounds: BoardBounds, size: ViewportSize, camera: BoardCamera) {
  const viewport = { width: positive(size.width), height: positive(size.height) };
  const visible = constrainCamera(camera, bounds, viewport);
  const center = fitCamera(bounds);
  const { fitScale } = cameraMetrics(bounds, viewport, visible);
  const imageSize = Math.max(viewport.width, viewport.height) * (1 + SEA_PARALLAX * (1 - 1 / visible.zoom));
  const offset = (delta: number, axis: number) => {
    // Leave one pixel inside the image at each edge to absorb subpixel rounding.
    const margin = Math.max(0, (imageSize - axis) / 2 - 1);
    return Math.max(-margin, Math.min(margin, SEA_PARALLAX * fitScale * delta));
  };
  return { size: imageSize, x: offset(center.x - visible.x, viewport.width), y: offset(center.y - visible.y, viewport.height) };
}
