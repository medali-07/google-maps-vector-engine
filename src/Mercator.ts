import { Point, TileCoord, TileBounds, LatLng, MVTMouseEvent } from './types';

/**
 * Mercator projection utilities for coordinate transformations
 */
export class Mercator {
  /**
   * Convert LatLng to Mercator point coordinates
   */
  static fromLatLngToPoint(latLng: google.maps.LatLng): Point {
    const lat = latLng.lat();
    const lng = latLng.lng();
    const siny = Math.min(Math.max(Math.sin(lat * (Math.PI / 180)), -0.9999), 0.9999);

    return {
      x: 128 + lng * (256 / 360),
      y: 128 + 0.5 * Math.log((1 + siny) / (1 - siny)) * -(256 / (2 * Math.PI)),
    };
  }

  /**
   * Convert Mercator point to LatLng coordinates
   */
  static fromPointToLatLng(point: Point): LatLng {
    return {
      lat: (2 * Math.atan(Math.exp((point.y - 128) / -(256 / (2 * Math.PI)))) - Math.PI / 2) / (Math.PI / 180),
      lng: (point.x - 128) / (256 / 360),
    };
  }

  /**
   * Get tile coordinates for a given LatLng and zoom level
   * Optimized: Use bit shifting instead of Math.pow for better performance
   */
  static getTileAtLatLng(latLng: google.maps.LatLng, zoom: number): TileCoord {
    const t = 1 << zoom;
    const s = 256 / t;
    const p = this.fromLatLngToPoint(latLng);

    return {
      x: Math.floor(p.x / s),
      y: Math.floor(p.y / s),
      z: zoom,
    };
  }

  /**
   * Get tile bounds for a given tile coordinate
   * Optimized: Use bit shifting instead of Math.pow for better performance
   */
  static getTileBounds(tile: TileCoord): TileBounds {
    const normalizedTile = this.normalizeTile(tile);
    const t = 1 << normalizedTile.z;
    const s = 256 / t;

    const sw = {
      x: normalizedTile.x * s,
      y: normalizedTile.y * s + s,
    };

    const ne = {
      x: normalizedTile.x * s + s,
      y: normalizedTile.y * s,
    };

    return {
      sw: this.fromPointToLatLng(sw),
      ne: this.fromPointToLatLng(ne),
    };
  }

  /**
   * Normalize tile coordinates to handle wrapping
   * Optimized: Use bit shifting instead of Math.pow for better performance
   */
  static normalizeTile(tile: TileCoord): TileCoord {
    const t = 1 << tile.z;
    return {
      x: ((tile.x % t) + t) % t,
      y: ((tile.y % t) + t) % t,
      z: tile.z,
    };
  }

  /**
   * Convert LatLng to pixel coordinates within the map viewport
   */
  static fromLatLngToPixels(map: google.maps.Map, latLng: google.maps.LatLng): Point {
    const bounds = map.getBounds();
    const projection = map.getProjection();

    if (!bounds || !projection) {
      return { x: 0, y: 0 };
    }

    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const topRight = projection.fromLatLngToPoint(ne);
    const bottomLeft = projection.fromLatLngToPoint(sw);
    const worldPoint = projection.fromLatLngToPoint(latLng);

    if (!topRight || !bottomLeft || !worldPoint) {
      return { x: 0, y: 0 };
    }

    const scale = 1 << (map.getZoom() || 0);
    return {
      x: (worldPoint.x - bottomLeft.x) * scale,
      y: (worldPoint.y - topRight.y) * scale,
    };
  }

  /**
   * Convert map event to tile-relative point coordinates
   */
  static fromLatLngToTilePoint(map: google.maps.Map, event: MVTMouseEvent): Point {
    const zoom = map.getZoom() || 0;
    const tile = this.getTileAtLatLng(event.latLng, zoom);
    const tileBounds = this.getTileBounds(tile);

    const tileSwLatLng = new google.maps.LatLng(tileBounds.sw.lat, tileBounds.sw.lng);
    const tileNeLatLng = new google.maps.LatLng(tileBounds.ne.lat, tileBounds.ne.lng);
    const tileSwPixels = this.fromLatLngToPixels(map, tileSwLatLng);
    const tileNePixels = this.fromLatLngToPixels(map, tileNeLatLng);

    return {
      x: event.pixel.x - tileSwPixels.x,
      y: event.pixel.y - tileNePixels.y,
    };
  }

  /**
   * Ray casting algorithm for point-in-polygon detection
   */
  static isPointInPolygon(point: Point, polygon: Point[]): boolean {
    if (!polygon?.length) return false;

    let inside = false;
    const length = polygon.length;

    for (let i = 0, j = length - 1; i < length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;

      if (yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Check if point is within circle bounds
   */
  static inCircle(centerX: number, centerY: number, radius: number, x: number, y: number): boolean {
    const dx = centerX - x;
    const dy = centerY - y;
    return dx * dx + dy * dy <= radius * radius;
  }

  /**
   * Calculate minimum distance from point to line
   */
  static getDistanceFromLine(point: Point, line: Point[]): number {
    if (!line?.length || line.length < 2) return Number.POSITIVE_INFINITY;

    let minDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < line.length - 1; i++) {
      const distance = this.projectPointOnLineSegment(point, line[i], line[i + 1]);
      minDistance = Math.min(minDistance, distance);
    }

    return minDistance;
  }

  /**
   * Project point onto line segment and return distance
   */
  static projectPointOnLineSegment(point: Point, lineStart: Point, lineEnd: Point): number {
    const { x, y } = point;
    const { x: x1, y: y1 } = lineStart;
    const { x: x2, y: y2 } = lineEnd;

    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;

    if (lenSq === 0) return Math.sqrt(A * A + B * B);

    const param = Math.max(0, Math.min(1, dot / lenSq));
    const xx = x1 + param * C;
    const yy = y1 + param * D;
    const dx = x - xx,
      dy = y - yy;

    return Math.sqrt(dx * dx + dy * dy);
  }
}
