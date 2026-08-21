import intersect from '@turf/intersect';
import union from '@turf/union';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import { createLogger } from '../DebugLogger';
import { TileCoord } from '../types';

/**
 * Build a GeoJSON polygon feature.
 *
 * Inlined rather than importing `@turf/helpers`: this is the whole of what
 * `polygon()` did for us, and the package it lives in is not otherwise used.
 */
function polygonFeature(rings: Position[][], properties: Record<string, unknown> = {}): Feature<Polygon> {
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Polygon', coordinates: rings },
  };
}

/**
 * Wrap features for the Turf 7 API.
 *
 * Turf 7 changed `union` and `intersect` to take a FeatureCollection rather
 * than two positional features. The old two-argument calls were still in place
 * here and threw "Must have at least 2 geometries" on every invocation - but
 * both call sites catch and continue, so the failure was silent: polygons that
 * overlapped without sharing an exact coordinate simply never merged.
 */
function pair<T extends Polygon | MultiPolygon>(a: Feature<T>, b: Feature<T>): FeatureCollection<T> {
  return { type: 'FeatureCollection', features: [a, b] };
}

/** A merged polygonal geometry in GeoJSON form. */
export interface MergedGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

/**
 * Merges the polygon rings of a feature that spans several tiles into a single
 * GeoJSON geometry, and converts tile-local PBF coordinates to lon/lat.
 *
 * Extracted from MVTSource, which carried this as ~380 lines of geometry code
 * unrelated to tile rendering. It holds no source state, so it is pure enough
 * to test directly and is the only place @turf is used.
 */
export class GeometryMerger {
  private logger = createLogger('GeometryMerger');

  /**
   * Merge connecting coordinate rings into optimal polygon/multipolygon geometry.
   */
  mergeConnectingRings(rings: number[][][]): MergedGeometry {
    if (rings.length === 0) {
      return { type: 'Polygon', coordinates: [] };
    }

    if (rings.length === 1) {
      return { type: 'Polygon', coordinates: rings };
    }

    this.logger.log(`Starting polygon merge for ${rings.length} rings`);

    try {
      const polygons = rings.map((ring, index) => {
        const closedRing = this.ensureRingClosure(ring);
        return polygonFeature([closedRing], { originalIndex: index });
      });

      const polygonGroups = this._groupTouchingPolygons(polygons);

      this.logger.log(`Grouped ${polygons.length} polygons into ${polygonGroups.length} groups`);

      const mergedPolygons: Feature<Polygon | MultiPolygon>[] = [];

      for (const group of polygonGroups) {
        if (group.length === 1) {
          mergedPolygons.push(group[0]);
        } else {
          const merged = this._unionPolygons(group);
          if (merged) {
            mergedPolygons.push(merged);
          } else {
            // Fallback: keep original polygons if union failed
            mergedPolygons.push(...group);
          }
        }
      }

      const result = this._convertTurfPolygonsToGeometry(mergedPolygons);

      this.logger.log(`Merged ${rings.length} rings into ${result.type} with ${mergedPolygons.length} polygon groups`);
      return result;
    } catch (error) {
      this.logger.error('Error in polygon merging, falling back to simple approach:', error);
      rings.sort((a, b) => this.calculateRingArea(b) - this.calculateRingArea(a));
      return { type: 'Polygon', coordinates: rings };
    }
  }

