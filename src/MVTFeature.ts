import { VectorTileFeature } from '@mapbox/vector-tile';
import { ColorUtils } from './ColorUtils';
import { getTileContext2D, pixelRatioOf, toDevicePixels } from './render/TileCanvas';
import type { MVTSource } from './MVTSource';
import {
  MVTFeatureOptions,
  TileFeatureData,
  TileContext,
  FeatureStyle,
  FeatureProperties,
  asFeatureProperties,
  Point,
  GeometryType,
  CustomDrawFunction,
} from './types';

/**
 * MVTFeature - Represents individual vector features with drawing and interaction capabilities
 * Part of google-maps-vector-engine
 *
 * Features include cached canvas contexts, efficient coordinate transformations,
 * and integrated selection/hover state management.
 */
export class MVTFeature<TProps extends object = FeatureProperties> {
  public mVTSource: MVTSource<TProps>;
  public selected: boolean = false;
  public hovered: boolean = false;
  public featureId: string | number;
  public tiles: Record<string, TileFeatureData> = {};
  public style: FeatureStyle;
  /** Typed as the enum rather than a bare number, so the geometry switches
   *  through this file get exhaustiveness checking. */
  public type: GeometryType;
  public properties: TProps;

  private _cachedPaths: Map<string, Point[][]> = new Map();
  private static readonly MAX_CACHE_SIZE = 50;
  private _draw: CustomDrawFunction<TProps>;

  private _path2dVersion: number = 0;

  /** Geometry hash per tile id. Keyed per tile because the same feature has
   *  different device coordinates in each tile it spans. */
  private _geometryHashes: Map<string, string> = new Map();

  constructor(options: MVTFeatureOptions<TProps>) {
    this.mVTSource = options.mVTSource;
    this.selected = options.selected;
    this.featureId = options.featureId;
    this.style = options.style;
    this.type = options.vectorTileFeature.type as GeometryType;
    this.properties = asFeatureProperties<TProps>(options.vectorTileFeature.properties);
    this.addTileFeature(options.vectorTileFeature, options.tileContext);
    this._draw = options.customDraw || this.defaultDraw.bind(this);

    if (this.mVTSource.registerFeature) {
      this.mVTSource.registerFeature(this);
    }
  }

  /**
   * Add a tile feature to this MVT feature
   */
  addTileFeature(vectorTileFeature: VectorTileFeature, tileContext: TileContext): void {
    this.tiles[tileContext.id] = {
      vectorTileFeature,
      divisor: vectorTileFeature.extent / tileContext.tileSize,
      context2d: null,
      paths2d: null,
    };

    // Only this tile's caches are stale. Previously every tile of the feature
    // was invalidated here, rebuilding every Path2D each time one tile arrived.
    this._invalidateTileCaches(tileContext.id);
  }

  /**
   * Drop a tile from this feature and report how many remain.
   *
   * Called when Google Maps releases a tile. Returns the number of tiles the
   * feature still occupies so the layer can discard features that are no
   * longer on screen.
   */
  removeTile(tileId: string): number {
    delete this.tiles[tileId];
    this._invalidateTileCaches(tileId);
    return Object.keys(this.tiles).length;
  }

  /**
   * Drop cached geometry for a single tile.
   */
  private _invalidateTileCaches(tileId: string): void {
    this._cachedPaths.delete(tileId);
    this._geometryHashes.delete(tileId);
    this._path2dVersion++;
  }

  /**
   * Get all tiles associated with this feature
   */
  getTiles(): Record<string, TileFeatureData> {
    return this.tiles;
  }

  /**
   * Get specific tile data for a tile context
   */
  getTile(tileContext: TileContext): TileFeatureData {
    return this.tiles[tileContext.id];
  }

  /**
   * Update the style of this feature while preserving state
   */
  setStyle(style: FeatureStyle): void {
    this.style = style;
  }

  /**
   * Set selection state without redrawing (handled by source)
   */
  setSelected(selected: boolean): void {
    this.selected = selected;
  }

