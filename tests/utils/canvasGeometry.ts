/**
 * A Path2D and `isPointInPath` that actually compute containment.
 *
 * The suite used to stub `isPointInPath` to unconditionally return `true`, so
 * every hit-testing assertion passed no matter what the geometry was. That
 * made the tests worse than useless: they read as coverage while proving
 * nothing.
 *
 * The plan called for `node-canvas` here. That drags in a native build against
 * cairo and pango, which would make CI and first-time contributor setup
 * fragile for one function's worth of behaviour. Ray casting over the recorded
 * subpaths is exact for polygons - the only geometry this library hit-tests
 * with `isPointInPath` - and needs no native code.
 *
 * The transform is honoured the way the real API does it: the path is
 * interpreted in user space and scaled by the current transformation, while
 * the query point is treated as untransformed canvas coordinates. That is
 * precisely the asymmetry the device-pixel-ratio work had to account for, so
 * the mock has to reproduce it or the retina hit-testing tests prove nothing.
 */

export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

interface Vertex {
  x: number;
  y: number;
}

/** Minimal Path2D that remembers its subpaths so they can be tested against. */
export class GeometryPath2D {
  /** Completed and in-progress subpaths, in user-space coordinates. */
  readonly subpaths: Vertex[][] = [];
  private _current: Vertex[] | null = null;

  moveTo(x: number, y: number): void {
    this._current = [{ x, y }];
    this.subpaths.push(this._current);
  }

  lineTo(x: number, y: number): void {
    if (!this._current) {
      this.moveTo(x, y);
      return;
    }
    this._current.push({ x, y });
  }

  closePath(): void {
    // Ray casting treats every subpath as closed, so this only ends the run.
    this._current = null;
  }

  addPath(other: GeometryPath2D): void {
    for (const subpath of other.subpaths) {
      this.subpaths.push([...subpath]);
    }
    this._current = null;
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }

  arc(x: number, y: number, radius: number, start = 0, end = Math.PI * 2): void {
    // Approximated as a 32-gon: enough for containment, and the library only
    // hit-tests points by radius, never by path.
    const steps = 32;
    const vertices: Vertex[] = [];
    for (let i = 0; i <= steps; i++) {
      const angle = start + ((end - start) * i) / steps;
      vertices.push({ x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius });
    }
    this.subpaths.push(vertices);
    this._current = null;
  }

  // Curves are flattened to their endpoints: no code path under test uses them.
  quadraticCurveTo(_cx: number, _cy: number, x: number, y: number): void {
    this.lineTo(x, y);
  }

  bezierCurveTo(_c1x: number, _c1y: number, _c2x: number, _c2y: number, x: number, y: number): void {
    this.lineTo(x, y);
  }
}

const applyMatrix = (point: Vertex, m: Matrix): Vertex => ({
  x: m.a * point.x + m.c * point.y + m.e,
  y: m.b * point.x + m.d * point.y + m.f,
});

/** Even-odd ray casting against a single closed ring. */
const ringContains = (ring: Vertex[], x: number, y: number): boolean => {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const { x: xi, y: yi } = ring[i];
    const { x: xj, y: yj } = ring[j];

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
};

/**
 * Whether the point lies inside the path, once the path has been transformed.
 *
 * Subpaths toggle, so a hole punched by a reversed inner ring behaves the way
 * the even-odd fill rule describes.
 */
export function pathContainsPoint(path: GeometryPath2D, x: number, y: number, matrix: Matrix = IDENTITY): boolean {
  let inside = false;

  for (const subpath of path.subpaths) {
    if (subpath.length < 3) continue;
    const transformed = subpath.map((vertex) => applyMatrix(vertex, matrix));
    if (ringContains(transformed, x, y)) inside = !inside;
  }

  return inside;
}
