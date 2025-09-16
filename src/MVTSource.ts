import { VectorTile, VectorTileFeature } from '@mapbox/vector-tile';
import Protobuf from 'pbf';
import { MVTLayer } from './MVTLayer';
import { MVTFeature } from './MVTFeature';
import { Mercator } from './Mercator';
import { ColorUtils } from './ColorUtils';
import { createLogger, debugLogger } from './DebugLogger';
// @ts-ignore - Turf types have module resolution issues
import { polygon, buffer, intersect, union, Feature, Polygon, MultiPolygon, Properties } from '@turf/turf';
import {
  MVTSourceOptions,
  TileContext,
  TileCoord,
  MVTMouseEvent,
  MouseEventOptions,
  FeatureStyle,
  FeatureStyleFunction,
  FilterFunction,
  GeometryType,
  GeoJSONFeature,
  FeatureReplacementFunction,
  FeatureSelectionCallback,
  TileManifest,
  TileAvailabilitySource
} from './types';

/**
 * google-maps-vector-engine - High performance vector tile renderer
 * 
 * Provides efficient rendering of Mapbox Vector Tiles (MVT/PBF) with:
 * - Fast feature lookups and unified state management
 * - Batched rendering with 60fps debouncing 
 * - Advanced styling with selection and hover states
 * - Event handling and GeoJSON overlay support
 */
export class MVTSource implements google.maps.MapType {
  public map: google.maps.Map;
  public tileSize: google.maps.Size;
  public mVTLayers: Record<string, MVTLayer> = {};
  public loadedTilesLen = 0;
  public name: string | null = null;
  public alt: string | null = null;
  public maxZoom: number;
  public minZoom: number;
  public projection: google.maps.Projection | null = null;
  public radius: number = 6378137;

  private logger = createLogger('MVTSource');

  // Core configuration
  private _url: string;
  private _sourceMaxZoom: number | false;
  private _debug: boolean;
  private _getIDForLayerFeature: (feature: VectorTileFeature) => string | number;
  private _defaultFeatureId: string;
  private _visibleLayers: string[] | undefined;
  private _xhrHeaders: Record<string, string>;
  private _clickableLayers: string[] | false;
  private _filter: FilterFunction | false;
  private _cache: boolean;
  private _tileSize: number;
  private _customDraw: ((tileContext: TileContext, tile: any, style: FeatureStyle, feature: any) => void) | false;
  private _multipleSelection = false;

  // Feature state management
  private _featureIndex: Map<string | number, MVTFeature> = new Map();
  private _selectedFeatureIds: Set<string | number> = new Set();
  private _hoveredFeatureIds: Set<string | number> = new Set();
  
  // Tile management
  private _tilesDrawn: Record<string, TileContext> = {};
  private _visibleTiles: Record<string, TileContext> = {};
  
  // GeoJSON overlay management
  private _geoJSONOverlays: Record<string | number, google.maps.Data.Feature> = {};
  private _replacedFeatures: Record<string | number, GeoJSONFeature> = {};
  private _getReplacementFeature: FeatureReplacementFunction | undefined;
  private _featureSelectionCallback: FeatureSelectionCallback | undefined;
  
  // Event handling
  private _onClickCallback: ((event: MVTMouseEvent) => void) | undefined;
  private _onMouseHoverCallback: ((event: MVTMouseEvent) => void) | undefined;
  private _toggleSelection = true;
  private _setSelectedOnClick = true;
  private _limitToFirstVisibleLayer = false;
  private _hoverDelay = 0;
  private event: MVTMouseEvent | null = null;
  
  // Event listener references for cleanup
  private _eventListeners: google.maps.MapsEventListener[] = [];

  // Tile availability manifest
  private _tileAvailabilityManifest?: TileAvailabilitySource;
  private _resolvedManifest?: TileManifest;

  // Batched redraw system for smooth rendering
  private _pendingRedraws: Set<string> = new Set();
  private _redrawDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly REDRAW_DEBOUNCE_MS = 16;
  
  // Cache size limits to prevent memory leaks
  private static readonly MAX_TILES_CACHE_SIZE = 100;
  private static readonly MAX_VISIBLE_TILES_SIZE = 50;
  
  // Default color palette for consistency
  private static readonly DEFAULT_COLORS = {
    POINT_FILL: 'rgba(49,79,79,1)',
    LINE_STROKE: 'rgba(136, 86, 167, 1)',
    POLYGON_FILL: 'rgba(188, 189, 220, 0.5)',
    POLYGON_STROKE: 'rgba(136, 86, 167, 1)',
    SELECTED_POINT: 'rgba(255,255,0,0.8)',
    SELECTED_LINE: 'rgba(255,25,0,0.8)', 
    SELECTED_POLYGON_FILL: 'rgba(255,140,0,0.4)',
    SELECTED_POLYGON_STROKE: 'rgba(255,140,0,1)',
    DEBUG_STROKE: '#000000',
    DEBUG_FILL: '#FFFF00',
    DEBUG_TEXT_BG: 'rgba(255, 255, 255, 0.8)',
    DEBUG_TEXT: '#000000'
  };

  public style: FeatureStyle | FeatureStyleFunction;

  constructor(map: google.maps.Map, options: MVTSourceOptions) {
    this.map = map;
    this._url = options.url || '';
    this._sourceMaxZoom = options.sourceMaxZoom || false;
    this._debug = options.debug || false;
    this._defaultFeatureId = options.defaultFeatureId || 'fid';
    this._getIDForLayerFeature = options.getIDForLayerFeature || this.defaultGetIDForLayerFeature;
    
    // Initialize debug logger
    this.logger = createLogger('MVTSource');
    debugLogger.setDebug(this._debug);
    
    this._visibleLayers = options.visibleLayers;
    this._xhrHeaders = options.xhrHeaders || {};
    this._clickableLayers = options.clickableLayers || false;
    this._filter = options.filter || false;
    this._cache = options.cache || false;
    this._tileSize = options.tileSize || 256;
    this._customDraw = options.customDraw || false;
    this._getReplacementFeature = options.getReplacementFeature;
    this._featureSelectionCallback = options.featureSelectionCallback;
    
    // Tile availability manifest configuration
    this._tileAvailabilityManifest = options.tileAvailabilityManifest;
    
    // Event handling configuration
    this._onClickCallback = options.onClick;
    this._onMouseHoverCallback = options.onMouseHover;
    this._multipleSelection = options.multipleSelection || false;
    this._toggleSelection = options.toggleSelection !== undefined ? options.toggleSelection : true;
    this._setSelectedOnClick = options.setSelectedOnClick !== undefined ? options.setSelectedOnClick : true;
    this._limitToFirstVisibleLayer = options.limitToFirstVisibleLayer || false;
    this._hoverDelay = options.hoverDelay || 0;
    
    this.tileSize = new google.maps.Size(this._tileSize, this._tileSize);
    this.style = options.style || this.defaultStyle.bind(this);
    this.name = 'Optimized MVT Layer';
    this.alt = 'Optimized Vector Tile Layer';
    this.maxZoom = typeof this._sourceMaxZoom === 'number' ? this._sourceMaxZoom : 18;
    this.minZoom = 6;

    if (options.selectedFeatures) {
      this.setSelectedFeatures(options.selectedFeatures);
    }

    const zoomListener = this.map.addListener('zoom_changed', () => {
      this._zoomChanged();
    });
    this._eventListeners.push(zoomListener);

    this._setupEventListeners();
    this._setupGeoJSONClickHandlers();
    
    // Initialize manifest asynchronously, but add to map immediately
    // Tile requests will be handled gracefully during manifest loading
    this._initializeManifest().catch(error => {
      this.logger.warn('Manifest initialization failed:', error);
    });
    
    this.map.overlayMapTypes.push(this);
  }

  /**
   * Register feature in index for fast lookups
   */
  registerFeature(feature: MVTFeature): void {
    this._featureIndex.set(feature.featureId, feature);
  }