  /**
   * Select this feature (delegates to source)
   */
  select(): void {
    if (!this.selected && this.mVTSource._selectFeature) {
      this.mVTSource._selectFeature(this.featureId);
    }
  }

  /**
   * Deselect this feature (delegates to source)
   */
  deselect(): void {
    if (this.selected && this.mVTSource._deselectFeature) {
      this.mVTSource._deselectFeature(this.featureId);
    }
  }

  /**
   * Toggle selection state
   */
  toggle(): void {
    if (this.selected) {
      this.deselect();
    } else {
      this.select();
    }
  }

  /**
   * Draw feature with cached context and styles
   */
  draw(tileContext: TileContext): void {
    const tile = this.tiles[tileContext.id];
    if (!tile) return;

    // Hand the style function the tile it is drawing for, so styling can vary
    // by zoom without round-tripping through setFilter and a full re-parse.
    const currentStyle =
      this.mVTSource.getStyleForFeature?.(tile.vectorTileFeature, this.featureId, {
        zoom: tileContext.zoom,
        tileContext,
      }) || this.style;

    const isReplaced = this.selected && this.mVTSource.isFeatureReplaced?.(this.featureId);

    if (isReplaced) {
      this._createPathsForHoverDetection(tileContext, tile);
    } else {
      this._draw(tileContext, tile, currentStyle, this);
    }
  }

  /**
   * Create invisible paths for hover detection on replaced features
   */
  private _createPathsForHoverDetection(tileContext: TileContext, tile: TileFeatureData): void {
    if (this.type === GeometryType.Polygon) {
      this._getOptimizedPaths2D(tileContext, tile);
    }
  }

  /**
   * Default drawing with cached contexts
   */
  defaultDraw(tileContext: TileContext, tile: TileFeatureData, style: FeatureStyle): void {
    const context2d = getTileContext2D(tileContext);
    if (!context2d) return;
    this._applyStyleToContext(context2d, style);

    switch (this.type) {
      case GeometryType.Point:
        this.drawPoint(tileContext, tile, style, context2d);
        break;
      case GeometryType.LineString:
        this.drawLineString(tileContext, tile, style, context2d);
        break;
      case GeometryType.Polygon:
        this.drawPolygon(tileContext, tile, style, context2d);
        break;
    }
  }

  /**
   * Apply style properties directly to context
   */
  private _applyStyleToContext(context: CanvasRenderingContext2D, style: FeatureStyle): void {
    if (style.fillStyle) {
      // fillOpacity was declared in the public type and documented, but no code
      // path had ever read it, so setting it did nothing at all. It multiplies
      // the fill colour's own alpha rather than replacing it, so a style that
      // sets both gets the product it would get from any other renderer.
      context.fillStyle =
        style.fillOpacity !== undefined ? ColorUtils.scaleAlpha(style.fillStyle, style.fillOpacity) : style.fillStyle;
    }
    if (style.strokeStyle) {
      context.strokeStyle = style.strokeStyle;
    }
    if (style.lineWidth !== undefined) {
      context.lineWidth = style.lineWidth;
    }
    context.lineCap = 'round';
    context.lineJoin = 'round';
  }

  /**
   * Draw point geometry
   */
  private drawPoint(
    tileContext: TileContext,
    tile: TileFeatureData,
    _style: FeatureStyle,
    context2d: CanvasRenderingContext2D,
  ): void {
    const geometry = tile.vectorTileFeature.loadGeometry();
    if (!geometry || geometry.length === 0 || !geometry[0] || geometry[0].length === 0) {
      return;
    }
    const coordinates = geometry[0][0];
    const point = this._getPoint(coordinates, tileContext, tile.divisor);
    const radius = _style.radius || 3;

    context2d.beginPath();
    context2d.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context2d.closePath();
    context2d.fill();
    context2d.stroke();
  }

