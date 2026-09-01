// Hit testing against real geometry.
//
// `tests/setup.ts` used to stub `isPointInPath` to unconditionally return
// `true`, so every hit-testing assertion in the suite passed regardless of
// where the point was. These tests only mean anything because that stub is now
// a real ray-casting implementation - see tests/utils/canvasGeometry.ts.

import { MVTFeature } from '../../src/MVTFeature';
import { GeometryType, MVTFeatureOptions } from '../../src/types';
import { createMockTileContext, createMockMVTSource } from '../utils/mockData';
import { GeometryPath2D, pathContainsPoint } from '../utils/canvasGeometry';

/** A vector tile feature whose geometry is a single square ring. */
const squareFeature = (x: number, y: number, size: number, extent = 256): any => ({
  id: 'sq',
  type: GeometryType.Polygon,
  extent,
  properties: {},
  loadGeometry: () => [
    [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  ],
});

const buildFeature = (vectorTileFeature: any, tileContext: any): MVTFeature => {
  const mVTSource = createMockMVTSource();
  mVTSource.getStyleForFeature = undefined;

  const options: MVTFeatureOptions = {
    mVTSource,
    vectorTileFeature,
    tileContext,
    style: { fillStyle: 'red' },
    selected: false,
    featureId: 'sq',
    customDraw: false,
  };

  return new MVTFeature(options);
};

describe('canvas geometry helper', () => {
  test('reports containment for a simple ring', () => {
    const path = new GeometryPath2D();
    path.rect(0, 0, 10, 10);

    expect(pathContainsPoint(path, 5, 5)).toBe(true);
    expect(pathContainsPoint(path, 15, 5)).toBe(false);
    expect(pathContainsPoint(path, -1, 5)).toBe(false);
  });

  test('treats a nested ring as a hole, per the even-odd rule', () => {
    const path = new GeometryPath2D();
    path.rect(0, 0, 20, 20);
    path.rect(5, 5, 10, 10);

    expect(pathContainsPoint(path, 2, 2)).toBe(true);
    expect(pathContainsPoint(path, 10, 10)).toBe(false);
  });

  test('scales the path by the transform, leaving the point untransformed', () => {
    // The asymmetry the real API defines, and the reason the DPR work had to
    // scale the query point by hand.
    const path = new GeometryPath2D();
    path.rect(0, 0, 10, 10);
    const doubled = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };

    // At ratio 2 the ring covers 0..20 in canvas pixels.
    expect(pathContainsPoint(path, 15, 15, doubled)).toBe(true);
    expect(pathContainsPoint(path, 15, 15)).toBe(false);
  });

  test('ignores degenerate subpaths', () => {
    const path = new GeometryPath2D();
    path.moveTo(0, 0);
    path.lineTo(10, 0);

    expect(pathContainsPoint(path, 5, 0)).toBe(false);
  });
});

describe('MVTFeature.isPointInPath', () => {
  test('accepts a point inside the polygon and rejects one outside', () => {
    // extent 256 over a 256px tile means a divisor of 1, so tile coordinates
    // map straight to canvas pixels.
    const tileContext = createMockTileContext();
    const feature = buildFeature(squareFeature(50, 50, 100), tileContext);

    expect(feature.isPointInPath({ x: 100, y: 100 }, tileContext)).toBe(true);
    expect(feature.isPointInPath({ x: 10, y: 10 }, tileContext)).toBe(false);
    expect(feature.isPointInPath({ x: 200, y: 100 }, tileContext)).toBe(false);
  });

  test('is exact at the polygon edges', () => {
    const tileContext = createMockTileContext();
    const feature = buildFeature(squareFeature(50, 50, 100), tileContext);

    expect(feature.isPointInPath({ x: 51, y: 51 }, tileContext)).toBe(true);
    expect(feature.isPointInPath({ x: 149, y: 149 }, tileContext)).toBe(true);
    expect(feature.isPointInPath({ x: 151, y: 100 }, tileContext)).toBe(false);
  });

  test('stays aligned with rendering at a device pixel ratio of 2', () => {
    // The failure this guards against: drawing scales the path by the ratio
    // while isPointInPath does not scale the point, so clicks land off by
    // exactly the ratio - visible only on retina screens.
    const tileContext = createMockTileContext({ pixelRatio: 2 });
    const feature = buildFeature(squareFeature(50, 50, 100), tileContext);

    // The same CSS-pixel coordinates must give the same answers as at 1:1.
    expect(feature.isPointInPath({ x: 100, y: 100 }, tileContext)).toBe(true);
    expect(feature.isPointInPath({ x: 10, y: 10 }, tileContext)).toBe(false);
    expect(feature.isPointInPath({ x: 200, y: 100 }, tileContext)).toBe(false);
  });

  test('agrees between ratio 1 and ratio 2 across a sweep of points', () => {
    const atOne = buildFeature(squareFeature(50, 50, 100), createMockTileContext());
    const retinaContext = createMockTileContext({ pixelRatio: 2 });
    const atTwo = buildFeature(squareFeature(50, 50, 100), retinaContext);
    const oneContext = createMockTileContext();
    const plain = buildFeature(squareFeature(50, 50, 100), oneContext);

    for (let x = 0; x <= 256; x += 16) {
      for (let y = 0; y <= 256; y += 16) {
        expect(atTwo.isPointInPath({ x, y }, retinaContext)).toBe(plain.isPointInPath({ x, y }, oneContext));
      }
    }
    expect(atOne).toBeDefined();
  });

  test('honours the extent divisor', () => {
    // extent 4096 over a 256px tile is a divisor of 16, so tile coordinate
    // 2048 is canvas pixel 128.
    const tileContext = createMockTileContext();
    const feature = buildFeature(squareFeature(1024, 1024, 2048, 4096), tileContext);

    expect(feature.isPointInPath({ x: 128, y: 128 }, tileContext)).toBe(true);
    expect(feature.isPointInPath({ x: 20, y: 20 }, tileContext)).toBe(false);
  });

  test('a non-polygon is never a path hit', () => {
    const tileContext = createMockTileContext();
    const line = { ...squareFeature(50, 50, 100), type: GeometryType.LineString };
    const feature = buildFeature(line, tileContext);

    expect(feature.isPointInPath({ x: 100, y: 100 }, tileContext)).toBe(false);
  });

  test('a feature with no geometry is never a hit', () => {
    const tileContext = createMockTileContext();
    const empty = { ...squareFeature(0, 0, 0), loadGeometry: () => [] };
    const feature = buildFeature(empty, tileContext);

    expect(feature.isPointInPath({ x: 5, y: 5 }, tileContext)).toBe(false);
  });

  test('a feature not present in the tile is never a hit', () => {
    const tileContext = createMockTileContext();
    const feature = buildFeature(squareFeature(50, 50, 100), tileContext);
    const otherTile = createMockTileContext({ id: 'somewhere-else' });

    expect(feature.isPointInPath({ x: 100, y: 100 }, otherTile)).toBe(false);
  });
});
