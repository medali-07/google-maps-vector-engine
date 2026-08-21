import { VectorTile, VectorTileFeature } from '@mapbox/vector-tile';

// Core interfaces
export interface Point {
  x: number;
  y: number;
}

export interface TileCoord {
  x: number;
  y: number;
  z: number;
}

export interface TileBounds {
  ne: LatLng;
  sw: LatLng;
}

export interface LatLng {
  lat: number;
  lng: number;
}

// Style interfaces
export interface FeatureStyle {
  fillStyle?: string;
  fillOpacity?: number;
  strokeStyle?: string;
  lineWidth?: number;
  radius?: number;
  selected?: Partial<FeatureStyle>; // Embedded selected style like the working old version
  hover?: Partial<FeatureStyle>; // Embedded hover style for hover states
}

/**
 * Rendering context handed to a style function alongside the feature.
 *
 * Optional so that existing one-argument style functions keep working
 * unchanged. `FilterFunction` has always received the tile context; style
 * functions receiving only the feature was an inconsistency, and it forced
 * zoom-dependent styling to go through `setFilter` on every `zoom_changed`,
 * which triggers a full re-parse of every tile.
 */
export interface StyleContext {
  /** Integer zoom the tile is being rendered at. */
  zoom: number;
  tileContext: TileContext;
}

export interface FeatureStyleFunction {
  (feature: VectorTileFeature, context?: StyleContext): FeatureStyle;
}

// Event interfaces
export interface MVTMouseEvent {
  latLng: google.maps.LatLng;
  pixel: google.maps.Point;
  tileContext?: TileContext;
  tilePoint?: Point;
  feature?: any; // MVTFeature - using any to avoid circular dependency
}

export interface MouseEventOptions {
  setSelected?: boolean;
  limitToFirstVisibleLayer?: boolean;
  delay?: number;
  /**
   * True when the event is a hover rather than a click.
   *
   * Stated explicitly rather than inferred from which callback is in play:
   * hover used to be detected by comparing the callback against
   * `onMouseHover`, which misidentifies the event whenever there is no hover
   * callback at all, and whenever the same function is passed as both.
   */
  hover?: boolean;
}

// Tile and context interfaces
export interface TileContext {
  id: string;
  canvas: HTMLCanvasElement;
  zoom: number;
  /** Tile edge length in CSS pixels. The backing store is this times `pixelRatio`. */
  tileSize: number;
  /**
   * Backing-store scale the canvas was created at. Absent means 1:1, which is
   * how a tile context built outside the library is treated.
   */
  pixelRatio?: number;
  parentId?: string;
  vectorTile?: VectorTile;
}

export interface TileFeatureData {
  vectorTileFeature: VectorTileFeature;
  divisor: number;
  context2d: CanvasRenderingContext2D | null;
  paths2d: Path2D | null;
}

export interface CanvasAndFeatures {
  canvas: HTMLCanvasElement;
  features: any[]; // MVTFeature[] - using any to avoid circular dependency
}

// GeoJSON interfaces
export interface GeoJSONFeature {
  type: 'Feature';
  id?: string | number;
  properties: Record<string, any>;
  geometry: {
    type: 'Point' | 'LineString' | 'Polygon' | 'MultiPoint' | 'MultiLineString' | 'MultiPolygon';
    coordinates: any[];
  };
}

export interface FeatureReplacementFunction {
  (feature: VectorTileFeature, featureId: string | number): Promise<GeoJSONFeature | null> | GeoJSONFeature | null;
}

export interface FeatureSelectionCallback {
  (featureId: string | number, featureData: any, selected: boolean): void;
}

// Event callback types
export type ClickEventCallback = (event: MVTMouseEvent) => void;
export type HoverEventCallback = (event: MVTMouseEvent) => void;

// Tile availability manifest types
export interface TileManifest {
  [zoomLevel: string]: {
    [xCoordinate: string]: Array<[number, number]>; // [y_start, y_end] ranges
  };
}

export type TileAvailabilitySource = TileManifest | (() => Promise<TileManifest>) | (() => TileManifest);

// Configuration interfaces
export interface MVTSourceOptions {
  url: string;
  sourceMaxZoom?: number;
  debug?: boolean;
  getIDForLayerFeature?: (feature: VectorTileFeature) => string | number;
  defaultFeatureId?: string;
  visibleLayers?: string[];
  xhrHeaders?: Record<string, string>;
  clickableLayers?: string[];
  filter?: (feature: VectorTileFeature, tileContext: TileContext) => boolean;
  cache?: boolean;
  tileSize?: number;
  style?: FeatureStyle | FeatureStyleFunction;
  selectedFeatures?: (string | number)[];
  customDraw?: CustomDrawFunction;
  getReplacementFeature?: FeatureReplacementFunction;
  featureSelectionCallback?: FeatureSelectionCallback;