  /**
   * Draw line string with cached paths
   */
  private drawLineString(
    tileContext: TileContext,
    tile: TileFeatureData,
    _style: FeatureStyle,
    context2d: CanvasRenderingContext2D,
  ): void {
    const paths2d = this._getOptimizedPaths2D(tileContext, tile);
    if (paths2d) {
      context2d.stroke(paths2d);
    }
  }

  /**
   * Draw polygon with cached paths
   */
  private drawPolygon(
    tileContext: TileContext,
    tile: TileFeatureData,
    style: FeatureStyle,
    context2d: CanvasRenderingContext2D,
  ): void {
    const paths2d = this._getOptimizedPaths2D(tileContext, tile);
    if (paths2d) {
      // Rings are closed individually when the Path2D is built. Calling
      // closePath() here only closed the *last* subpath, leaving a visible gap
      // in every other ring, and mutated the cached Path2D on every redraw.
      if (style.fillStyle) {
        context2d.fill(paths2d);
      }
      if (style.strokeStyle) {
        context2d.stroke(paths2d);
      }
    }
  }

  private _createGeometryHash(coordinates: any[]): string {
    if (!coordinates || coordinates.length === 0) return 'empty';

    let hash = `rings:${coordinates.length}`;
    for (let i = 0; i < Math.min(coordinates.length, 3); i++) {
      if (coordinates[i] && coordinates[i].length > 0) {
        hash += `_r${i}:${coordinates[i].length}`;
        if (coordinates[i][0]) {
          hash += `_f${coordinates[i][0].x},${coordinates[i][0].y}`;
        }
        if (coordinates[i].length > 1) {
          const lastIdx = coordinates[i].length - 1;
          hash += `_l${coordinates[i][lastIdx].x},${coordinates[i][lastIdx].y}`;
        }
      }
    }
    return hash;
  }

  private _invalidatePath2DCache(): void {
    this._path2dVersion++;
    this._geometryHashes.clear();

    Object.values(this.tiles).forEach((tile) => {
      tile.paths2d = null;
    });
  }

  /**
   * Get cached Path2D for a tile, rebuilding only when its geometry changed.
   *
   * The cached Path2D is returned as-is; callers must not mutate it (see
   * `drawPolygon`, which closes rings at build time rather than per draw).
   */
  private _getOptimizedPaths2D(tileContext: TileContext, tile: TileFeatureData): Path2D | null {
    // A valid cache entry means the decoded geometry cannot have changed, so
    // return before calling loadGeometry() - the decode dominates this path.
    const cachedHash = this._geometryHashes.get(tileContext.id);
    if (tile.paths2d && cachedHash) {
      return tile.paths2d;
    }

    const coordinates = tile.vectorTileFeature.loadGeometry();

    if (!coordinates || coordinates.length === 0) {
      return null;
    }

    tile.paths2d = this._createSimplePath2D(coordinates, tileContext, tile.divisor);
    this._geometryHashes.set(tileContext.id, this._createGeometryHash(coordinates));

    return tile.paths2d;
  }

  private _createSimplePath2D(coordinates: any[], tileContext: TileContext, divisor: number): Path2D {
    const paths2d = new Path2D();

    for (let i = 0; i < coordinates.length; i++) {
      const coordinate = coordinates[i];

      if (!coordinate || coordinate.length === 0) continue;

      const path2 = new Path2D();
      let hasValidPoints = false;

      for (let j = 0; j < coordinate.length; j++) {
        const point = this._getPoint(coordinate[j], tileContext, divisor);

        if (isNaN(point.x) || isNaN(point.y)) continue;

        if (j === 0) {
          path2.moveTo(point.x, point.y);
          hasValidPoints = true;
        } else {
          path2.lineTo(point.x, point.y);
        }
      }

      if (hasValidPoints) {
        // Close each ring as it is built. Polygons need every ring closed for
        // both stroking and the nonzero fill rule; closing the aggregate path
        // afterwards would only close the last one.
        if (this.type === GeometryType.Polygon) {
          path2.closePath();
        }
        paths2d.addPath(path2);
      }
    }

    return paths2d;
  }

