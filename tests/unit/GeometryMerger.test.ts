import { GeometryMerger } from '../../src/geojson/GeometryMerger';

/** A square ring, closed, as PBF-style tile coordinates would produce. */
const square = (x: number, y: number, size = 2): number[][] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];

describe('GeometryMerger', () => {
  let merger: GeometryMerger;

  beforeEach(() => {
    merger = new GeometryMerger();
  });

  describe('mergeConnectingRings', () => {
    test('returns an empty polygon for no rings', () => {
      expect(merger.mergeConnectingRings([])).toEqual({ type: 'Polygon', coordinates: [] });
    });

    test('passes a single ring straight through', () => {
      const ring = square(0, 0);
      expect(merger.mergeConnectingRings([ring])).toEqual({ type: 'Polygon', coordinates: [ring] });
    });

    test('merges two overlapping squares into one polygon', () => {
      // The regression that mattered. Turf 7 changed union() to take a
      // FeatureCollection, but the two-argument call was still in place and
      // threw on every invocation. Both call sites catch and continue, so the
      // failure was silent: overlapping rings came back unmerged.
      const result = merger.mergeConnectingRings([square(0, 0), square(1, 0)]);

      expect(result.type).toBe('Polygon');
      // One merged ring, not two separate ones.
      expect(result.coordinates).toHaveLength(1);

      // The union of [0,2]x[0,2] and [1,3]x[0,2] spans x from 0 to 3.
      const xs = (result.coordinates as number[][][])[0].map(([x]) => x);
      expect(Math.min(...xs)).toBe(0);
      expect(Math.max(...xs)).toBe(3);
    });

    test('merges squares that only share an edge', () => {
      const result = merger.mergeConnectingRings([square(0, 0), square(2, 0)]);

      expect(result.type).toBe('Polygon');
      expect(result.coordinates).toHaveLength(1);

      const xs = (result.coordinates as number[][][])[0].map(([x]) => x);
      expect(Math.max(...xs)).toBe(4);
    });

    test('keeps disjoint squares apart, as a multipolygon', () => {
      const result = merger.mergeConnectingRings([square(0, 0), square(50, 50)]);

      expect(result.type).toBe('MultiPolygon');
      expect(result.coordinates).toHaveLength(2);
    });

    test('merges a touching pair and leaves a third alone', () => {
      const result = merger.mergeConnectingRings([square(0, 0), square(1, 0), square(50, 50)]);

      expect(result.type).toBe('MultiPolygon');
      expect(result.coordinates).toHaveLength(2);
    });

    test('closes an open ring before merging', () => {
      const open = [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ];

      const result = merger.mergeConnectingRings([open, square(1, 0)]);

      expect(result.type).toBe('Polygon');
      expect(result.coordinates).toHaveLength(1);
    });
  });

  describe('ensureRingClosure', () => {
    test('appends the first point when the ring is open', () => {
      const closed = merger.ensureRingClosure([
        [0, 0],
        [1, 0],
        [1, 1],
      ]);

      expect(closed).toHaveLength(4);
      expect(closed[closed.length - 1]).toEqual([0, 0]);
    });

    test('leaves an already-closed ring alone', () => {
      const ring = square(0, 0);
      expect(merger.ensureRingClosure(ring)).toEqual(ring);
    });
  });

  describe('convertPBFCoordinatesToGeoJSON', () => {
    const tile = { z: 0, x: 0, y: 0 };

    test('maps the tile origin to the top-left of the world', () => {
      const result = merger.convertPBFCoordinatesToGeoJSON([[{ x: 0, y: 0 }]], tile, 256, 1, 3) as number[][][];

      const [lng, lat] = result[0][0];
      expect(lng).toBeCloseTo(-180, 5);
      expect(lat).toBeCloseTo(85.0511, 3);
    });

    test('maps the tile centre to null island', () => {
      const result = merger.convertPBFCoordinatesToGeoJSON([[{ x: 128, y: 128 }]], tile, 256, 1, 3) as number[][][];

      const [lng, lat] = result[0][0];
      expect(lng).toBeCloseTo(0, 5);
      expect(lat).toBeCloseTo(0, 5);
    });

    test('honours the divisor, which carries the tile extent', () => {
      const scaled = merger.convertPBFCoordinatesToGeoJSON([[{ x: 2048, y: 2048 }]], tile, 256, 16, 3) as number[][][];

      const [lng, lat] = scaled[0][0];
      expect(lng).toBeCloseTo(0, 5);
      expect(lat).toBeCloseTo(0, 5);
    });

    test('handles each geometry type', () => {
      const point = merger.convertPBFCoordinatesToGeoJSON([[{ x: 128, y: 128 }]], tile, 256, 1, 1);
      expect(point).toHaveLength(1);

      const line = merger.convertPBFCoordinatesToGeoJSON(
        [
          [
            { x: 0, y: 0 },
            { x: 128, y: 128 },
          ],
        ],
        tile,
        256,
        1,
        2,
      ) as number[][][];
      expect(line[0]).toHaveLength(2);

      const polygon = merger.convertPBFCoordinatesToGeoJSON([[{ x: 0, y: 0 }]], tile, 256, 1, 3);
      expect(polygon).toHaveLength(1);
    });

    test('returns null for an unknown geometry type', () => {
      expect(merger.convertPBFCoordinatesToGeoJSON([[{ x: 0, y: 0 }]], tile, 256, 1, 99)).toBeNull();
    });
  });

  describe('degenerate input and error paths', () => {
    test('skips a ring with too few points to be a polygon', () => {
      const result = merger.mergeConnectingRings([
        [[0, 0]],
        [
          [1, 1],
          [2, 2],
        ],
      ]);

      // Nothing mergeable, but it must not throw or lose the input entirely.
      expect(result.type).toMatch(/Polygon|MultiPolygon/);
    });

    test('handles degenerate rings that a decoder can actually produce', () => {
      // Zero-area rings: collinear points, and a ring collapsed to one place.
      const collinear = [
        [0, 0],
        [5, 0],
        [10, 0],
        [0, 0],
      ];
      const degenerate = [
        [20, 20],
        [20, 20],
        [20, 20],
      ];

      const result = merger.mergeConnectingRings([collinear, degenerate]);

      expect(result).toBeDefined();
      expect(result.type).toMatch(/Polygon|MultiPolygon/);
    });

    test('converts coordinates for a tile away from the origin', () => {
      const result = merger.convertPBFCoordinatesToGeoJSON(
        [[{ x: 0, y: 0 }]],
        { z: 2, x: 3, y: 1 },
        256,
        1,
        3,
      ) as number[][][];

      const [lng, lat] = result[0][0];
      // Tile 3 of 4 across starts three quarters of the way around the world.
      expect(lng).toBeCloseTo(90, 5);
      expect(lat).toBeGreaterThan(0);
    });

    test('reports null when conversion throws on malformed input', () => {
      const error = jest.spyOn(console, 'error').mockImplementation();

      const result = merger.convertPBFCoordinatesToGeoJSON(
        null as unknown as unknown[],
        { z: 0, x: 0, y: 0 },
        256,
        1,
        3,
      );

      expect(result).toBeNull();
      error.mockRestore();
    });

    test('a point group given as a bare point is still converted', () => {
      const result = merger.convertPBFCoordinatesToGeoJSON(
        [{ x: 128, y: 128 }],
        { z: 0, x: 0, y: 0 },
        256,
        1,
        1,
      ) as number[][];

      expect(result[0][0]).toBeCloseTo(0, 5);
    });

    test('an empty ring list converts to an empty result', () => {
      expect(merger.convertPBFCoordinatesToGeoJSON([], { z: 0, x: 0, y: 0 }, 256, 1, 3)).toEqual([]);
    });

    test('ensureRingClosure handles an empty ring', () => {
      expect(merger.ensureRingClosure([])).toEqual([]);
    });

    test('merges a long chain of touching squares into one polygon', () => {
      const chain = [0, 1, 2, 3].map((i) => square(i * 2, 0));

      const result = merger.mergeConnectingRings(chain);

      expect(result.type).toBe('Polygon');
      const xs = (result.coordinates as number[][][])[0].map(([x]) => x);
      expect(Math.max(...xs)).toBe(8);
    });
  });

  describe('internal helpers', () => {
    test('extracting coordinates tolerates a feature with no geometry', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation();

      expect((merger as any)._getAllCoordinates({})).toEqual([]);
      expect((merger as any)._getAllCoordinates({ geometry: {} })).toEqual([]);

      warn.mockRestore();
    });

    test('extracting coordinates flattens every ring', () => {
      const coords = (merger as any)._getAllCoordinates({
        geometry: {
          coordinates: [
            [
              [0, 0],
              [1, 1],
            ],
            [[2, 2]],
          ],
        },
      });

      expect(coords).toEqual([
        [0, 0],
        [1, 1],
        [2, 2],
      ]);
    });

    test('shared coordinates are detected exactly', () => {
      const a = [
        [0, 0],
        [1, 1],
      ];
      const b = [
        [1, 1],
        [2, 2],
      ];
      const c = [
        [5, 5],
        [6, 6],
      ];

      expect((merger as any)._hasSharedCoordinates(a, b)).toBe(true);
      expect((merger as any)._hasSharedCoordinates(a, c)).toBe(false);
      expect((merger as any)._hasSharedCoordinates([], a)).toBe(false);
    });

    test('an intersection failure is treated as not touching, not as a crash', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation();

      const touching = (merger as any)._polygonsTouchOrOverlap({}, {}, [], []);

      expect(touching).toBe(false);
      warn.mockRestore();
    });

    test('unioning a single polygon returns it unchanged', () => {
      const only = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [square(0, 0)] } };

      expect((merger as any)._unionPolygons([only])).toBe(only);
    });

    test('unioning nothing returns null', () => {
      expect((merger as any)._unionPolygons([])).toBeNull();
    });

    test('a union failure is reported rather than thrown', () => {
      const error = jest.spyOn(console, 'error').mockImplementation();

      const result = (merger as any)._unionPolygons([{}, {}]);

      expect(result).toBeNull();
      error.mockRestore();
    });

    test('converts a multipolygon result back to plain geometry', () => {
      const multi = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiPolygon', coordinates: [[square(0, 0)], [square(9, 9)]] },
      };

      const result = (merger as any)._convertTurfPolygonsToGeometry([multi]);

      expect(result.type).toBe('MultiPolygon');
      expect(result.coordinates).toHaveLength(2);
    });

    test('flattens several results, polygons and multipolygons alike, into one multipolygon', () => {
      const poly = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [square(0, 0)] },
      };
      const multi = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiPolygon', coordinates: [[square(9, 9)], [square(20, 20)]] },
      };

      const result = (merger as any)._convertTurfPolygonsToGeometry([poly, multi]);

      expect(result.type).toBe('MultiPolygon');
      expect(result.coordinates).toHaveLength(3);
    });

    test('converting nothing gives an empty polygon', () => {
      expect((merger as any)._convertTurfPolygonsToGeometry([])).toEqual({ type: 'Polygon', coordinates: [] });
    });
  });
});
