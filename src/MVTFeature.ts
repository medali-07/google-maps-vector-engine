import { VectorTileFeature } from '@mapbox/vector-tile';
import {
  MVTFeatureOptions,
  TileFeatureData,
  TileContext,
  FeatureStyle,
  Point,
  GeometryType,
  CustomDrawFunction,
} from './types';
import { ColorUtils } from './ColorUtils';

/**
 * MVTFeature - Represents individual vector features with drawing and interaction capabilities
 * Part of google-maps-vector-engine
 *
 * Features include cached canvas contexts, efficient coordinate transformations,
 * and integrated selection/hover state management.
 */
export class MVTFeature {
  public mVTSource: any; // MVTSource
  public selected: boolean = false;
  public hovered: boolean = false;
  public featureId: string | number;
  public tiles: Record<string, TileFeatureData> = {};
  public style: FeatureStyle;
  public type: number;
  public properties: Record<string, any>;

  // Performance caching with size limits to prevent memory leaks
  private _cachedContexts: Map<string, CanvasRenderingContext2D> = new Map();
  private _cachedPaths: Map<string, Point[][]> = new Map();
  private static readonly MAX_CACHE_SIZE = 50; // Limit cache size
  private _draw: CustomDrawFunction;

  constructor(options: MVTFeatureOptions) {
    this.mVTSource = options.mVTSource;
    this.selected = options.selected;
    this.featureId = options.featureId;
    this.style = options.style;
    this.type = options.vectorTileFeature.type;
    this.properties = options.vectorTileFeature.properties;
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

    this._cachedContexts.delete(tileContext.id);
    this._cachedPaths.delete(tileContext.id);
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
    this._cachedContexts.clear();
  }

  /**
   * Set selection state without redrawing (handled by source)
   */
  setSelected(selected: boolean): void {
    if (this.selected !== selected) {
      this.selected = selected;
      this._cachedContexts.clear();
    }
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

    const currentStyle = this.mVTSource.getStyleForFeature?.(tile.vectorTileFeature, this.featureId) || this.style;

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
    const context2d = this._getOptimizedContext2d(tileContext.canvas, style, tileContext.id);

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
   * Get cached canvas context with style
   * Fixed: Use hash-based caching to avoid expensive JSON.stringify
   */
  private _getOptimizedContext2d(
    canvas: HTMLCanvasElement,
    style: FeatureStyle,
    tileId: string,
  ): CanvasRenderingContext2D {
    const styleHash = this._createStyleHash(style);
    const cacheKey = `${tileId}_${styleHash}`;
    let context2d = this._cachedContexts.get(cacheKey);

    if (!context2d) {
      context2d = canvas.getContext('2d')!;
      this._applyStyleToContext(context2d, style);

      if (this._cachedContexts.size >= MVTFeature.MAX_CACHE_SIZE) {
        const firstKey = this._cachedContexts.keys().next().value;
        if (firstKey !== undefined) {
          this._cachedContexts.delete(firstKey);
        }
      }

      this._cachedContexts.set(cacheKey, context2d);
    }

    return context2d;
  }

  /**
   * Create efficient hash for style object to avoid JSON.stringify performance issues
   */
  private _createStyleHash(style: FeatureStyle): string {
    return [
      style.fillStyle ?? '',
      style.fillOpacity?.toString() ?? '',
      style.strokeStyle ?? '',
      style.lineWidth?.toString() ?? '',
      style.radius?.toString() ?? '',
    ].join('|');
  }

  /**
   * Apply style to context
   */
  private _applyStyleToContext(context2d: CanvasRenderingContext2D, style: FeatureStyle): void {
    if (style.fillStyle) {
      context2d.fillStyle = style.fillStyle;
      if (style.fillOpacity !== undefined && !ColorUtils.hasAlpha(style.fillStyle)) {
        context2d.fillStyle = ColorUtils.convertColorWithOpacity(style.fillStyle, style.fillOpacity);
      }
    }

    if (style.strokeStyle) {
      context2d.strokeStyle = style.strokeStyle;
    }

    if (style.lineWidth !== undefined) {
      context2d.lineWidth = style.lineWidth;
    }
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
      paths2d.closePath();

      if (style.fillStyle) {
        context2d.fill(paths2d);
      }
      if (style.strokeStyle) {
        context2d.stroke(paths2d);
      }
    }
  }

  /**
   * Get cached Path2D objects
   */
  private _getOptimizedPaths2D(tileContext: TileContext, tile: TileFeatureData): Path2D | null {
    if (tile.paths2d) {
      return tile.paths2d;
    }

    const coordinates = tile.vectorTileFeature.loadGeometry();
    const paths2d = new Path2D();

    if (!coordinates || coordinates.length === 0) {
      return null;
    }

    for (let i = 0; i < coordinates.length; i++) {
      const coordinate = coordinates[i];
      const path2 = new Path2D();

      for (let j = 0; j < coordinate.length; j++) {
        const point = this._getPoint(coordinate[j], tileContext, tile.divisor);
        if (j === 0) {
          path2.moveTo(point.x, point.y);
        } else {
          path2.lineTo(point.x, point.y);
        }
      }
      paths2d.addPath(path2);
    }

    tile.paths2d = paths2d;
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

    const scale = 1 << zoomDistance; // Faster than Math.pow(2, zoomDistance)

    const xScale = point.x * scale;
    const yScale = point.y * scale;

    const xtileOffset = currentTile.x % scale;
    const ytileOffset = currentTile.y % scale;

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

    const context2d = tileContext.canvas.getContext('2d')!;
    return context2d.isPointInPath(paths2d, point.x, point.y);
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
    this._cachedContexts.clear();
    this._cachedPaths.clear();

    if (this.mVTSource.unregisterFeature) {
      this.mVTSource.unregisterFeature(this.featureId);
    }
  }
}