  /**
   * Calculate the area of a ring (simplified).
   */
  calculateRingArea(ring: number[][]): number {
    if (ring.length < 3) return 0;

    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      area += x1 * y2 - x2 * y1;
    }
    return Math.abs(area / 2);
  }

  /**
   * Ensure a ring is properly closed (first point equals last point).
   */
  ensureRingClosure(ring: number[][]): number[][] {
    if (ring.length < 3) return ring;

    const firstPoint = ring[0];
    const lastPoint = ring[ring.length - 1];

    if (firstPoint[0] === lastPoint[0] && firstPoint[1] === lastPoint[1]) {
      return ring;
    }

    return [...ring, firstPoint];
  }

  /**
   * Convert tile-local PBF coordinates to GeoJSON lon/lat.
   */
  convertPBFCoordinatesToGeoJSON(
    pbfCoordinates: any[],
    tileCoord: TileCoord,
    tileSize: number,
    divisor: number,
    geometryType: number,
  ): number[][] | number[][][] | null {
    const { z, x, y } = tileCoord;

    this.logger.log(
      `Converting coordinates for tile ${z}/${x}/${y}, divisor: ${divisor}, tileSize: ${tileSize}, geometryType: ${geometryType}`,
    );

    try {
      const convertPoint = (point: any): [number, number] => {
        const pixelX = point.x / divisor;
        const pixelY = point.y / divisor;

        const tileX = pixelX / tileSize;
        const tileY = pixelY / tileSize;

        const globalX = x + tileX;
        const globalY = y + tileY;

        const tileCount = Math.pow(2, z);
        const lon = (globalX / tileCount) * 360 - 180;
        const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * globalY) / tileCount))) * 180) / Math.PI;

        return [lon, lat];
      };

      if (geometryType === 1) {
        // Point: pbfCoordinates is an array of point groups
        const result = pbfCoordinates.map((pointGroup) => {
          if (Array.isArray(pointGroup) && pointGroup.length > 0) {
            return convertPoint(pointGroup[0]);
          }
          return convertPoint(pointGroup);
        });
        this.logger.log(`Converted ${result.length} points`);
        return result;
      } else if (geometryType === 2) {
        // LineString: array of line parts
        const result = pbfCoordinates.map((lineString) => lineString.map(convertPoint));
        this.logger.log(`Converted ${result.length} linestrings`);
        return result;
      } else if (geometryType === 3) {
        // Polygon: array of rings
        const result = pbfCoordinates.map((ring) => ring.map(convertPoint));
        this.logger.log(`Converted polygon with ${result.length} rings`);
        return result;
      }
    } catch (error) {
      this.logger.error('Error converting PBF coordinates to GeoJSON:', error, {
        tile: `${z}/${x}/${y}`,
        geometryType,
        // Null-safe: this runs *because* the input was malformed, so reading
        // .length unguarded made the error handler throw its own TypeError
        // and the caller never got the null this method promises.
        coordinatesLength: Array.isArray(pbfCoordinates) ? pbfCoordinates.length : 'n/a',
      });
    }

    return null;
  }

  /**
   * Group polygons that touch or overlap, using union-find.
   */
  private _groupTouchingPolygons(polygons: Feature<Polygon>[]): Feature<Polygon>[][] {
    if (polygons.length <= 1) return [polygons];

    const polygonCoords = polygons.map((poly) => this._getAllCoordinates(poly));

    const parent = Array.from({ length: polygons.length }, (_, i) => i);

    const find = (value: number): number => {
      if (parent[value] !== value) {
        parent[value] = find(parent[value]); // Path compression
      }
      return parent[value];
    };

    // Named `link` rather than `union`, which shadowed the imported turf
    // `union` and made the call below look like a geometry operation.
    const link = (a: number, b: number): void => {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) {
        parent[rootA] = rootB;
      }
    };

    for (let i = 0; i < polygons.length; i++) {
      for (let j = i + 1; j < polygons.length; j++) {
        if (this._polygonsTouchOrOverlap(polygons[i], polygons[j], polygonCoords[i], polygonCoords[j])) {
          link(i, j);
        }
      }
    }

    const groups = new Map<number, Feature<Polygon>[]>();
    for (let i = 0; i < polygons.length; i++) {
      const root = find(i);
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      groups.get(root)!.push(polygons[i]);
    }

    return Array.from(groups.values());
  }

  /**
   * Check if two polygons touch or overlap (including point-touching).
   */
  private _polygonsTouchOrOverlap(
    poly1: Feature<Polygon>,
    poly2: Feature<Polygon>,
    coords1: number[][],
    coords2: number[][],
  ): boolean {
    try {
      if (this._hasSharedCoordinates(coords1, coords2)) {
        return true;
      }

      const intersection = intersect(pair(poly1, poly2));
      return intersection !== null && intersection !== undefined;
    } catch (error) {
      this.logger.warn("Error checking polygon overlap, assuming they don't touch:", error);
      return false;
    }
  }

  /**
   * Check if two polygons share any exact coordinates.
   */
  private _hasSharedCoordinates(coords1: number[][], coords2: number[][]): boolean {
    const coordSet1 = new Set<string>();
    for (const coord of coords1) {
      coordSet1.add(`${coord[0]},${coord[1]}`);
    }

    for (const coord of coords2) {
      if (coordSet1.has(`${coord[0]},${coord[1]}`)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract all coordinates from a polygon.
   */
  private _getAllCoordinates(polygonFeature: Feature<Polygon>): number[][] {
    const coordinates: number[][] = [];

    try {
      if (polygonFeature.geometry && polygonFeature.geometry.coordinates) {
        const rings = polygonFeature.geometry.coordinates;

        for (const ring of rings) {
          for (const coord of ring) {
            coordinates.push([coord[0], coord[1]]);
          }
        }
      }
    } catch (error) {
      this.logger.warn('Error extracting coordinates:', error);
    }

    return coordinates;
  }

  /**
   * Union multiple polygons into a single polygon or multipolygon.
   */
  private _unionPolygons(polygons: Feature<Polygon>[]): Feature<Polygon | MultiPolygon> | null {
    if (polygons.length === 0) return null;
    if (polygons.length === 1) return polygons[0];

    try {
      return polygons.slice(1).reduce<Feature<Polygon | MultiPolygon>>((result, currentPolygon, index) => {
        const unionResult = union(pair(result, currentPolygon));
        if (!unionResult) {
          this.logger.warn(`Failed to union polygon ${index}, keeping separate`);
          return result;
        }

        return unionResult;
      }, polygons[0]);
    } catch (error) {
      this.logger.error('Error in polygon union operation:', error);
      return null;
    }
  }

  /**
   * Convert turf polygon features back to plain GeoJSON geometry.
   */
  private _convertTurfPolygonsToGeometry(polygons: Feature<Polygon | MultiPolygon>[]): MergedGeometry {
    if (polygons.length === 0) {
      return { type: 'Polygon', coordinates: [] };
    }

    if (polygons.length === 1) {
      const { geometry } = polygons[0];
      return {
        type: geometry.type as 'Polygon' | 'MultiPolygon',
        coordinates: geometry.coordinates as number[][][] | number[][][][],
      };
    }

    const multiPolygonCoords: number[][][][] = [];

    for (const { geometry } of polygons) {
      if (geometry.type === 'Polygon') {
        multiPolygonCoords.push(geometry.coordinates);
      } else {
        multiPolygonCoords.push(...geometry.coordinates);
      }
    }

    return {
      type: 'MultiPolygon',
      coordinates: multiPolygonCoords,
    };
  }
}
