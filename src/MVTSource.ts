import { VectorTile, VectorTileFeature } from '@mapbox/vector-tile';
import Protobuf from 'pbf';
import { MVTLayer } from './MVTLayer';
import { MVTFeature } from './MVTFeature';
import { Mercator } from './Mercator';
import { ColorUtils } from './ColorUtils';
import { createLogger, debugLogger } from './DebugLogger';
import { GeometryMerger } from './geojson/GeometryMerger';
import { StyleResolver, DEFAULT_COLORS } from './style/StyleResolver';
import { TileLoader } from './tiles/TileLoader';
import { RedrawScheduler } from './render/RedrawScheduler';
import {
  MVTSourceOptions,
  TileContext,
  TileCoord,
  MVTMouseEvent,
  MouseEventOptions,
  FeatureStyle,
  FeatureStyleFunction,
  FilterFunction,
  GeoJSONFeature,
  FeatureReplacementFunction,
  FeatureSelectionCallback,
  TileManifest,
  TileAvailabilitySource,
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
  private _geometryMerger = new GeometryMerger();

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

  /** Bumped on every selection mutation, so deferred work can detect that the
   *  selection changed underneath it. */
  private _selectionVersion = 0;

  // Tile management.
  //
  // Caches the *decoded tile* only. It used to hold the whole TileContext,
  // which pinned a detached 256x256 canvas per entry (~26MB at the 100-entry
  // limit) and let drawTile hand the same DOM node out twice.
  private _tilesDrawn: Record<string, VectorTile> = {};
  private _visibleTiles: Record<string, TileContext> = {};

  /** Canvas nodes currently handed to Google Maps, mapped to their tile id.
   *  The same tile id may be mounted more than once at low zoom, where the
   *  world repeats horizontally. */
  private _mountedTiles: Map<Element, string> = new Map();

  /** Tile ids that have completed a fetch (successfully or not) for the
   *  current visible set. Drives tileLoaded(). */
  private _loadedTileIds: Set<string> = new Set();

  private _disposed = false;

  // GeoJSON overlay management
  private _geoJSONOverlays: Record<string | number, google.maps.Data.Feature> = {};

  /** Reverse of _geoJSONOverlays, preserving the feature id's original type. */
  private _overlayToFeatureId: Map<google.maps.Data.Feature, string | number> = new Map();
  private _replacedFeatures: Record<string | number, GeoJSONFeature> = {};
  private _getReplacementFeature: FeatureReplacementFunction | undefined;
  private _featureSelectionCallback: FeatureSelectionCallback | undefined;
  private _pendingReplacementRequests: Map<string | number, AbortController> = new Map();

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

  // Batched redraw system for smooth rendering
  private _redraws: RedrawScheduler = new RedrawScheduler((tileIds) => this._repaintTiles(tileIds));

  private _styleResolver!: StyleResolver;

  // Cache size limits to prevent memory leaks
  private static readonly MAX_TILES_CACHE_SIZE = 100;

  private _tileLoader!: TileLoader;

  /** Pending tileLoaded() poll timers, cancelled on dispose. */
  private _tileLoadedTimers: Set<ReturnType<typeof setTimeout>> = new Set();

  /** Deferred timers from _zoomChanged and setStyle, cancelled on dispose. */
  private _deferredTimers: Set<ReturnType<typeof setTimeout>> = new Set();

  /** Pending hover-delay timer, cancelled on dispose. */
  private _hoverTimer: ReturnType<typeof setTimeout> | null = null;

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

    // Event handling configuration
    this._onClickCallback = options.onClick;
    this._onMouseHoverCallback = options.onMouseHover;
    this._multipleSelection = options.multipleSelection || false;
    this._toggleSelection = options.toggleSelection !== undefined ? options.toggleSelection : true;
    this._setSelectedOnClick = options.setSelectedOnClick !== undefined ? options.setSelectedOnClick : true;
    this._limitToFirstVisibleLayer = options.limitToFirstVisibleLayer || false;
    this._hoverDelay = options.hoverDelay || 0;

    this.tileSize = new google.maps.Size(this._tileSize, this._tileSize);
    this.style = options.style || StyleResolver.defaultStyleFor;
    this._tileLoader = new TileLoader(
      this._url,
      this._xhrHeaders,
      {
        onResponse: (tileContext, body) => this._onTileResponse(tileContext, body),
        onSettled: (tileId) => this._markTileLoaded(tileId),
        onFailed: (tileContext) => this._drawDebugInfo(tileContext),
        isDisposed: () => this._disposed,
      },
      options.tileAvailabilityManifest,
    );

    this._styleResolver = new StyleResolver(this.style, {
      isSelected: (id) => this._selectedFeatureIds.has(id),
      isHovered: (id) => this._hoveredFeatureIds.has(id),
      featureCount: () => this._featureIndex.size,
    });
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
    this._tileLoader.initializeManifest().catch((error: unknown) => {
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

    // Hover is transient and viewport-bound, so it goes with the feature.
    // Selection deliberately does NOT: it is source-level state that must
    // survive a feature scrolling out of view and coming back. This matters
    // now that releaseTile() actually disposes off-screen features - clearing
    // selection here would silently drop it on every pan.
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
    return typeof value === 'string' || typeof value === 'number' ? value : null;
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
   * Get tile for Google Maps tile system
   */
  getTile(coord: google.maps.Point, zoom: number, ownerDocument: Document): HTMLElement {
    this.logger.log(`Getting tile: ${zoom}/${coord.x}/${coord.y}`);
    const tileContext = this.drawTile(coord, zoom, ownerDocument);
    this._setVisibleTile(tileContext);
    this._mountedTiles.set(tileContext.canvas, tileContext.id);
    return tileContext.canvas;
  }

  /**
   * Release a tile that Google Maps has scrolled out of view.
   *
   * Google Maps calls this for every tile it discards. Without it nothing was
   * ever freed: the feature index, each layer's feature map, and the decoded
   * PBF buffer behind every tile grew for the lifetime of the map.
   */
  releaseTile(tile?: Element | null): void {
    if (!tile) return;

    const tileId = this._mountedTiles.get(tile);
    if (tileId === undefined) return;
    this._mountedTiles.delete(tile);

    // The same tile id can be mounted more than once (repeated worlds at low
    // zoom). Only tear down shared state once the last copy is gone.
    for (const id of this._mountedTiles.values()) {
      if (id === tileId) {
        this.logger.log(`Released one copy of tile ${tileId}; others still mounted`);
        return;
      }
    }

    this.logger.log(`Releasing tile: ${tileId}`);

    this._tileLoader.abort(tileId);
    delete this._visibleTiles[tileId];

    for (const [layerName, layer] of Object.entries(this.mVTLayers)) {
      if (layer.releaseTile(tileId)) {
        delete this.mVTLayers[layerName];
      }
    }

    // With caching off, drop the decoded tile too - it pins the PBF buffer.
    // With caching on it is deliberately retained, bounded by
    // MAX_TILES_CACHE_SIZE, which is the point of the option.
    if (!this._cache) {
      delete this._tilesDrawn[tileId];
    }

    this._redraws.cancel(tileId);
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
      const versionAtZoom = this._selectionVersion;
      const timer = setTimeout(() => {
        this._deferredTimers.delete(timer);
        if (this._disposed) return;

        // If the selection changed during the window, the user's intent wins.
        // Re-adding blindly resurrected features deselected in those 50ms.
        if (this._selectionVersion !== versionAtZoom) return;

        selectedIds.forEach((featureId) => this._selectedFeatureIds.add(featureId));
        this._scheduleRedraw('all');
      }, 50);
      this._deferredTimers.add(timer);
    }
  }

  /**
   * Reset MVT layers
   */
  private _resetMVTLayers(): void {
    // Dispose before dropping. Assigning {} released the layers by reference
    // only, so every feature's cached geometry leaked on each zoom change and
    // on every setUrl().
    Object.values(this.mVTLayers).forEach((layer) => layer.dispose?.());
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
    // No FIFO cap here. The previous 50-tile limit evicted genuinely visible
    // tiles on any viewport above ~1080p (a 4K screen needs ~135), which broke
    // click and hover across half the map. releaseTile() now bounds this set.
    this._visibleTiles[tileContext.id] = tileContext;
  }

  /**
   * Draw a tile
   */
  drawTile(coord: google.maps.Point, zoom: number, ownerDocument: Document): TileContext {
    const id = this.getTileId(zoom, coord.x, coord.y);
    const cachedTile = this._tilesDrawn[id];

    // Always hand back a fresh canvas. A DOM node can only be in one place, so
    // returning the cached tile's canvas a second time silently detached it
    // from the first mount point and left that tile permanently blank.
    const tileContext = this._createTileContext(coord, zoom, ownerDocument);

    if (cachedTile) {
      this._drawVectorTile(cachedTile, tileContext);
      return tileContext;
    }

    this._tileLoader.fetch(tileContext, this.getTileObject(tileContext.parentId || tileContext.id));
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
      parentId,
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
   * Generate tile ID.
   *
   * `x` is wrapped into `[0, 2^zoom)`. Google Maps hands out unwrapped x for
   * repeated world copies and across the antimeridian, so without this the
   * stored id never matched the normalized id that hit-testing derives from
   * `Mercator.getTileAtLatLng` - clicks were dead on every wrapped copy - and
   * the request URL got a negative or out-of-range x that 404s.
   */
  getTileId(zoom: number, x: number, y: number): string {
    const worldTiles = Math.pow(2, zoom);
    const wrappedX = ((x % worldTiles) + worldTiles) % worldTiles;
    return [zoom, wrappedX, y].join(':');
  }

  /**
   * Parse tile ID to object
   */
  getTileObject(id: string): TileCoord {
    const values = id.split(':');
    const z = Number.parseInt(values[0], 10);
    const x = Number.parseInt(values[1], 10);
    const y = Number.parseInt(values[2], 10);

    if (Number.isNaN(z) || Number.isNaN(x) || Number.isNaN(y)) {
      throw new Error(`Malformed tile id: "${id}" (expected "z:x:y")`);
    }

    return { z, x, y };
  }

  /**
   * Decode and draw a tile response.
   */
  private _onTileResponse(tileContext: TileContext, response: ArrayBuffer): void {
    // map.getZoom() is fractional during smooth zoom on vector basemaps, so
    // comparing it directly to the integer tile zoom discarded every response.
    const currentZoom = this.map.getZoom();
    if (currentZoom !== undefined && Math.floor(currentZoom) !== tileContext.zoom) {
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
   * Record that a tile finished loading, however it finished.
   */
  private _markTileLoaded(tileId: string): void {
    this._loadedTileIds.add(tileId);
    this.loadedTilesLen = this._loadedTileIds.size;
  }

  /**
   * True when every currently visible tile has settled.
   */
  private _allVisibleTilesLoaded(): boolean {
    const visibleIds = Object.keys(this._visibleTiles);
    if (visibleIds.length === 0) return false;
    return visibleIds.every((id) => this._loadedTileIds.has(id));
  }

  /**
   * Resolve once every visible tile has settled.
   *
   * `loadedTilesLen` was only ever assigned 0 and never incremented, so the
   * old resolve condition was unsatisfiable: each call spawned a self-
   * recursive setTimeout that ran forever and never settled its promise.
   *
   * @param timeoutMs Give up after this long and resolve `false`.
   */
  async tileLoaded(timeoutMs = TileLoader.TIMEOUT_MS): Promise<boolean> {
    if (this._allVisibleTilesLoaded()) return true;

    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;

      const poll = (): void => {
        if (this._disposed) {
          resolve(false);
          return;
        }
        if (this._allVisibleTilesLoaded()) {
          resolve(true);
          return;
        }
        if (Date.now() >= deadline) {
          this.logger.warn('tileLoaded() timed out waiting for visible tiles');
          resolve(false);
          return;
        }
        const timer = setTimeout(() => {
          this._tileLoadedTimers.delete(timer);
          poll();
        }, 100);
        this._tileLoadedTimers.add(timer);
      };

      poll();
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
      tilesToRemove.forEach((tileId) => {
        delete this._tilesDrawn[tileId];
      });
    }

    if (tileContext.vectorTile) {
      this._tilesDrawn[tileContext.id] = tileContext.vectorTile;
    }
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
  private _drawVectorTileLayer(
    vectorTileLayer: import('@mapbox/vector-tile').VectorTileLayer,
    key: string,
    tileContext: TileContext,
  ): void {
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
      customDraw: this._customDraw,
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

    context2d.strokeStyle = DEFAULT_COLORS.DEBUG_STROKE;
    context2d.fillStyle = DEFAULT_COLORS.DEBUG_FILL;
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
    context2d.fillStyle = DEFAULT_COLORS.DEBUG_TEXT_BG;
    context2d.fillRect(textX - 2, textY - 12, textMetrics.width + 4, 16);

    // Draw text in black
    context2d.fillStyle = DEFAULT_COLORS.DEBUG_TEXT;
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

      // Without this, moving the pointer off the map (or onto a control) left
      // the last feature stuck in hover style indefinitely - hover was only
      // ever cleared by a mousemove that landed on empty space.
      const mouseOutListener = this.map.addListener('mouseout', () => {
        this.event = null;
        if (this._hoverTimer) {
          clearTimeout(this._hoverTimer);
          this._hoverTimer = null;
        }
        this.clearAllHoveredFeatures();
      });
      this._eventListeners.push(mouseOutListener);
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
        const pixel = new google.maps.Point((worldPoint.x - bottomLeft.x) * scale, (worldPoint.y - topRight.y) * scale);

        return {
          latLng: event.latLng,
          pixel: pixel,
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
      delay: mouseHover ? this._hoverDelay : 0,
    };
  }

  /**
   * Process mouse events
   */
  private _mouseEvent(
    event: MVTMouseEvent,
    callbackFunction?: (event: MVTMouseEvent) => void,
    options?: MouseEventOptions,
  ): void {
    if (!event.pixel || !event.latLng) return;

    if (options?.delay === 0) {
      return this._mouseEventContinue(event, callbackFunction, options ?? {});
    }

    this.event = event;
    if (this._hoverTimer) clearTimeout(this._hoverTimer);
    this._hoverTimer = setTimeout(() => {
      this._hoverTimer = null;
      if (this._disposed) return;
      if (event === this.event) {
        this._mouseEventContinue(event, callbackFunction, options);
      }
    }, options?.delay || 0);
  }

  /**
   * Continue mouse event processing
   */
  private _mouseEventContinue(
    event: MVTMouseEvent,
    callbackFunction?: (event: MVTMouseEvent) => void,
    options?: MouseEventOptions,
  ): void {
    const callback = callbackFunction || (() => {});
    // Tile lookup needs the integer tile zoom; map.getZoom() is fractional
    // during smooth zoom on vector basemaps.
    const zoom = Math.floor(this.map.getZoom() ?? 0);
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

    // Resolve the hit across all clickable layers FIRST, then act on it once.
    // Previously _mouseSelectedFeature ran inside this loop, so a single click
    // fired the user's callback once per layer, a feature present in two
    // layers was selected by one and immediately deselected by the next, and
    // a layer that found nothing called clearAllHoveredFeatures(), wiping the
    // hover a previous layer had just set.
    const clickableLayers = this._clickableLayers || Object.keys(this.mVTLayers);
    let hit: MVTFeature | undefined;

    for (let i = clickableLayers.length - 1; i >= 0; i--) {
      const key = clickableLayers[i];
      const layer = this.mVTLayers[key];
      if (!layer) continue;

      const processedEvent = layer.handleClickEvent(event, this);
      if (processedEvent.feature) {
        hit = processedEvent.feature as MVTFeature;
        if (options?.limitToFirstVisibleLayer) break;
      }
    }

    event.feature = hit;
    this._mouseSelectedFeature(event, callback, options ?? {});
  }

  /**
   * Handle mouse events on features
   */
  private _mouseSelectedFeature(
    event: MVTMouseEvent,
    callbackFunction?: (event: MVTMouseEvent) => void,
    options?: MouseEventOptions,
  ): void {
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
    this._selectionVersion++;
    const feature = this._featureIndex.get(featureId);

    if (feature) {
      feature.setSelected(true);
      this._scheduleRedrawForFeature(featureId);

      if (this._featureSelectionCallback) {
        const vectorFeature = this._getVectorFeatureFromMVTFeature(feature);
        if (vectorFeature) {
          void this._callFeatureSelectionCallback(featureId, vectorFeature, true).catch((error) => {
            this.logger.error('Feature selection callback failed:', error);
          });
        }
      }
    }
  }

  /**
   * Deselect a feature by ID
   */
  private _deselectFeature(featureId: string | number): void {
    this._selectedFeatureIds.delete(featureId);
    this._selectionVersion++;

    // Cancel any pending replacement requests for this feature
    const pendingRequest = this._pendingReplacementRequests.get(featureId);
    if (pendingRequest) {
      pendingRequest.abort();
      this._pendingReplacementRequests.delete(featureId);
    }

    const feature = this._featureIndex.get(featureId);

    if (feature) {
      feature.setSelected(false);
      this._scheduleRedrawForFeature(featureId);

      if (this._featureSelectionCallback) {
        const vectorFeature = this._getVectorFeatureFromMVTFeature(feature);
        if (vectorFeature) {
          void this._callFeatureSelectionCallback(featureId, vectorFeature, false).catch((error) => {
            this.logger.error('Feature selection callback failed:', error);
          });
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
    const hadSelections = this._selectedFeatureIds.size > 0;

    this._batchDeselectAllFeatures();

    if (hadSelections) {
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

    hoveredIds.forEach((featureId) => {
      const feature = this._featureIndex.get(featureId);
      if (feature) {
        feature.hovered = false;
        this._scheduleRedrawForFeature(featureId);
      }
    });
  }

  /**
   * Queue redraws for every visible tile a feature appears in.
   */
  private _scheduleRedrawForFeature(featureId: string | number): void {
    const feature = this._featureIndex.get(featureId);
    if (!feature) return;

    const tileIds = Object.keys(feature.getTiles()).filter((tileId) => this._visibleTiles[tileId]);
    this._redraws.scheduleMany(tileIds);
  }

  /**
   * Schedule tile redraws with debouncing
   */
  private _scheduleRedraw(scope: 'all' | string): void {
    if (scope === 'all') {
      this._redraws.scheduleMany(Object.keys(this._visibleTiles));
    } else {
      this._redraws.schedule(scope);
    }
  }

  /**
   * Repaint the given tiles from their decoded geometry.
   */
  private _repaintTiles(tileIds: string[]): void {
    tileIds.forEach((tileId) => {
      const tileContext = this._visibleTiles[tileId];
      if (tileContext && tileContext.vectorTile) {
        this.deleteTileDrawn(tileId);
        this.clearTile(tileContext.canvas);
        this._drawVectorTile(tileContext.vectorTile, tileContext);
      }
    });
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
      .map((id) => this._featureIndex.get(id))
      .filter((feature) => feature !== undefined) as MVTFeature[];
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

    this._batchDeselectAllFeatures();
    this._batchSelectFeatures(featuresIds);
    this._scheduleRedraw('all');
  }

  /**
   * Add features to current selection
   */
  addToSelection(featureIds: (string | number)[]): void {
    if (featureIds.length === 0) return;

    this._multipleSelection = true;
    const newSelections: (string | number)[] = [];

    for (const featureId of featureIds) {
      if (!this._selectedFeatureIds.has(featureId)) {
        newSelections.push(featureId);
      }
    }

    if (newSelections.length > 0) {
      this._batchSelectFeatures(newSelections);
      this._scheduleRedraw('all');
    }
  }

  /**
   * Remove features from current selection
   */
  removeFromSelection(featureIds: (string | number)[]): void {
    if (featureIds.length === 0) return;

    const toRemove: (string | number)[] = [];

    for (const featureId of featureIds) {
      if (this._selectedFeatureIds.has(featureId)) {
        toRemove.push(featureId);
      }
    }

    if (toRemove.length > 0) {
      this._batchDeselectFeatures(toRemove);
      this._scheduleRedraw('all');
    }
  }

  private _batchDeselectFeatures(featureIds: (string | number)[]): void {
    const callbackPromises: Promise<void>[] = [];

    for (const featureId of featureIds) {
      this._selectedFeatureIds.delete(featureId);
      this._selectionVersion++;

      const pendingRequest = this._pendingReplacementRequests.get(featureId);
      if (pendingRequest) {
        pendingRequest.abort();
        this._pendingReplacementRequests.delete(featureId);
      }

      const feature = this._featureIndex.get(featureId);
      if (feature) {
        feature.setSelected(false);

        if (this._featureSelectionCallback) {
          const vectorFeature = this._getVectorFeatureFromMVTFeature(feature);
          if (vectorFeature) {
            callbackPromises.push(this._callFeatureSelectionCallback(featureId, vectorFeature, false));
          }
        }
      }

      this._removeGeoJSONOverlay(featureId);
      delete this._replacedFeatures[featureId];
    }

    if (callbackPromises.length > 0) {
      Promise.all(callbackPromises).catch((error) => {
        this.logger.warn('Error in batch deselection callbacks:', error);
      });
    }
  }

  private _batchSelectFeatures(featureIds: (string | number)[]): void {
    const callbackPromises: Promise<void>[] = [];

    for (const featureId of featureIds) {
      if (!this._multipleSelection && this._selectedFeatureIds.size > 0) {
        break;
      }

      this._selectedFeatureIds.add(featureId);
      this._selectionVersion++;
      const feature = this._featureIndex.get(featureId);

      if (feature) {
        feature.setSelected(true);

        if (this._featureSelectionCallback) {
          const vectorFeature = this._getVectorFeatureFromMVTFeature(feature);
          if (vectorFeature) {
            callbackPromises.push(this._callFeatureSelectionCallback(featureId, vectorFeature, true));
          }
        }
      }
    }

    if (callbackPromises.length > 0) {
      Promise.all(callbackPromises).catch((error) => {
        this.logger.warn('Error in batch selection callbacks:', error);
      });
    }
  }

  private _batchDeselectAllFeatures(): void {
    const selectedIds = Array.from(this._selectedFeatureIds);

    this._selectedFeatureIds.clear();
    this._selectionVersion++;

    this._pendingReplacementRequests.forEach((controller) => {
      controller.abort();
    });
    this._pendingReplacementRequests.clear();

    const callbackPromises: Promise<void>[] = [];

    selectedIds.forEach((featureId) => {
      const feature = this._featureIndex.get(featureId);
      if (feature) {
        feature.setSelected(false);

        if (this._featureSelectionCallback) {
          const vectorFeature = this._getVectorFeatureFromMVTFeature(feature);
          if (vectorFeature) {
            callbackPromises.push(this._callFeatureSelectionCallback(featureId, vectorFeature, false));
          }
        }
      }

      this._removeGeoJSONOverlay(featureId);
      delete this._replacedFeatures[featureId];
    });

    if (callbackPromises.length > 0) {
      Promise.all(callbackPromises).catch((error) => {
        this.logger.warn('Error in batch deselection callbacks:', error);
      });
    }
  }

  /**
   * Set filter function
   */
  setFilter(filter: FilterFunction | false, redrawTiles = true): void {
    this._filter = filter;
    Object.values(this.mVTLayers).forEach((layer) => {
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
    this._styleResolver.setStyle(this.style);

    Object.values(this.mVTLayers).forEach((layer) => {
      layer.setStyle(style);
    });

    this._featureIndex.forEach((feature, featureId) => {
      if (currentSelectedIds.includes(featureId)) {
        feature.setSelected(true);
      }
    });

    if (redrawTiles) {
      const timer = setTimeout(() => {
        this._deferredTimers.delete(timer);
        if (this._disposed) return;
        this._scheduleRedraw('all');
      }, 0);
      this._deferredTimers.add(timer);
    }
  }

  /**
   * Get current style for feature with selection/hover state
   */
  getStyleForFeature(feature: VectorTileFeature, featureId: string | number): FeatureStyle {
    return this._styleResolver.resolve(feature, featureId);
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

    // Abort requests aimed at the old URL before they can land as new tiles.
    this._tileLoader.setUrl(url);
    this._tileLoader.abortAll();

    this._resetMVTLayers();

    // Drop cached tiles too. Without this, `cache: true` kept serving tiles
    // fetched from the previous URL.
    this._tilesDrawn = {};
    this._loadedTileIds.clear();
    this.loadedTilesLen = 0;

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
    await this._tileLoader.setManifest(manifest);
  }

  /**
   * Get current resolved manifest
   */
  getTileAvailabilityManifest(): TileManifest | undefined {
    return this._tileLoader.getManifest();
  }

  /**
   * Refresh manifest (useful for function-based manifests)
   */
  async refreshManifest(): Promise<void> {
    await this._tileLoader.initializeManifest();
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
  /**
   * Resolve a Data.Feature overlay back to its MVT feature id.
   *
   * Uses a reverse map rather than Object.entries(this._geoJSONOverlays),
   * whose keys are always strings. For the common case of a numeric feature id
   * that produced `"123"` instead of `123`, so the id never matched
   * `_selectedFeatureIds` or `_featureIndex`: clicking an overlay to deselect
   * it added an unreachable ghost entry to the selection set instead.
   */
  private _findOverlayFeatureId(overlay: google.maps.Data.Feature | undefined): string | number | null {
    if (!overlay) return null;
    return this._overlayToFeatureId.get(overlay) ?? null;
  }

  private _setupGeoJSONClickHandlers(): void {
    // Click handler
    const dataClickListener = this.map.data.addListener('click', (event: google.maps.Data.MouseEvent) => {
      if (event.feature) {
        const featureId = this._findOverlayFeatureId(event.feature);

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
        const featureId = this._findOverlayFeatureId(event.feature);

        if (featureId !== null) {
          const mvtEvent: MVTMouseEvent = {
            latLng: event.latLng || new google.maps.LatLng(0, 0),
            pixel: new google.maps.Point(0, 0),
            feature: {
              featureId: featureId,
              properties: this._replacedFeatures[featureId]?.properties || {},
            },
          };

          this._onMouseHoverCallback(mvtEvent);
        }
      }
    });
    this._eventListeners.push(dataMouseOverListener);

    const dataMouseMoveListener = this.map.data.addListener('mousemove', (event: google.maps.Data.MouseEvent) => {
      if (event.feature && this._onMouseHoverCallback) {
        const featureId = this._findOverlayFeatureId(event.feature);

        if (featureId !== null) {
          const mvtEvent: MVTMouseEvent = {
            latLng: event.latLng || new google.maps.LatLng(0, 0),
            pixel: new google.maps.Point(0, 0),
            feature: {
              featureId: featureId,
              properties: this._replacedFeatures[featureId]?.properties || {},
            },
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
          feature: undefined,
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
        features: [geoJSONFeature],
      })[0];

      if (dataFeature) {
        this._geoJSONOverlays[featureId] = dataFeature;
        this._overlayToFeatureId.set(dataFeature, featureId);
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
        this._overlayToFeatureId.delete(overlay);
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
    const baseStyle = typeof this.style === 'function' ? {} : (this.style as FeatureStyle);
    let selectedStyle = baseStyle.selected || {};

    if (!baseStyle.selected) {
      selectedStyle = StyleResolver.selectedStyleFor({ type: 3, properties: {} } as any);
    }

    return {
      fillColor: this._convertMVTColorToGoogleMaps(selectedStyle.fillStyle || '') || '#ff8c00',
      fillOpacity: this._extractOpacityFromColor(selectedStyle.fillStyle || '') || 0.4,
      strokeColor: this._convertMVTColorToGoogleMaps(selectedStyle.strokeStyle || '') || '#ff8c00',
      strokeWeight: selectedStyle.lineWidth || 3,
      strokeOpacity: 1,
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
          const convertedCoords = this._geometryMerger.convertPBFCoordinatesToGeoJSON(
            coordinates,
            this.getTileObject(tileContext.id),
            tileContext.tileSize,
            tileData.divisor,
            vectorFeature.type,
          );

          if (convertedCoords && vectorFeature.type === 3) {
            // Only handle Polygons for now
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

    this.logger.log(
      `Collected ${allCoordinateRings.length} coordinate rings from ${Object.keys(tiles).length} tiles for feature ${featureId}`,
    );

    // Merge connecting rings into optimal polygon/multipolygon structure
    const mergedGeometry = this._geometryMerger.mergeConnectingRings(allCoordinateRings);

    return {
      type: 'Feature',
      id: featureId,
      properties,
      geometry: mergedGeometry,
    };
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
    selected: boolean,
  ): Promise<void> {
    if (!this._featureSelectionCallback) return;

    try {
      let featureData = this._replacedFeatures[featureId];

      if (!featureData && selected) {
        if (this._getReplacementFeature) {
          // Check if there's already a pending request for this feature
          if (this._pendingReplacementRequests.has(featureId)) {
            return;
          }

          const feature = this._featureIndex.get(featureId);
          if (feature) {
            const tiles = feature.getTiles();
            const firstTileId = Object.keys(tiles)[0];
            if (firstTileId && tiles[firstTileId]) {
              const originalVectorFeature = tiles[firstTileId].vectorTileFeature;

              // Create AbortController to handle cancellation
              const abortController = new AbortController();
              this._pendingReplacementRequests.set(featureId, abortController);

              try {
                const replacementResult = await Promise.resolve(
                  this._getReplacementFeature(originalVectorFeature, featureId),
                );

                // Check if the request was aborted or feature is no longer selected
                if (abortController.signal.aborted || !this._selectedFeatureIds.has(featureId)) {
                  return; // Don't apply the result if feature was deselected
                }

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
                // Don't log abort errors as they are expected
                if (error instanceof Error && error.name !== 'AbortError') {
                  this.logger.warn(`Failed to fetch replacement feature for ${featureId}:`, error);
                }
                return;
              } finally {
                // Clean up the pending request
                this._pendingReplacementRequests.delete(featureId);
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
            coordinates: [],
          },
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
    if (this._disposed) return;
    this.logger.log('Disposing MVTSource and cleaning up all resources');

    // Set first: in-flight fetches and queued timers check this before
    // touching state, so nothing can revive the source mid-teardown.
    this._disposed = true;

    // Abort every in-flight tile fetch. These were previously left running,
    // and a late response re-created mVTLayers entries and re-populated
    // _tilesDrawn, half-reviving a torn-down source.
    this._tileLoader.abortAll();

    // Cancel every timer. Only _redrawDebounceTimer used to be cleared.
    this._tileLoadedTimers.forEach(clearTimeout);
    this._tileLoadedTimers.clear();
    this._deferredTimers.forEach(clearTimeout);
    this._deferredTimers.clear();
    if (this._hoverTimer) {
      clearTimeout(this._hoverTimer);
      this._hoverTimer = null;
    }
    this._redraws.dispose();

    // Deselect before dropping the overlays it needs to clean up.
    this.deselectAllFeatures();

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
    this._eventListeners.forEach((listener) => {
      if (listener && typeof listener.remove === 'function') {
        listener.remove();
      }
    });
    this._eventListeners = [];

    // Clear all GeoJSON overlays
    Object.values(this._geoJSONOverlays).forEach((overlay) => {
      try {
        this.map.data.remove(overlay);
      } catch (error) {
        this.logger.warn('Error removing GeoJSON overlay during disposal:', error);
      }
    });
    this._geoJSONOverlays = {};
    this._overlayToFeatureId.clear();

    // Cancel any remaining pending replacement requests (should already be done by deselectAllFeatures)
    this._pendingReplacementRequests.forEach((controller) => {
      controller.abort();
    });
    this._pendingReplacementRequests.clear();

    // Dispose layers before clearing the index so each feature can drop its
    // decoded tile data; previously the whole graph was dropped by reference
    // and its cached geometry leaked.
    Object.values(this.mVTLayers).forEach((layer) => {
      if (layer.dispose) {
        layer.dispose();
      }
    });
    this.mVTLayers = {};

    this._featureIndex.clear();
    this._selectedFeatureIds.clear();
    this._hoveredFeatureIds.clear();
    this._tilesDrawn = {};
    this._visibleTiles = {};
    this._replacedFeatures = {};
    this._mountedTiles.clear();
    this._loadedTileIds.clear();
    this.loadedTilesLen = 0;

    this._styleResolver.clear();

    this.logger.log('MVTSource disposal complete');
  }
}
