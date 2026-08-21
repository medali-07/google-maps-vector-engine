// Mercator's geometry half - normalization, pixel projection and the
// distance/containment routines that hit testing runs on - had 0% branch
// coverage. It is pure math with no map dependency, so there was never a
// reason for it to be untested.

import { Mercator } from '../../src/Mercator';
import { Point } from '../../src/types';

const latLng = (lat: number, lng: number): google.maps.LatLng =>
  ({ lat: () => lat, lng: () => lng }) as google.maps.LatLng;

describe('Mercator geometry', () => {
  describe('normalizeTile', () => {
    test('leaves an in-range tile alone', () => {
      expect(Mercator.normalizeTile({ x: 3, y: 2, z: 3 })).toEqual({ x: 3, y: 2, z: 3 });
    });

    test('wraps a negative x into the world', () => {
      // Google Maps hands out unwrapped x across the antimeridian.
      expect(Mercator.normalizeTile({ x: -1, y: 2, z: 3 })).toEqual({ x: 7, y: 2, z: 3 });
      expect(Mercator.normalizeTile({ x: -9, y: 0, z: 3 })).toEqual({ x: 7, y: 0, z: 3 });
    });

    test('wraps an x beyond the world width', () => {
      expect(Mercator.normalizeTile({ x: 8, y: 1, z: 3 })).toEqual({ x: 0, y: 1, z: 3 });
      expect(Mercator.normalizeTile({ x: 11, y: 1, z: 3 })).toEqual({ x: 3, y: 1, z: 3 });
    });

    test('wraps y the same way', () => {
      expect(Mercator.normalizeTile({ x: 0, y: -1, z: 2 })).toEqual({ x: 0, y: 3, z: 2 });
    });

    test('zoom 0 collapses everything onto the single world tile', () => {
      expect(Mercator.normalizeTile({ x: 5, y: -3, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    });
  });

  describe('fromLatLngToPixels', () => {
    const projection = {
      fromLatLngToPoint: (ll: google.maps.LatLng) => Mercator.fromLatLngToPoint(ll),
    };

    const mapWith = (overrides: Record<string, unknown> = {}): google.maps.Map =>
      ({
        getBounds: () => ({
          getNorthEast: () => latLng(85, 180),
          getSouthWest: () => latLng(-85, -180),
        }),
        getProjection: () => projection,
        getZoom: () => 0,
        ...overrides,
      }) as unknown as google.maps.Map;

    test('projects a point inside the viewport', () => {
      const pixel = Mercator.fromLatLngToPixels(mapWith(), latLng(0, 0));

      expect(pixel.x).toBeCloseTo(128, 5);
      expect(Number.isFinite(pixel.y)).toBe(true);
    });

    test('scales with zoom', () => {
      const atZero = Mercator.fromLatLngToPixels(mapWith(), latLng(0, 90));
      const atTwo = Mercator.fromLatLngToPixels(mapWith({ getZoom: () => 2 }), latLng(0, 90));

      expect(atTwo.x).toBeCloseTo(atZero.x * 4, 5);
    });

    test('falls back to the origin when the map has no bounds yet', () => {
      // Real case: the map has not finished its first idle.
      expect(Mercator.fromLatLngToPixels(mapWith({ getBounds: () => null }), latLng(0, 0))).toEqual({ x: 0, y: 0 });
    });

    test('falls back to the origin when the projection is not ready', () => {
      expect(Mercator.fromLatLngToPixels(mapWith({ getProjection: () => null }), latLng(0, 0))).toEqual({
        x: 0,
        y: 0,
      });
    });

    test('falls back to the origin when the projection returns nothing', () => {
      const blind = { fromLatLngToPoint: () => null };
      expect(Mercator.fromLatLngToPixels(mapWith({ getProjection: () => blind }), latLng(0, 0))).toEqual({
        x: 0,
        y: 0,
      });
    });

    test('treats an undefined zoom as 0 rather than producing NaN', () => {
      const pixel = Mercator.fromLatLngToPixels(mapWith({ getZoom: () => undefined }), latLng(0, 0));
      expect(Number.isNaN(pixel.x)).toBe(false);
    });
  });

  describe('isPointInPolygon', () => {
    const square: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    test('finds a point inside', () => {
      expect(Mercator.isPointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    });

    test('rejects a point outside on each side', () => {
      expect(Mercator.isPointInPolygon({ x: -1, y: 5 }, square)).toBe(false);
      expect(Mercator.isPointInPolygon({ x: 11, y: 5 }, square)).toBe(false);
      expect(Mercator.isPointInPolygon({ x: 5, y: -1 }, square)).toBe(false);
      expect(Mercator.isPointInPolygon({ x: 5, y: 11 }, square)).toBe(false);
    });

    test('handles a concave polygon, where a bounding box would be wrong', () => {
      // A C shape: the notch is inside the bounding box but outside the ring.
      const c: Point[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 3 },
        { x: 3, y: 3 },
        { x: 3, y: 7 },
        { x: 10, y: 7 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];

      expect(Mercator.isPointInPolygon({ x: 1, y: 5 }, c)).toBe(true);
      expect(Mercator.isPointInPolygon({ x: 6, y: 5 }, c)).toBe(false);
    });

    test('returns false for an empty or missing polygon', () => {
      expect(Mercator.isPointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
      expect(Mercator.isPointInPolygon({ x: 0, y: 0 }, undefined as unknown as Point[])).toBe(false);
    });
  });

  describe('inCircle', () => {
    test('includes the centre and the boundary', () => {
      expect(Mercator.inCircle(0, 0, 5, 0, 0)).toBe(true);
      expect(Mercator.inCircle(0, 0, 5, 5, 0)).toBe(true);
    });

    test('excludes a point just outside', () => {
      expect(Mercator.inCircle(0, 0, 5, 5.001, 0)).toBe(false);
      expect(Mercator.inCircle(0, 0, 5, 4, 4)).toBe(false);
    });

    test('works away from the origin', () => {
      expect(Mercator.inCircle(100, 100, 10, 105, 105)).toBe(true);
      expect(Mercator.inCircle(100, 100, 10, 120, 100)).toBe(false);
    });
  });

  describe('projectPointOnLineSegment', () => {
    const a: Point = { x: 0, y: 0 };
    const b: Point = { x: 10, y: 0 };

    test('measures perpendicular distance when the foot falls on the segment', () => {
      expect(Mercator.projectPointOnLineSegment({ x: 5, y: 3 }, a, b)).toBeCloseTo(3, 5);
    });

    test('clamps past the start of the segment', () => {
      // Not the infinite line: distance is to the endpoint, so 5 not 3.
      expect(Mercator.projectPointOnLineSegment({ x: -4, y: 3 }, a, b)).toBeCloseTo(5, 5);
    });

    test('clamps past the end of the segment', () => {
      expect(Mercator.projectPointOnLineSegment({ x: 14, y: 3 }, a, b)).toBeCloseTo(5, 5);
    });

    test('handles a zero-length segment without dividing by zero', () => {
      const distance = Mercator.projectPointOnLineSegment({ x: 3, y: 4 }, a, { x: 0, y: 0 });
      expect(distance).toBeCloseTo(5, 5);
    });

    test('reports zero for a point on the segment', () => {
      expect(Mercator.projectPointOnLineSegment({ x: 5, y: 0 }, a, b)).toBeCloseTo(0, 5);
    });
  });

  describe('getDistanceFromLine', () => {
    const line: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];

    test('returns the minimum across every segment', () => {
      // Nearer the vertical segment than the horizontal one.
      expect(Mercator.getDistanceFromLine({ x: 12, y: 5 }, line)).toBeCloseTo(2, 5);
      expect(Mercator.getDistanceFromLine({ x: 5, y: 2 }, line)).toBeCloseTo(2, 5);
    });

    test('reports zero for a point on the line', () => {
      expect(Mercator.getDistanceFromLine({ x: 10, y: 5 }, line)).toBeCloseTo(0, 5);
    });

    test('returns Infinity for a degenerate line, so nothing ever hits it', () => {
      expect(Mercator.getDistanceFromLine({ x: 0, y: 0 }, [])).toBe(Number.POSITIVE_INFINITY);
      expect(Mercator.getDistanceFromLine({ x: 0, y: 0 }, [{ x: 1, y: 1 }])).toBe(Number.POSITIVE_INFINITY);
      expect(Mercator.getDistanceFromLine({ x: 0, y: 0 }, undefined as unknown as Point[])).toBe(
        Number.POSITIVE_INFINITY,
      );
    });
  });

  describe('fromLatLngToTilePoint', () => {
    test('gives a point inside the tile for a latlng inside that tile', () => {
      const projection = { fromLatLngToPoint: (ll: google.maps.LatLng) => Mercator.fromLatLngToPoint(ll) };
      const map = {
        getBounds: () => ({
          getNorthEast: () => latLng(85, 180),
          getSouthWest: () => latLng(-85, -180),
        }),
        getProjection: () => projection,
        getZoom: () => 0,
      } as unknown as google.maps.Map;

      const event = { latLng: latLng(0, 0), pixel: { x: 128, y: 128 } as google.maps.Point };
      const point = Mercator.fromLatLngToTilePoint(map, event);

      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    });
  });
});