  /**
   * Unregister feature from index
   */
  unregisterFeature(featureId: string | number): void {
    this._featureIndex.delete(featureId);
    this._selectedFeatureIds.delete(featureId);
    this._hoveredFeatureIds.delete(featureId);
  }

  /**
   * Get feature by ID
   */
  getFeature(featureId: string | number): MVTFeature | undefined {
    return this._featureIndex.get(featureId);
  }

  /**
   * Extract property value from feature properties with type checking
   * Reusable utility to avoid code duplication
   */
  private _extractFeatureProperty(properties: Record<string, any>, propertyName: string): string | number | null {
    const value = properties[propertyName];
    return (typeof value === 'string' || typeof value === 'number') ? value : null;
  }

  /**
   * Default ID extractor for features with configurable property name
   */
  private defaultGetIDForLayerFeature(feature: VectorTileFeature): string | number {
    const props = feature.properties;
    
    // Try configured default property first
    const defaultValue = this._extractFeatureProperty(props, this._defaultFeatureId);
    if (defaultValue !== null) return defaultValue;
    
    // Fallback to common ID property names
    const commonIdFields = ['id', 'Id', 'ID'];
    for (const field of commonIdFields) {
      const value = this._extractFeatureProperty(props, field);
      if (value !== null) return value;
    }
    
    // Generate random ID as last resort
    return `feature_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Initialize tile availability manifest
   */
  private async _initializeManifest(): Promise<void> {
    if (!this._tileAvailabilityManifest) return;

    try {
      if (typeof this._tileAvailabilityManifest === 'function') {
        this._resolvedManifest = await this._tileAvailabilityManifest();
        this.logger.info('Manifest loaded from API:', Object.keys(this._resolvedManifest || {}).length, 'zoom levels');
      } else {
        this._resolvedManifest = this._tileAvailabilityManifest;
        this.logger.info('Manifest loaded from static data:', Object.keys(this._resolvedManifest || {}).length, 'zoom levels');
      }
    } catch (error) {
      this.logger.warn('Failed to load tile availability manifest:', error);
      this._resolvedManifest = undefined;
    }
  }

  /**
   * Check if a tile is available according to the manifest
   */
  private _isTileAvailable(z: number, x: number, y: number): boolean {
    if (!this._resolvedManifest) {
      this.logger.log(`No manifest available yet, allowing tile: ${z}/${x}/${y}`);
      return true; // If no manifest, assume all tiles are available
    }

    const zoomLevel = z.toString();
    const xCoordinate = x.toString();

    // Check if zoom level exists in manifest
    if (!this._resolvedManifest[zoomLevel]) {
      this.logger.log(`Zoom level ${z} not found in manifest, rejecting tile: ${z}/${x}/${y}`);
      return false;
    }

    // Check if x coordinate exists in manifest
    if (!this._resolvedManifest[zoomLevel][xCoordinate]) {
      this.logger.log(`X coordinate ${x} not found in manifest for zoom ${z}, rejecting tile: ${z}/${x}/${y}`);
      return false;
    }

    // Check if y coordinate falls within any of the available ranges
    const yRanges = this._resolvedManifest[zoomLevel][xCoordinate];
    const isAvailable = yRanges.some(([yStart, yEnd]) => y >= yStart && y <= yEnd);
    
    if (isAvailable) {
      this.logger.log(`Tile ${z}/${x}/${y} is available according to manifest`);
    } else {
      this.logger.log(`Tile ${z}/${x}/${y} not in available Y ranges: ${JSON.stringify(yRanges)}`);
    }
    
    return isAvailable;
  }

  /**
   * Default styling for features
   */
  private defaultStyle(feature: VectorTileFeature): FeatureStyle {
    const style: FeatureStyle = {};
    
    switch (feature.type) {
      case GeometryType.Point:
        style.fillStyle = MVTSource.DEFAULT_COLORS.POINT_FILL;
        style.radius = 5;
        break;
        
      case GeometryType.LineString:
        style.strokeStyle = MVTSource.DEFAULT_COLORS.LINE_STROKE;
        style.lineWidth = 3;
        break;
        
      case GeometryType.Polygon:
        style.fillStyle = MVTSource.DEFAULT_COLORS.POLYGON_FILL;
        style.strokeStyle = MVTSource.DEFAULT_COLORS.POLYGON_STROKE;
        style.lineWidth = 1;
        break;
    }
    
    return style;
  }

  /**
   * Get selected style for features
   */
  private getSelectedStyle(feature: VectorTileFeature): FeatureStyle {
    switch (feature.type) {
      case GeometryType.Point:
        return {
          fillStyle: MVTSource.DEFAULT_COLORS.SELECTED_POINT,
          radius: 7
        };
        
      case GeometryType.LineString:
        return {
          strokeStyle: MVTSource.DEFAULT_COLORS.SELECTED_LINE,
          lineWidth: 5
        };
        
      case GeometryType.Polygon:
        return {
          fillStyle: MVTSource.DEFAULT_COLORS.SELECTED_POLYGON_FILL,
          strokeStyle: MVTSource.DEFAULT_COLORS.SELECTED_POLYGON_STROKE,
          lineWidth: 3
        };
        
      default:
        return {};
    }
  }

  /**
   * Get tile for Google Maps tile system
   */
  getTile(coord: google.maps.Point, zoom: number, ownerDocument: Document): HTMLElement {
    this.logger.log(`Getting tile: ${zoom}/${coord.x}/${coord.y}`);
    const tileContext = this.drawTile(coord, zoom, ownerDocument);
    this._setVisibleTile(tileContext);
    return tileContext.canvas;
  }

  /**
   * Release tile resources
   */
  releaseTile(): void {
    // Implementation for tile cleanup if needed
  }

  /**
   * Handle zoom changes and preserve selections
   */
  private _zoomChanged(): void {
    this.logger.log('Zoom changed - preserving selections');
    
    const selectedIds = Array.from(this._selectedFeatureIds);
    
    this._resetVisibleTiles();
    if (!this._cache) {
      this._resetMVTLayers();
    }
    
    if (selectedIds.length > 0) {
      setTimeout(() => {
        selectedIds.forEach(featureId => {
          this._selectedFeatureIds.add(featureId);
        });
        this._scheduleRedraw('all');
      }, 50);
    }
  }

  /**
   * Reset MVT layers
   */
  private _resetMVTLayers(): void {
    this.mVTLayers = {};
    this._featureIndex.clear();
  }

  /**
   * Reset visible tiles
   */
  private _resetVisibleTiles(): void {
    this._visibleTiles = {};
  }

  /**
   * Set a tile as visible with memory management
   */
  private _setVisibleTile(tileContext: TileContext): void {
    // Implement cache size limit to prevent memory leaks
    const visibleTileIds = Object.keys(this._visibleTiles);
    if (visibleTileIds.length >= MVTSource.MAX_VISIBLE_TILES_SIZE) {
      // Remove oldest tiles (simple FIFO approach)
      const tilesToRemove = visibleTileIds.slice(0, visibleTileIds.length - MVTSource.MAX_VISIBLE_TILES_SIZE + 1);
      tilesToRemove.forEach(tileId => {
        delete this._visibleTiles[tileId];
      });
    }
    
    this._visibleTiles[tileContext.id] = tileContext;
  }

  /**
   * Draw a tile
   */
  drawTile(coord: google.maps.Point, zoom: number, ownerDocument: Document): TileContext {
    const id = this.getTileId(zoom, coord.x, coord.y);
    let tileContext = this._tilesDrawn[id];
    
    if (tileContext) {
      return tileContext;
    }

    tileContext = this._createTileContext(coord, zoom, ownerDocument);
    this.loadedTilesLen = 0;
    this._xhrRequest(tileContext);
    
    return tileContext;
  }

  /**
   * Create tile context
   */
  private _createTileContext(coord: google.maps.Point, zoom: number, ownerDocument: Document): TileContext {
    const id = this.getTileId(zoom, coord.x, coord.y);
    const canvas = this._createCanvas(ownerDocument, id);
    const parentId = this._getParentId(id);

    return {
      id,
      canvas,
      zoom,
      tileSize: this._tileSize,
      parentId
    };
  }

  /**
   * Get parent tile ID for overzooming
   */
  private _getParentId(id: string): string | undefined {
    if (!this._sourceMaxZoom) return undefined;
    
    const tile = this.getTileObject(id);
    if (tile.z > this._sourceMaxZoom) {
      const zoomDistance = tile.z - this._sourceMaxZoom;
      const zoom = tile.z - zoomDistance;
      const x = tile.x >> zoomDistance;
      const y = tile.y >> zoomDistance;
      return this.getTileId(zoom, x, y);
    }
    
    return undefined;
  }

  /**
   * Create canvas element
   */
  private _createCanvas(ownerDocument: Document, id: string): HTMLCanvasElement {
    const canvas = ownerDocument.createElement('canvas');
    canvas.width = this._tileSize;
    canvas.height = this._tileSize;
    canvas.id = id;
    return canvas;
  }

  /**
   * Generate tile ID
   */
  getTileId(zoom: number, x: number, y: number): string {
    return [zoom, x, y].join(':');
  }

  /**
   * Parse tile ID to object
   */
  getTileObject(id: string): TileCoord {
    const values = id.split(':');
    return {
      z: parseInt(values[0]),
      x: parseInt(values[1]),
      y: parseInt(values[2])
    };
  }

  /**
   * Make XHR request for tile data
   */
  private _xhrRequest(tileContext: TileContext): void {
    const id = tileContext.parentId || tileContext.id;
    const tile = this.getTileObject(id);

    // Check tile availability against manifest
    if (!this._isTileAvailable(tile.z, tile.x, tile.y)) {
      this.logger.log(`Tile not available according to manifest: ${tile.z}/${tile.x}/${tile.y}`);
      this._drawDebugInfo(tileContext);
      return;
    }

    const src = this._url
      .replace('{z}', tile.z.toString())
      .replace('{x}', tile.x.toString())
      .replace('{y}', tile.y.toString());

    this.logger.log(`Requesting tile: ${src}`);

    const xmlHttpRequest = new XMLHttpRequest();
    xmlHttpRequest.onload = () => {
      this.logger.log(`Tile response: ${xmlHttpRequest.status} for ${src}`);
      if (xmlHttpRequest.status === 200 && xmlHttpRequest.response) {
        this._xhrResponseOk(tileContext, xmlHttpRequest.response);
      } else {
        this._drawDebugInfo(tileContext);
      }
    };

    xmlHttpRequest.onerror = () => {
      this.logger.error(`Failed to load tile: ${src}`);
      this._drawDebugInfo(tileContext);
    };

    xmlHttpRequest.open('GET', src, true);
    Object.entries(this._xhrHeaders).forEach(([header, value]) => {
      xmlHttpRequest.setRequestHeader(header, value);
    });
    xmlHttpRequest.responseType = 'arraybuffer';
    xmlHttpRequest.send();
  }

  /**
   * Handle successful XHR response
   */
  private _xhrResponseOk(tileContext: TileContext, response: ArrayBuffer): void {
    if (this.map.getZoom() !== tileContext.zoom) {
      return;
    }

    const uint8Array = new Uint8Array(response);
    const pbf = new Protobuf(uint8Array);
    const vectorTile = new VectorTile(pbf);
    
    this._parseVectorTileGeometries(vectorTile);
    this._drawVectorTile(vectorTile, tileContext);
  }

  /**
   * Parse vector tile geometries
   */
  private _parseVectorTileGeometries(vectorTile: VectorTile): void {
    this.logger.log('Parsing vector tile with layers:', Object.keys(vectorTile.layers));
    
    for (const key in vectorTile.layers) {
      const layer = vectorTile.layers[key];
      this.logger.log(`Layer "${key}" has ${layer.length} features`);
    }
  }

  /**
   * Wait for all visible tiles to load
   */
  async tileLoaded(): Promise<boolean> {
    const lenVisibleTiles = Object.keys(this._visibleTiles).length;

    return new Promise((resolve) => {
      if (lenVisibleTiles && lenVisibleTiles === this.loadedTilesLen) {
        resolve(true);
      } else {
        setTimeout(async () => {
          const result = await this.tileLoaded();
          resolve(result);
        }, 100);
      }
    });
  }

  /**
   * Mark tile as drawn with memory management
   */
  private _setTileDrawn(tileContext: TileContext): void {
    if (!this._cache) return;
    
    // Implement cache size limit to prevent memory leaks
    const drawnTileIds = Object.keys(this._tilesDrawn);
    if (drawnTileIds.length >= MVTSource.MAX_TILES_CACHE_SIZE) {
      // Remove oldest tiles (simple FIFO approach)
      const tilesToRemove = drawnTileIds.slice(0, drawnTileIds.length - MVTSource.MAX_TILES_CACHE_SIZE + 1);
      tilesToRemove.forEach(tileId => {
        delete this._tilesDrawn[tileId];
      });
    }
    
    this._tilesDrawn[tileContext.id] = tileContext;
  }

  /**
   * Delete drawn tile
   */
  deleteTileDrawn(id: string): void {
    delete this._tilesDrawn[id];
  }

  /**
   * Reset drawn tiles
   */
  redrawAllTiles(): void {
    this._tilesDrawn = {};
    this._scheduleRedraw('all');
  }

  /**
   * Redraw single tile - Enhanced to preserve all selections
   */
  redrawTile(id: string): void {
    const tileContext = this._visibleTiles[id];
    if (!tileContext || !tileContext.vectorTile) return;
    
    this._scheduleRedraw(id);
  }

  /**
   * Draw vector tile
   */
  private _drawVectorTile(vectorTile: VectorTile, tileContext: TileContext): void {
    if (this._visibleLayers !== undefined) {
      for (const key of this._visibleLayers) {
        if (vectorTile.layers[key]) {
          const vectorTileLayer = vectorTile.layers[key];
          this._drawVectorTileLayer(vectorTileLayer, key, tileContext);
        }
      }
    } else {
      // Show ALL layers when visibleLayers is undefined
      for (const key in vectorTile.layers) {
        const vectorTileLayer = vectorTile.layers[key];
        this._drawVectorTileLayer(vectorTileLayer, key, tileContext);
      }
    }

    tileContext.vectorTile = vectorTile;
    // Only draw debug info during initial tile creation, not on feature redraws
    if (!this._tilesDrawn[tileContext.id]) {
      this._drawDebugInfo(tileContext);
    }
    this._setTileDrawn(tileContext);
  }

  /**
   * Draw vector tile layer
   */
  private _drawVectorTileLayer(vectorTileLayer: import('@mapbox/vector-tile').VectorTileLayer, key: string, tileContext: TileContext): void {
    this.logger.log(`Drawing layer "${key}"`);
    
    if (!this.mVTLayers[key]) {
      this.mVTLayers[key] = this._createMVTLayer(key);
    }
    
    // Extract features from vector tile layer
    const features: VectorTileFeature[] = [];
    for (let i = 0; i < vectorTileLayer.length; i++) {
      features.push(vectorTileLayer.feature(i));
    }
    
    const mVTLayer = this.mVTLayers[key];
    mVTLayer.parseVectorTileFeatures(this, features, tileContext);
  }

  /**
   * Create MVT layer
   */
  private _createMVTLayer(key: string): MVTLayer {
    const options = {
      getIDForLayerFeature: this._getIDForLayerFeature,
      filter: this._filter,
      style: this.style,
      name: key,
      customDraw: this._customDraw
    };
    return new MVTLayer(options);
  }

  /**
   * Draw debug information with nice styling
   */
  private _drawDebugInfo(tileContext: TileContext): void {
    if (!this._debug) return;

    const tile = this.getTileObject(tileContext.id);
    const { width, height } = { width: this._tileSize, height: this._tileSize };
    const context2d = tileContext.canvas.getContext('2d')!;

    context2d.strokeStyle = MVTSource.DEFAULT_COLORS.DEBUG_STROKE;
    context2d.fillStyle = MVTSource.DEFAULT_COLORS.DEBUG_FILL;
    context2d.lineWidth = 1;
    context2d.strokeRect(0, 0, width, height);
    context2d.font = '12px Arial';
    
    // Draw corner markers
    context2d.fillRect(0, 0, 5, 5);
    context2d.fillRect(0, height - 5, 5, 5);
    context2d.fillRect(width - 5, 0, 5, 5);
    context2d.fillRect(width - 5, height - 5, 5, 5);
    context2d.fillRect(width / 2 - 5, height / 2 - 5, 10, 10);
    
    // Draw tile coordinates with nice styling
    const coordText = `${tileContext.zoom} ${tile.x} ${tile.y}`;
    const textMetrics = context2d.measureText(coordText);
    const textX = width / 2 - textMetrics.width / 2;
    const textY = height / 2 - 5;
    
    // Add white background for better readability
    context2d.fillStyle = MVTSource.DEFAULT_COLORS.DEBUG_TEXT_BG;
    context2d.fillRect(textX - 2, textY - 12, textMetrics.width + 4, 16);
    
    // Draw text in black
    context2d.fillStyle = MVTSource.DEFAULT_COLORS.DEBUG_TEXT;
    context2d.fillText(coordText, textX, textY);
  }

  /**
   * Set up event listeners during initialization
   */
  private _setupEventListeners(): void {
    // Always set up click listener if selection is enabled OR custom onClick is provided
    if (this._setSelectedOnClick || this._onClickCallback) {
      const clickListener = this.map.addListener('click', (event: google.maps.MapMouseEvent) => {
        if (event.latLng) {
          const mvtEvent = this._convertToMVTEvent(event);
          if (mvtEvent) {
            const mouseOptions = this._getMouseOptions(false);
            this._mouseEvent(mvtEvent, this._onClickCallback, mouseOptions);
          }
        }
      });
      this._eventListeners.push(clickListener);
    }

    if (this._onMouseHoverCallback) {
      const mouseMoveListener = this.map.addListener('mousemove', (event: google.maps.MapMouseEvent) => {
        if (event.latLng && this._onMouseHoverCallback) {
          const mvtEvent = this._convertToMVTEvent(event);
          if (mvtEvent) {
            const mouseOptions = this._getMouseOptions(true);
            this._mouseEvent(mvtEvent, this._onMouseHoverCallback, mouseOptions);
          }
        }
      });
      this._eventListeners.push(mouseMoveListener);
    }
  }

  /**
   * Convert Google Maps mouse event to MVT mouse event
   */
  private _convertToMVTEvent(event: google.maps.MapMouseEvent): MVTMouseEvent | null {
    const projection = this.map.getProjection();
    const bounds = this.map.getBounds();
    
    if (projection && bounds && event.latLng) {
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const topRight = projection.fromLatLngToPoint(ne);
      const bottomLeft = projection.fromLatLngToPoint(sw);
      const scale = 1 << (this.map.getZoom() || 0); // Faster than Math.pow(2, zoom)
      const worldPoint = projection.fromLatLngToPoint(event.latLng);
      
      if (topRight && bottomLeft && worldPoint) {
        const pixel = new google.maps.Point(
          (worldPoint.x - bottomLeft.x) * scale,
          (worldPoint.y - topRight.y) * scale
        );
        
        return {
          latLng: event.latLng,
          pixel: pixel
        };
      }
    }
    
    return null;
  }

  /**
   * Get mouse event options based on configuration
   */
  private _getMouseOptions(mouseHover: boolean): MouseEventOptions {
    return {
      setSelected: this._setSelectedOnClick,
      limitToFirstVisibleLayer: this._limitToFirstVisibleLayer,
      delay: mouseHover ? this._hoverDelay : 0
    };
  }

  /**
   * Process mouse events
   */
  private _mouseEvent(event: MVTMouseEvent, callbackFunction?: (event: MVTMouseEvent) => void, options?: MouseEventOptions): void {
    if (!event.pixel || !event.latLng) return;

    if (options?.delay === 0) {
      return this._mouseEventContinue(event, callbackFunction, options ?? {});
    }

    this.event = event;
    setTimeout(() => {
      if (event === this.event) {
        this._mouseEventContinue(event, callbackFunction, options);
      }
    }, options?.delay || 0);
  }

  /**
   * Continue mouse event processing
   */
  private _mouseEventContinue(event: MVTMouseEvent, callbackFunction?: (event: MVTMouseEvent) => void, options?: MouseEventOptions): void {
    const callback = callbackFunction || (() => {});
    const zoom = this.map.getZoom() || 0;
    const tile = Mercator.getTileAtLatLng(event.latLng, zoom);
    const id = this.getTileId(tile.z, tile.x, tile.y);
    const tileContext = this._visibleTiles[id];

    if (!tileContext) {
      // Call the callback if provided
      if (callbackFunction) {
        callbackFunction(event);
      }
      return;
    }

    event.tileContext = tileContext;
    event.tilePoint = Mercator.fromLatLngToTilePoint(this.map, event);

    const clickableLayers = this._clickableLayers || Object.keys(this.mVTLayers);
    for (let i = clickableLayers.length - 1; i >= 0; i--) {
      const key = clickableLayers[i];
      const layer = this.mVTLayers[key];
      
      if (layer) {
        const processedEvent = layer.handleClickEvent(event, this);
        this._mouseSelectedFeature(processedEvent, callback, options ?? {});
        
        if (options?.limitToFirstVisibleLayer && processedEvent.feature) {
          break;
        }
      }
    }
  }

  /**
   * Handle mouse events on features
   */
  private _mouseSelectedFeature(event: MVTMouseEvent, callbackFunction?: (event: MVTMouseEvent) => void, options?: MouseEventOptions): void {
    let selectionChanged = false;

    if (event.feature) {
      const featureId = event.feature.featureId;
      const wasSelected = this._selectedFeatureIds.has(featureId);

      // Handle hover vs selection based on callback type
      if (callbackFunction && callbackFunction === this._onMouseHoverCallback) {
        this._setFeatureHover(featureId, true);
        selectionChanged = true;
      } else if (options?.setSelected !== false) {
        // Handle selection logic
        if (this._toggleSelection) {
          if (wasSelected) {
            this._deselectFeature(featureId);
          } else {
            this._selectFeature(featureId);
          }
          selectionChanged = true;
        } else if (!wasSelected) {
          this._selectFeature(featureId);
          selectionChanged = true;
        }
      }

      (event as any).selectionChanged = selectionChanged;
      (event as any).isSelected = this._selectedFeatureIds.has(featureId);
    } else {
      // Clear hovered features when no feature is detected and this is a hover event
      if (callbackFunction && callbackFunction === this._onMouseHoverCallback) {
        this.clearAllHoveredFeatures();
      }
    }

    // Call the callback function if provided
    if (callbackFunction) {
      callbackFunction(event);
    }
  }

  /**
   * Select a feature by ID
   */
  private _selectFeature(featureId: string | number): void {
    if (!this._multipleSelection) {
      this.deselectAllFeatures();
    }

    this._selectedFeatureIds.add(featureId);
    const feature = this._featureIndex.get(featureId);
    
    if (feature) {
      feature.setSelected(true);
      this._scheduleRedrawForFeature(featureId);
      
      if (this._featureSelectionCallback) {
        const vectorFeature = this._getVectorFeatureFromMVTFeature(feature);
        if (vectorFeature) {
          this._callFeatureSelectionCallback(featureId, vectorFeature, true);
        }
      }
    }
  }

  /**
   * Deselect a feature by ID
   */
  private _deselectFeature(featureId: string | number): void {
    this._selectedFeatureIds.delete(featureId);
    const feature = this._featureIndex.get(featureId);
    
    if (feature) {
      feature.setSelected(false);
      this._scheduleRedrawForFeature(featureId);
      
      if (this._featureSelectionCallback) {
        const vectorFeature = this._getVectorFeatureFromMVTFeature(feature);
        if (vectorFeature) {
          this._callFeatureSelectionCallback(featureId, vectorFeature, false);
        }
      }
    }

    this._removeGeoJSONOverlay(featureId);
    delete this._replacedFeatures[featureId];
  }

  /**
   * Deselect all features
   */
  deselectAllFeatures(): void {
    const selectedIds = Array.from(this._selectedFeatureIds);
    
    this._selectedFeatureIds.clear();
    
    selectedIds.forEach(featureId => {
      const feature = this._featureIndex.get(featureId);
      if (feature) {
        feature.setSelected(false);
        
        if (this._featureSelectionCallback) {
          const vectorFeature = this._getVectorFeatureFromMVTFeature(feature);
          if (vectorFeature) {
            this._callFeatureSelectionCallback(featureId, vectorFeature, false);
          }
        }
      }
      this._removeGeoJSONOverlay(featureId);
      delete this._replacedFeatures[featureId];
    });

    if (selectedIds.length > 0) {
      this._scheduleRedraw('all');
    }
  }

  /**
   * Set hover state for a feature
   */
  private _setFeatureHover(featureId: string | number, hovered: boolean): void {
    if (hovered) {
      // Clear other hovered features first (only one should be hovered at a time)
      this.clearAllHoveredFeatures();
      this._hoveredFeatureIds.add(featureId);
    } else {
      this._hoveredFeatureIds.delete(featureId);
    }

    const feature = this._featureIndex.get(featureId);
    if (feature) {
      feature.hovered = hovered;
      this._scheduleRedrawForFeature(featureId);
    }
  }

  /**
   * Clear all hovered features
   */
  clearAllHoveredFeatures(): void {
    const hoveredIds = Array.from(this._hoveredFeatureIds);
    if (hoveredIds.length === 0) return;

    this._hoveredFeatureIds.clear();
    
    hoveredIds.forEach(featureId => {
      const feature = this._featureIndex.get(featureId);
      if (feature) {
        feature.hovered = false;
        this._scheduleRedrawForFeature(featureId);
      }
    });
  }

  /**
   * Schedule redraw for tiles containing a feature
   */
  private _scheduleRedrawForFeature(featureId: string | number): void {
    const feature = this._featureIndex.get(featureId);
    if (!feature) return;

    const tileIds = Object.keys(feature.getTiles());
    tileIds.forEach(tileId => {
      if (this._visibleTiles[tileId]) {
        this._pendingRedraws.add(tileId);
      }
    });

    this._debouncedRedraw();
  }

  /**
   * Schedule tile redraws with debouncing
   */
  private _scheduleRedraw(scope: 'all' | string): void {
    if (scope === 'all') {
      Object.keys(this._visibleTiles).forEach(tileId => {
        this._pendingRedraws.add(tileId);
      });
    } else {
      this._pendingRedraws.add(scope);
    }

    this._debouncedRedraw();
  }

  /**
   * Execute debounced redraws
   */
  private _debouncedRedraw(): void {
    if (this._redrawDebounceTimer) {
      clearTimeout(this._redrawDebounceTimer);
    }

    this._redrawDebounceTimer = setTimeout(() => {
      this._executePendingRedraws();
      this._redrawDebounceTimer = null;
    }, this.REDRAW_DEBOUNCE_MS);
  }

  /**
   * Execute all pending redraws
   */
  private _executePendingRedraws(): void {
    if (this._pendingRedraws.size === 0) return;

    this.logger.log(`Executing ${this._pendingRedraws.size} pending redraws`);

    this._pendingRedraws.forEach(tileId => {
      const tileContext = this._visibleTiles[tileId];
      if (tileContext && tileContext.vectorTile) {
        this.deleteTileDrawn(tileId);
        this.clearTile(tileContext.canvas);
        this._drawVectorTile(tileContext.vectorTile, tileContext);
      }
    });

    this._pendingRedraws.clear();
  }

  /**
   * Check if feature is selected
   */
  isFeatureSelected(featureId: string | number): boolean {
    return this._selectedFeatureIds.has(featureId);
  }

  /**
   * Check if feature is hovered
   */
  isFeatureHovered(featureId: string | number): boolean {
    return this._hoveredFeatureIds.has(featureId);
  }

  /**
   * Check if a feature has been replaced
   */
  isFeatureReplaced(featureId: string | number): boolean {
    return this._replacedFeatures[featureId] !== undefined;
  }

  /**
   * Get selected features
   */
  getSelectedFeatures(): MVTFeature[] {
    return Array.from(this._selectedFeatureIds)
      .map(id => this._featureIndex.get(id))
      .filter(feature => feature !== undefined) as MVTFeature[];
  }

  /**
   * Get selected feature IDs
   */
  getSelectedFeatureIds(): (string | number)[] {
    return Array.from(this._selectedFeatureIds);
  }

  /**
   * Get selected features in a specific tile
   */
  getSelectedFeaturesInTile(tileContextId: string): MVTFeature[] {
    const selectedFeatures = [];
    for (const featureId of this._selectedFeatureIds) {
      const selectedFeature = this._featureIndex.get(featureId);
      if (selectedFeature) {
        const tiles = selectedFeature.getTiles();
        if (tiles[tileContextId]) {
          selectedFeatures.push(selectedFeature);
        }
      }
    }
    return selectedFeatures;
  }

  /**
   * Set selected features by IDs
   */
  setSelectedFeatures(featuresIds: (string | number)[]): void {
    if (featuresIds.length > 1) {
      this._multipleSelection = true;
    }
    
    this.deselectAllFeatures();
    
    featuresIds.forEach(featureId => {
      this._selectFeature(featureId);
    });
  }

  /**
   * Set filter function
   */
  setFilter(filter: FilterFunction | false, redrawTiles = true): void {
    this._filter = filter;
    Object.values(this.mVTLayers).forEach(layer => {
      layer.setFilter(filter);
    });

    if (redrawTiles) {
      this._scheduleRedraw('all');
    }
  }

  /**
   * Set style function and preserve selection state
   */
  setStyle(style: FeatureStyle | FeatureStyleFunction, redrawTiles = true): void {
    const currentSelectedIds = Array.from(this._selectedFeatureIds);
    
    this.style = style;
    
    Object.values(this.mVTLayers).forEach(layer => {
      layer.setStyle(style);
    });

    this._featureIndex.forEach((feature, featureId) => {
      if (currentSelectedIds.includes(featureId)) {
        feature.setSelected(true);
      }
    });

    if (redrawTiles) {
      setTimeout(() => {
        this._scheduleRedraw('all');
      }, 0);
    }
  }

  /**
   * Get current style for feature with selection/hover state
   */
  getStyleForFeature(feature: VectorTileFeature, featureId: string | number): FeatureStyle {
    const isSelected = this._selectedFeatureIds.has(featureId);
    const isHovered = this._hoveredFeatureIds.has(featureId);
    const baseStyle = typeof this.style === 'function' ? this.style(feature) : this.style;
    
    let resultStyle = { ...baseStyle };
    
    delete resultStyle.selected;
    delete resultStyle.hover;
    
    if (isSelected && baseStyle.selected) {
      resultStyle = { ...resultStyle, ...baseStyle.selected };
    } else if (isHovered && baseStyle.hover) {
      resultStyle = { ...resultStyle, ...baseStyle.hover };
    } else if (isSelected && !baseStyle.selected) {
      const computedSelectedStyle = this.getSelectedStyle(feature);
      resultStyle = { 
        ...resultStyle,
        ...((!resultStyle.fillStyle || resultStyle.fillStyle === 'transparent') ? { fillStyle: computedSelectedStyle.fillStyle } : {}),
        ...((!resultStyle.strokeStyle) ? { strokeStyle: computedSelectedStyle.strokeStyle } : {}),
        ...((!resultStyle.lineWidth) ? { lineWidth: computedSelectedStyle.lineWidth } : {})
      };
    } else if (isHovered && !baseStyle.hover) {
      if (resultStyle.fillStyle && !resultStyle.fillStyle.includes('rgba(')) {
        const hoverFill = resultStyle.fillStyle.replace('0.3', '0.5').replace('0.4', '0.6');
        if (hoverFill !== resultStyle.fillStyle) {
          resultStyle.fillStyle = hoverFill;
        }
      }
    }
    
    return resultStyle;
  }

  /**
   * Clear tile canvas
   */
  clearTile(canvas: HTMLCanvasElement): void {
    const context = canvas.getContext('2d')!;
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * Set URL for tile source
   */
  setUrl(url: string, redrawTiles = true): void {
    this._url = url;
    this._resetMVTLayers();
    
    if (redrawTiles) {
      this._scheduleRedraw('all');
    }
  }

  /**
   * Set visible layers
   */
  setVisibleLayers(visibleLayers: string[] | undefined, redrawTiles = true): void {
    this._visibleLayers = visibleLayers;
    if (redrawTiles) {
      this._scheduleRedraw('all');
    }
  }

  /**
   * Get visible layers
   */
  getVisibleLayers(): string[] | undefined {
    return this._visibleLayers;
  }

  /**
   * Set tile availability manifest
   */
  async setTileAvailabilityManifest(manifest?: TileAvailabilitySource): Promise<void> {
    this._tileAvailabilityManifest = manifest;
    await this._initializeManifest();
  }

  /**
   * Get current resolved manifest
   */
  getTileAvailabilityManifest(): TileManifest | undefined {
    return this._resolvedManifest;
  }

  /**
   * Refresh manifest (useful for function-based manifests)
   */
  async refreshManifest(): Promise<void> {
    await this._initializeManifest();
  }

  /**
   * Set clickable layers
   */
  setClickableLayers(clickableLayers: string[] | false): void {
    this._clickableLayers = clickableLayers;
  }

  // ===== GeoJSON Overlay Management =====

  /**
   * Set up click and hover handlers for GeoJSON overlays
   */
  private _setupGeoJSONClickHandlers(): void {
    // Click handler
    const dataClickListener = this.map.data.addListener('click', (event: google.maps.Data.MouseEvent) => {
      if (event.feature) {
        let featureId: string | number | null = null;
        
        for (const [id, overlay] of Object.entries(this._geoJSONOverlays)) {
          if (overlay === event.feature) {
            featureId = id;
            break;
          }
        }
        
        if (featureId !== null) {
          this.logger.log(`GeoJSON overlay clicked for feature ID: ${featureId}`);
          
          if (this._selectedFeatureIds.has(featureId)) {
            this._deselectFeature(featureId);
          } else {
            this._selectFeature(featureId);
          }
        }
      }
    });
    this._eventListeners.push(dataClickListener);

    const dataMouseOverListener = this.map.data.addListener('mouseover', (event: google.maps.Data.MouseEvent) => {
      if (event.feature && this._onMouseHoverCallback) {
        let featureId: string | number | null = null;
        
        for (const [id, overlay] of Object.entries(this._geoJSONOverlays)) {
          if (overlay === event.feature) {
            featureId = id;
            break;
          }
        }
        
        if (featureId !== null) {
          const mvtEvent: MVTMouseEvent = {
            latLng: event.latLng || new google.maps.LatLng(0, 0),
            pixel: new google.maps.Point(0, 0),
            feature: {
              featureId: featureId,
              properties: this._replacedFeatures[featureId]?.properties || {}
            }
          };
          
          this._onMouseHoverCallback(mvtEvent);
        }
      }
    });
    this._eventListeners.push(dataMouseOverListener);

    const dataMouseMoveListener = this.map.data.addListener('mousemove', (event: google.maps.Data.MouseEvent) => {
      if (event.feature && this._onMouseHoverCallback) {
        let featureId: string | number | null = null;
        
        for (const [id, overlay] of Object.entries(this._geoJSONOverlays)) {
          if (overlay === event.feature) {
            featureId = id;
            break;
          }
        }
        
        if (featureId !== null) {
          const mvtEvent: MVTMouseEvent = {
            latLng: event.latLng || new google.maps.LatLng(0, 0),
            pixel: new google.maps.Point(0, 0),
            feature: {
              featureId: featureId,
              properties: this._replacedFeatures[featureId]?.properties || {}
            }
          };
          
          this._onMouseHoverCallback(mvtEvent);
        }
      }
    });
    this._eventListeners.push(dataMouseMoveListener);

    const dataMouseOutListener = this.map.data.addListener('mouseout', (event: google.maps.Data.MouseEvent) => {
      if (this._onMouseHoverCallback) {
        const mvtEvent: MVTMouseEvent = {
          latLng: event.latLng || new google.maps.LatLng(0, 0),
          pixel: new google.maps.Point(0, 0),
          feature: undefined
        };
        
        this._onMouseHoverCallback(mvtEvent);
      }
    });
    this._eventListeners.push(dataMouseOutListener);
  }

  /**
   * Add GeoJSON overlay
   */
  private _addGeoJSONOverlay(featureId: string | number, geoJSONFeature: GeoJSONFeature): void {
    try {
      this._removeGeoJSONOverlay(featureId);
      
      const dataFeature = this.map.data.addGeoJson({
        type: 'FeatureCollection',
        features: [geoJSONFeature]
      })[0];
      
      if (dataFeature) {
        this._geoJSONOverlays[featureId] = dataFeature;
        this.map.data.overrideStyle(dataFeature, this._getGeoJSONSelectedStyle());
        this.logger.log(`Added GeoJSON overlay for feature ${featureId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to add GeoJSON overlay for feature ${featureId}:`, error);
    }
  }

  /**
   * Remove GeoJSON overlay
   */
  private _removeGeoJSONOverlay(featureId: string | number): void {
    const overlay = this._geoJSONOverlays[featureId];
    if (overlay) {
      try {
        this.map.data.remove(overlay);
        delete this._geoJSONOverlays[featureId];
        this.logger.log(`Removed GeoJSON overlay for feature ${featureId}`);
      } catch (error) {
        this.logger.error(`Failed to remove GeoJSON overlay for feature ${featureId}:`, error);
      }
    }
  }

  /**
   * Get GeoJSON selected style based on current configuration
   */
  private _getGeoJSONSelectedStyle(): google.maps.Data.StyleOptions {
    const baseStyle = typeof this.style === 'function' ? {} : this.style as FeatureStyle;
    let selectedStyle = baseStyle.selected || {};
    
    if (!baseStyle.selected) {
      selectedStyle = this.getSelectedStyle({ type: 3, properties: {} } as any);
    }
    
    return {
      fillColor: this._convertMVTColorToGoogleMaps(selectedStyle.fillStyle || '') || '#ff8c00',
      fillOpacity: this._extractOpacityFromColor(selectedStyle.fillStyle || '') || 0.4,
      strokeColor: this._convertMVTColorToGoogleMaps(selectedStyle.strokeStyle || '') || '#ff8c00',
      strokeWeight: selectedStyle.lineWidth || 3,
      strokeOpacity: 1
    };
  }

  /**
   * Convert MVT color to Google Maps color format using ColorUtils
   */
  private _convertMVTColorToGoogleMaps(color: string): string | undefined {
    if (!color) return undefined;
    
    const parsed = ColorUtils.parseRgb(color);
    if (parsed) {
      return `rgb(${parsed.r}, ${parsed.g}, ${parsed.b})`;
    }
    
    // Return other colors as-is (hex, rgb, named colors)
    return color;
  }
  
  /**
   * Extract opacity from color string using ColorUtils
   */
  private _extractOpacityFromColor(color: string): number | undefined {
    if (!color) return undefined;
    
    const parsed = ColorUtils.parseRgb(color);
    return parsed?.a;
  }


  /**
   * Merge all features with the same ID from PBF data into a single GeoJSON feature
   */
  private _mergeFeaturesByIdFromPBF(featureId: string | number): GeoJSONFeature | null {
    const feature = this._featureIndex.get(featureId);
    if (!feature) return null;

    const tiles = feature.getTiles();
    const allCoordinateRings: number[][][] = [];
    let properties: Record<string, any> = {};

    this.logger.log(`Merging feature ${featureId} from ${Object.keys(tiles).length} tiles`);

    // Collect all coordinate rings from all tiles containing this feature
    for (const [tileId, tileData] of Object.entries(tiles)) {
      const vectorFeature = tileData.vectorTileFeature;
      const coordinates = vectorFeature.loadGeometry();
      
      if (coordinates && coordinates.length > 0) {
        // Set properties from the first feature encountered
        if (Object.keys(properties).length === 0) {
          properties = { ...vectorFeature.properties };
        }

        // Convert PBF coordinates to geographic coordinates
        const tileContext = this._visibleTiles[tileId];
        if (tileContext) {
          const convertedCoords = this._convertPBFCoordinatesToGeoJSON(
            coordinates, 
            tileContext, 
            tileData.divisor,
            vectorFeature.type
          );
          
          if (convertedCoords && vectorFeature.type === 3) { // Only handle Polygons for now
            // convertedCoords is an array of rings from this tile
            if (Array.isArray(convertedCoords) && convertedCoords.length > 0) {
              // Add all rings from this tile to our collection
              for (const ring of convertedCoords as number[][][]) {
                if (ring && ring.length > 0) {
                  allCoordinateRings.push(ring);
                }
              }
            }
          }
        }
      }
    }

    if (allCoordinateRings.length === 0) return null;

    this.logger.log(`Collected ${allCoordinateRings.length} coordinate rings from ${Object.keys(tiles).length} tiles for feature ${featureId}`);

    // Merge connecting rings into optimal polygon/multipolygon structure
    const mergedGeometry = this._mergeConnectingRings(allCoordinateRings);

    return {
      type: 'Feature',
      id: featureId,
      properties,
      geometry: mergedGeometry
    };
  }

  /**
   * Merge connecting coordinate rings into optimal polygon/multipolygon geometry
   */
  private _mergeConnectingRings(rings: number[][][]): { type: 'Polygon' | 'MultiPolygon', coordinates: number[][][] | number[][][][] } {
    if (rings.length === 0) {
      return { type: 'Polygon', coordinates: [] };
    }
    
    if (rings.length === 1) {
      return { type: 'Polygon', coordinates: rings };
    }

    this.logger.log(`Starting polygon merge for ${rings.length} rings`);

    try {
      // Convert rings to individual polygon features
      const polygons = rings.map((ring, index) => {
        // Ensure the ring is closed
        const closedRing = this._ensureRingClosure(ring);
        return polygon([closedRing], { originalIndex: index });
      });

      // Group polygons that touch or overlap
      const polygonGroups = this._groupTouchingPolygons(polygons);
      
      this.logger.log(`Grouped ${polygons.length} polygons into ${polygonGroups.length} groups`);

      // Merge each group and collect results
      const mergedPolygons: Feature<Polygon | MultiPolygon>[] = [];
      
      for (const group of polygonGroups) {
        if (group.length === 1) {
          // Single polygon, no merging needed
          mergedPolygons.push(group[0]);
        } else {
          // Merge touching polygons using union operation
          const merged = this._unionPolygons(group);
          if (merged) {
            mergedPolygons.push(merged);
          } else {
            // Fallback: keep original polygons if union failed
            mergedPolygons.push(...group);
          }
        }
      }

      // Convert back to GeoJSON geometry format
      const result = this._convertTurfPolygonsToGeometry(mergedPolygons);
      
      this.logger.log(`Merged ${rings.length} rings into ${result.type} with ${mergedPolygons.length} polygon groups`);
      return result;

    } catch (error) {
      this.logger.error('Error in polygon merging, falling back to simple approach:', error);
      // Fallback to original simple approach - return as single polygon
      rings.sort((a, b) => this._calculateRingArea(b) - this._calculateRingArea(a));
      return { type: 'Polygon', coordinates: rings };
    }
  }

  /**
   * Calculate the area of a ring (simplified)
   */
  private _calculateRingArea(ring: number[][]): number {
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
   * Ensure a ring is properly closed (first point equals last point)
   */
  private _ensureRingClosure(ring: number[][]): number[][] {
    if (ring.length < 3) return ring;
    
    const firstPoint = ring[0];
    const lastPoint = ring[ring.length - 1];
    
    // Check if the ring is already closed
    if (firstPoint[0] === lastPoint[0] && firstPoint[1] === lastPoint[1]) {
      return ring;
    }
    
    // Close the ring by adding the first point at the end
    return [...ring, firstPoint];
  }

  /**
   * Group polygons that touch or overlap using Union-Find algorithm
   */
  private _groupTouchingPolygons(polygons: Feature<Polygon>[]): Feature<Polygon>[][] {
    if (polygons.length <= 1) return [polygons];

    // Cache coordinate extraction for performance
    const polygonCoords = polygons.map(poly => this._getAllCoordinates(poly));
    
    // Union-Find data structure for efficient grouping
    const parent = Array.from({ length: polygons.length }, (_, i) => i);
    
    const find = (x: number): number => {
      if (parent[x] !== x) {
        parent[x] = find(parent[x]); // Path compression
      }
      return parent[x];
    };
    
    const union = (x: number, y: number): void => {
      const rootX = find(x);
      const rootY = find(y);
      if (rootX !== rootY) {
        parent[rootX] = rootY;
      }
    };

    // Build adjacency using cached coordinates - O(n²) instead of O(n³)
    for (let i = 0; i < polygons.length; i++) {
      for (let j = i + 1; j < polygons.length; j++) {
        if (this._polygonsTouchOrOverlap(polygons[i], polygons[j], polygonCoords[i], polygonCoords[j])) {
          union(i, j);
        }
      }
    }

    // Group polygons by their root parent
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
   * Check if two polygons touch or overlap (including point-touching)
   */
  private _polygonsTouchOrOverlap(poly1: Feature<Polygon>, poly2: Feature<Polygon>, coords1: number[][], coords2: number[][]): boolean {
    try {
      // Method 1: Direct coordinate comparison using pre-extracted coordinates
      if (this._hasSharedCoordinates(coords1, coords2)) {
        return true;
      }

      // Method 2: Geometric intersection for overlapping cases
      const intersection = intersect(poly1, poly2);
      return intersection !== null && intersection !== undefined;
    } catch (error) {
      this.logger.warn('Error checking polygon overlap, assuming they don\'t touch:', error);
      return false;
    }
  }

  /**
   * Check if two polygons share any exact coordinates using pre-extracted coordinates
   */
  private _hasSharedCoordinates(coords1: number[][], coords2: number[][]): boolean {
    try {
      // Create a Set of coordinate strings for O(1) lookup
      const coordSet1 = new Set<string>();
      for (const coord of coords1) {
        coordSet1.add(`${coord[0]},${coord[1]}`);
      }
      
      // Check if any coordinate from coords2 matches coords1
      for (const coord of coords2) {
        if (coordSet1.has(`${coord[0]},${coord[1]}`)) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      this.logger.warn('Error checking shared coordinates:', error);
      return false;
    }
  }

  /**
   * Extract all coordinates from a polygon
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
   * Union multiple polygons into a single polygon or multipolygon
   */
  private _unionPolygons(polygons: Feature<Polygon>[]): Feature<Polygon | MultiPolygon> | null {
    // Early returns for performance
    if (polygons.length === 0) return null;
    if (polygons.length === 1) return polygons[0];

    try {
      // Reduce approach for cleaner code
      return polygons.slice(1).reduce<Feature<Polygon | MultiPolygon, Properties>>((result, currentPolygon, index) => {
        
        const unionResult = union(result, currentPolygon);
        if (!unionResult) {
          this.logger.warn(`Failed to union polygon ${index}, keeping separate`);
          return result; // Keep previous result instead of failing completely
        }
        
        return unionResult;
      }, polygons[0]);
    } catch (error) {
      this.logger.error('Error in polygon union operation:', error);
      return null;
    }
  }

  /**
   * Convert Turf.js polygon features back to proper GeoJSON geometry
   */
  private _convertTurfPolygonsToGeometry(polygons: Feature<Polygon | MultiPolygon>[]): { type: 'Polygon' | 'MultiPolygon', coordinates: number[][][] | number[][][][] } {
    // Early returns for performance
    if (polygons.length === 0) {
      return { type: 'Polygon', coordinates: [] };
    }
    
    if (polygons.length === 1) {
      // Single result - return as-is with proper typing
      const { geometry } = polygons[0];
      return {
        type: geometry.type as 'Polygon' | 'MultiPolygon',
        coordinates: geometry.coordinates as number[][][] | number[][][][]
      };
    }
    
    // Multiple polygons - efficiently build MultiPolygon
    const multiPolygonCoords: number[][][][] = [];
    
    for (const { geometry } of polygons) {
      if (geometry.type === 'Polygon') {
        multiPolygonCoords.push(geometry.coordinates);
      } else {
        // Flatten MultiPolygon components
        multiPolygonCoords.push(...geometry.coordinates);
      }
    }
    
    return {
      type: 'MultiPolygon',
      coordinates: multiPolygonCoords
    };
  }


  /**
   * Convert PBF coordinates to GeoJSON geographic coordinates
   */
  private _convertPBFCoordinatesToGeoJSON(
    pbfCoordinates: any[], 
    tileContext: TileContext, 
    divisor: number,
    geometryType: number
  ): number[][] | number[][][] | null {
    const tileCoord = this.getTileObject(tileContext.id);
    const z = tileCoord.z;
    const x = tileCoord.x;
    const y = tileCoord.y;
    const tileSize = tileContext.tileSize;

    this.logger.log(`Converting coordinates for tile ${z}/${x}/${y}, divisor: ${divisor}, tileSize: ${tileSize}, geometryType: ${geometryType}`);

    try {
      const convertPoint = (point: any): [number, number] => {
        // Convert from PBF extent coordinates to tile pixel coordinates
        const pixelX = point.x / divisor;
        const pixelY = point.y / divisor;
        
        // Convert to tile-relative coordinates (0-1)
        const tileX = pixelX / tileSize;
        const tileY = pixelY / tileSize;
        
        // Convert to global tile coordinates
        const globalX = x + tileX;
        const globalY = y + tileY;
        
        // Convert to geographic coordinates using Web Mercator projection
        const tileCount = 1 << z; // Faster than Math.pow(2, z)
        const lon = (globalX / tileCount) * 360 - 180;
        const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * globalY / tileCount))) * 180 / Math.PI;
        
        return [lon, lat]; // GeoJSON format: [longitude, latitude]
      };

      if (geometryType === 1) { // Point
        // For points, pbfCoordinates is array of point groups
        const result = pbfCoordinates.map(pointGroup => {
          if (Array.isArray(pointGroup) && pointGroup.length > 0) {
            return convertPoint(pointGroup[0]);
          }
          return convertPoint(pointGroup);
        });
        this.logger.log(`Converted ${result.length} points`);
        return result;
      } else if (geometryType === 2) { // LineString  
        // For linestrings, pbfCoordinates is array of line parts
        const result = pbfCoordinates.map(lineString => 
          lineString.map(convertPoint)
        );
        this.logger.log(`Converted ${result.length} linestrings with ${result.map(ls => ls.length)} points each`);
        return result;
      } else if (geometryType === 3) { // Polygon
        // For polygons, pbfCoordinates is array of rings
        const result = pbfCoordinates.map(ring => 
          ring.map(convertPoint)
        );
        this.logger.log(`Converted polygon with ${result.length} rings, ring sizes: ${result.map(r => r.length)}`);
        return result;
      }
    } catch (error) {
      this.logger.error('Error converting PBF coordinates to GeoJSON:', error, {
        tileId: tileContext.id,
        geometryType,
        coordinatesLength: pbfCoordinates.length,
        firstCoord: pbfCoordinates[0]
      });
    }

    return null;
  }

  /**
   * Get vector tile feature from MVT feature
   */
  private _getVectorFeatureFromMVTFeature(mvtFeature: MVTFeature): VectorTileFeature | null {
    const tiles = mvtFeature.getTiles();
    const firstTileId = Object.keys(tiles)[0];
    if (firstTileId && tiles[firstTileId]) {
      return tiles[firstTileId].vectorTileFeature;
    }
    return null;
  }

  /**
   * Call feature selection callback
   */
  private async _callFeatureSelectionCallback(
    featureId: string | number, 
    originalFeature: import('@mapbox/vector-tile').VectorTileFeature, 
    selected: boolean
  ): Promise<void> {
    if (!this._featureSelectionCallback) return;

    try {
      let featureData = this._replacedFeatures[featureId];
      
      if (!featureData && selected) {
        if (this._getReplacementFeature) {
          const feature = this._featureIndex.get(featureId);
          if (feature) {
            const tiles = feature.getTiles();
            const firstTileId = Object.keys(tiles)[0];
            if (firstTileId && tiles[firstTileId]) {
              const originalVectorFeature = tiles[firstTileId].vectorTileFeature;
              
              try {
                const replacementResult = await Promise.resolve(
                  this._getReplacementFeature(originalVectorFeature, featureId)
                );
                
                if (replacementResult) {
                  this._replacedFeatures[featureId] = replacementResult;
                  this._addGeoJSONOverlay(featureId, replacementResult);
                  featureData = replacementResult;
                } else {
                  // Fallback to merging features by ID from PBF
                  const mergedFeature = this._mergeFeaturesByIdFromPBF(featureId);
                  if (mergedFeature) {
                    featureData = mergedFeature;
                  }
                }
              } catch (error) {
                this.logger.warn(`Failed to fetch replacement feature for ${featureId}:`, error);
              }
            }
          }
        } else {
          const mergedFeature = this._mergeFeaturesByIdFromPBF(featureId);
          if (mergedFeature) {
            featureData = mergedFeature;
          }
        }
      }

      // Fallback to empty feature
      if (!featureData) {
        featureData = {
          type: 'Feature' as const,
          id: featureId,
          properties: originalFeature.properties || {},
          geometry: {
            type: 'Point',
            coordinates: []
          }
        };
      }

      this._featureSelectionCallback(featureId, featureData, selected);
    } catch (error) {
      this.logger.error('Error in feature selection callback:', error);
    }
  }

  /**
   * Cleanup method for when layer is removed
   */
  dispose(): void {
    this.logger.log('Disposing MVTSource and cleaning up all resources');
    
    // Remove self from map's overlay types
    try {
      const overlayIndex = this.map.overlayMapTypes.getArray().indexOf(this);
      if (overlayIndex !== -1) {
        this.map.overlayMapTypes.removeAt(overlayIndex);
        this.logger.log(`Removed MVTSource from overlayMapTypes at index ${overlayIndex}`);
      }
    } catch (error) {
      this.logger.warn('Error removing MVTSource from overlayMapTypes:', error);
    }
    
    // Remove all event listeners
    this._eventListeners.forEach(listener => {
      if (listener && typeof listener.remove === 'function') {
        listener.remove();
      }
    });
    this._eventListeners = [];
    
    // Clear all GeoJSON overlays
    Object.values(this._geoJSONOverlays).forEach(overlay => {
      try {
        this.map.data.remove(overlay);
      } catch (error) {
        this.logger.warn('Error removing GeoJSON overlay during disposal:', error);
      }
    });
    this._geoJSONOverlays = {};
    
    this.deselectAllFeatures();
    
    this._featureIndex.clear();
    this._selectedFeatureIds.clear();
    this._hoveredFeatureIds.clear();
    this._tilesDrawn = {};
    this._visibleTiles = {};
    this._replacedFeatures = {};
    
    this._pendingRedraws.clear();
    if (this._redrawDebounceTimer) {
      clearTimeout(this._redrawDebounceTimer);
      this._redrawDebounceTimer = null;
    }
    
    Object.values(this.mVTLayers).forEach(layer => {
      if (layer.dispose) {
        layer.dispose();
      }
    });
    this.mVTLayers = {};
    
    this.logger.log('MVTSource disposal complete');
  }
}