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
import { ContextPool } from './ContextPool';

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

  private _contextPool: ContextPool = ContextPool.getInstance();
  private _cachedPaths: Map<string, Point[][]> = new Map();
  private static readonly MAX_CACHE_SIZE = 50;
  private _draw: CustomDrawFunction;

  private _path2dVersion: number = 0;
  private _geometryHash: string | null = null;
  private _contextsInUse: Map<string, CanvasRenderingContext2D> = new Map();

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

    this._releaseAllContexts();
    this._cachedPaths.delete(tileContext.id);
    this._invalidatePath2DCache();
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
    this._releaseAllContexts();
  }

  /**
   * Set selection state without redrawing (handled by source)
   */
  setSelected(selected: boolean): void {
    if (this.selected !== selected) {
      this.selected = selected;
      this._releaseAllContexts();
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
   * Get optimized canvas context using context pool for large operations only
   */
  private _getOptimizedContext2d(
    canvas: HTMLCanvasElement,
    style: FeatureStyle,
    tileId: string,
  ): CanvasRenderingContext2D {
    // Only use pooling for complex multi-tile features (5+ tiles)
    const tileCount = Object.keys(this.tiles).length;
    if (tileCount < 5) {
      const context2d = canvas.getContext('2d')!;
      this._applyStyleToContext(context2d, style);
      return context2d;
    }

    const styleHash = ContextPool.createStyleHash(style);
    const cacheKey = `${tileId}_${styleHash}`;
    
    let context2d = this._contextsInUse.get(cacheKey);
    
    if (!context2d) {
      context2d = this._contextPool.acquire(canvas, style, styleHash);
      this._contextsInUse.set(cacheKey, context2d);
    }

    return context2d;
  }

  /**
   * Apply style properties directly to context (lightweight version)
   */
  private _applyStyleToContext(context: CanvasRenderingContext2D, style: FeatureStyle): void {
    if (style.fillStyle) {
      context.fillStyle = style.fillStyle;
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
   * Release all contexts back to pool
   */
  private _releaseAllContexts(): void {
    // Skip pool overhead for simple cases - just clear the map
    if (this._contextsInUse.size <= 3) {
      this._contextsInUse.clear();
      return;
    }
    
    // Only use pool for complex multi-tile features
    this._contextsInUse.forEach((context) => {
      this._contextPool.release(context);
    });
    this._contextsInUse.clear();
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
    this._geometryHash = null;
    
    Object.values(this.tiles).forEach(tile => {
      tile.paths2d = null;
    });
  }

  /**
   * Get cached Path2D objects with enhanced invalidation
   */
  private _getOptimizedPaths2D(tileContext: TileContext, tile: TileFeatureData): Path2D | null {
    const coordinates = tile.vectorTileFeature.loadGeometry();
    
    if (!coordinates || coordinates.length === 0) {
      return null;
    }

    // For simple geometries, skip all caching overhead
    const totalPoints = coordinates.reduce((sum, coord) => sum + (coord ? coord.length : 0), 0);
    if (totalPoints < 50) {
      return this._createSimplePath2D(coordinates, tileContext, tile.divisor);
    }

    const currentGeometryHash = this._createGeometryHash(coordinates);
    const needsRecreation = !tile.paths2d || 
                           this._geometryHash !== currentGeometryHash ||
                           !this._geometryHash;

    if (needsRecreation) {
      tile.paths2d = this._createSimplePath2D(coordinates, tileContext, tile.divisor);
      this._geometryHash = currentGeometryHash;
    }

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
    this._releaseAllContexts();
    this._cachedPaths.clear();
    this._invalidatePath2DCache();

    if (this.mVTSource.unregisterFeature) {
      this.mVTSource.unregisterFeature(this.featureId);
    }
  }
}