  /**
   * Get paths with caching and size limit
   */
  getPaths(tileContext: TileContext): Point[][] {
    const cacheKey = tileContext.id;
    const cachedPaths = this._cachedPaths.get(cacheKey);

    if (cachedPaths) return cachedPaths;

    const tile = this.tiles[tileContext.id];
    if (!tile) return [];

    const coordinates = tile.vectorTileFeature.loadGeometry();
    if (!coordinates?.length) return [];

    const paths: Point[][] = [];
    for (const coordinate of coordinates) {
      const path = coordinate.map((coord: any) => this._getPoint(coord, tileContext, tile.divisor));
      if (path.length > 0) paths.push(path);
    }

    if (this._cachedPaths.size >= MVTFeature.MAX_CACHE_SIZE) {
      const firstKey = this._cachedPaths.keys().next().value;
      if (firstKey !== undefined) {
        this._cachedPaths.delete(firstKey);
      }
    }

    this._cachedPaths.set(cacheKey, paths);
    return paths;
  }

  /**
   * Convert tile coordinates to canvas coordinates
   */
  private _getPoint(coords: Point, tileContext: TileContext, divisor: number): Point {
    let point: Point = {
      x: coords.x / divisor,
      y: coords.y / divisor,
    };

    if (tileContext.parentId) {
      point = this._getOverzoomedPoint(point, tileContext);
    }

    return point;
  }

  /**
   * Handle overzoomed point coordinates
   */
  private _getOverzoomedPoint(point: Point, tileContext: TileContext): Point {
    const parentTile = this.mVTSource.getTileObject(tileContext.parentId!);
    const currentTile = this.mVTSource.getTileObject(tileContext.id);
    const zoomDistance = currentTile.z - parentTile.z;

    // Math.pow rather than `1 << n`, which overflows to a negative for n >= 31.
    const scale = Math.pow(2, zoomDistance);

    const xScale = point.x * scale;
    const yScale = point.y * scale;

    // `%` keeps the sign of the dividend in JS, so a negative tile x (an
    // unwrapped world copy) produced a negative offset and drew off-canvas.
    const xtileOffset = ((currentTile.x % scale) + scale) % scale;
    const ytileOffset = ((currentTile.y % scale) + scale) % scale;

    return {
      x: xScale - xtileOffset * tileContext.tileSize,
      y: yScale - ytileOffset * tileContext.tileSize,
    };
  }

  /**
   * Check if a point is inside this feature (for polygon features)
   */
  isPointInPath(point: Point, tileContext: TileContext): boolean {
    const tile = this.getTile(tileContext);
    if (!tile || this.type !== GeometryType.Polygon) {
      return false;
    }

    const paths2d = this._getOptimizedPaths2D(tileContext, tile);
    if (!paths2d) return false;

    const context2d = getTileContext2D(tileContext);
    if (!context2d) return false;

    // The path is in CSS pixels and gets scaled by the context transform, but
    // isPointInPath treats its coordinates as untransformed canvas pixels, so
    // the query point has to be scaled by hand. Skipping this puts every click
    // on a retina screen off by exactly the pixel ratio.
    const ratio = pixelRatioOf(tileContext);
    return context2d.isPointInPath(paths2d, toDevicePixels(point.x, ratio), toDevicePixels(point.y, ratio));
  }

  /**
   * Redraw all tiles containing this feature
   */
  redrawTiles(): void {
    if (this.mVTSource._scheduleRedrawForFeature) {
      this.mVTSource._scheduleRedrawForFeature(this.featureId);
    }
  }

  /**
   * Cleanup method to clear caches
   */
  dispose(): void {
    this._cachedPaths.clear();
    this._invalidatePath2DCache();
    // Drop references to the decoded tile data, which pins the PBF buffer.
    this.tiles = {};

    if (this.mVTSource.unregisterFeature) {
      this.mVTSource.unregisterFeature(this.featureId);
    }
  }
}
