import { TileContext } from '../types';

/**
 * Backing-store scale is capped here by default.
 *
 * A canvas costs `width * height * 4` bytes, so the memory a tile occupies
 * grows with the *square* of the ratio: at 256px, ratio 1 is 256KB, ratio 2 is
 * 1MB and ratio 3 is 2.25MB. Ratio 2 is where the visible return flattens out
 * on the phone screens that report 3 and 4, so that is the default ceiling.
 */
export const DEFAULT_MAX_PIXEL_RATIO = 2;

/**
 * Backing-store scale to render tiles at, given a caller-supplied ceiling.
 *
 * Returns 1 outside a browser, and never returns a value below 1 - a ratio
 * under 1 would render *below* CSS resolution.
 */
export function resolvePixelRatio(maxPixelRatio: number = DEFAULT_MAX_PIXEL_RATIO): number {
  const reported = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  const ratio = typeof reported === 'number' && Number.isFinite(reported) && reported > 0 ? reported : 1;
  const ceiling = Number.isFinite(maxPixelRatio) && maxPixelRatio >= 1 ? maxPixelRatio : DEFAULT_MAX_PIXEL_RATIO;

  return Math.min(ratio, ceiling);
}

/**
 * Scale a tile was rendered at.
 *
 * `TileContext.pixelRatio` is optional, so that a context built before this
 * existed - or by a consumer - still behaves as an unscaled 1:1 canvas rather
 * than silently desynchronizing drawing from hit testing.
 */
export function pixelRatioOf(tileContext: Pick<TileContext, 'pixelRatio'>): number {
  const ratio = tileContext.pixelRatio;
  return typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/**
 * Create a tile canvas whose backing store is `pixelRatio` times its CSS size.
 *
 * The element keeps its CSS size in layout pixels so Google Maps positions it
 * exactly as before; only the pixel buffer behind it gets denser.
 */
export function createTileCanvas(
  ownerDocument: Document,
  id: string,
  tileSize: number,
  pixelRatio: number,
): HTMLCanvasElement {
  const canvas = ownerDocument.createElement('canvas');

  canvas.width = Math.round(tileSize * pixelRatio);
  canvas.height = Math.round(tileSize * pixelRatio);
  canvas.style.width = `${tileSize}px`;
  canvas.style.height = `${tileSize}px`;
  canvas.id = id;

  return canvas;
}

/**
 * 2D context for a tile, with the device-pixel transform already applied.
 *
 * Every drawing call site must obtain its context through here. The transform
 * is re-applied on each acquisition rather than once at creation because
 * `getContext('2d')` hands back the *same* context object every time: a single
 * call site that reset the transform would otherwise halve the resolution for
 * everyone else, and the mismatch would not be visible until a retina screen.
 *
 * Coordinates passed to the returned context are CSS pixels.
 */
export function getTileContext2D(
  tileContext: Pick<TileContext, 'canvas' | 'pixelRatio'>,
): CanvasRenderingContext2D | null {
  const context = tileContext.canvas.getContext('2d');
  if (!context) return null;

  const ratio = pixelRatioOf(tileContext);
  // setTransform rather than scale(): scale() multiplies into whatever is
  // already there, so repeated acquisition would compound the ratio.
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  return context;
}

/**
 * Convert a CSS-pixel point to the device-pixel space `isPointInPath` expects.
 *
 * `isPointInPath(path, x, y)` treats x and y as canvas coordinates *unaffected
 * by the current transformation*, while the path itself is interpreted in user
 * space and therefore scaled by it. With a device-pixel transform in place the
 * query point has to be scaled by hand or hit testing drifts by exactly the
 * pixel ratio - the failure mode being that clicks land up and to the left of
 * where the feature is drawn, and only on retina screens.
 */
export function toDevicePixels(value: number, pixelRatio: number): number {
  return value * pixelRatio;
}

/**
 * Erase a tile canvas in full, whatever transform is currently set on it.
 */
export function clearTileCanvas(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d');
  if (!context) return;

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.restore();
}