  // Tile availability manifest (optional)
  tileAvailabilityManifest?: TileAvailabilitySource;

  // Event handling configuration
  onClick?: ClickEventCallback;
  onMouseHover?: HoverEventCallback;

  // Selection behavior configuration
  multipleSelection?: boolean;
  toggleSelection?: boolean;
  setSelectedOnClick?: boolean;
  limitToFirstVisibleLayer?: boolean;
  hoverDelay?: number;

  // Rendering configuration
  /**
   * Ceiling on the backing-store scale used for tile canvases.
   *
   * Tiles render at `min(window.devicePixelRatio, maxPixelRatio)`. Raising it
   * above the default of 2 sharpens tiles on 3x and 4x phone screens at a
   * quadratic cost in memory; setting it to 1 restores the pre-1.0 behaviour
   * of rendering at CSS resolution.
   */
  maxPixelRatio?: number;

  /**
   * CSS cursor to show while the pointer is over a clickable feature.
   *
   * Defaults to `'pointer'`. Pass `false` to leave the cursor alone, which
   * also skips wiring the `mousemove` listener when no hover callback and no
   * hover styling are in use.
   */
  hoverCursor?: string | false;

  /**
   * Milliseconds to fade a tile in over once it first paints.
   *
   * Defaults to 150. Set to 0 to have tiles appear instantly, as before.
   */
  fadeInDuration?: number;
}

export interface MVTLayerOptions {
  getIDForLayerFeature: (feature: VectorTileFeature) => string | number;
  filter: ((feature: VectorTileFeature, tileContext: TileContext) => boolean) | false;
  style: FeatureStyle | FeatureStyleFunction;
  name: string;
  customDraw: CustomDrawFunction | false;
}

export interface MVTFeatureOptions {
  mVTSource: any; // MVTSource - using any to avoid circular dependency
  vectorTileFeature: VectorTileFeature;
  tileContext: TileContext;
  style: FeatureStyle;
  selected: boolean;
  featureId: string | number;
  customDraw: CustomDrawFunction | false;
}

// Function types
export type CustomDrawFunction = (
  tileContext: TileContext,
  tile: TileFeatureData,
  style: FeatureStyle,
  feature: any, // MVTFeature - using any to avoid circular dependency
) => void;

export type FilterFunction = (feature: VectorTileFeature, tileContext: TileContext) => boolean;

export type IDExtractorFunction = (feature: VectorTileFeature) => string | number;

// Forward declarations for circular dependencies
// Using any to avoid circular dependency issues - the actual classes will provide type safety
export interface IMVTSource {
  map: google.maps.Map;
  isFeatureSelected(featureId: string | number): boolean;
  getTileObject(id: string): TileCoord;
  deleteTileDrawn(id: string): void;
  redrawTile(id: string): void;
  getSelectedFeaturesInTile(tileContextId: string): any[];
  dispose(): void;
}

export interface IMVTFeature {
  mVTSource: any;
  selected: boolean;
  featureId: string | number;
  tiles: Record<string, TileFeatureData>;
  style: FeatureStyle;
  type: number;
  properties: Record<string, any>;

  addTileFeature(vectorTileFeature: VectorTileFeature, tileContext: TileContext): void;
  getTiles(): Record<string, TileFeatureData>;
  getTile(tileContext: TileContext): TileFeatureData;
  setStyle(style: FeatureStyle): void;
  toggle(): void;
  select(): void;
  deselect(): void;
  setSelected(selected: boolean): void;
  draw(tileContext: TileContext): void;
  getPaths(tileContext: TileContext): Point[][];
  isPointInPath(point: Point, tileContext: TileContext): boolean;
}

export interface IMVTLayer {
  name: string;
  parseVectorTileFeatures(mVTSource: any, vectorTileFeatures: VectorTileFeature[], tileContext: TileContext): void;
  handleClickEvent(event: MVTMouseEvent, mVTSource: any): MVTMouseEvent;
  setStyle(style: FeatureStyle | FeatureStyleFunction): void;
  setSelected(featureId: string | number): void;
  setFilter(filter: FilterFunction | false): void;
}

// Geometry type constants
export enum GeometryType {
  Point = 1,
  LineString = 2,
  Polygon = 3,
}
