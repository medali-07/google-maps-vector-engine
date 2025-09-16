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

export interface FeatureStyleFunction {
  (feature: VectorTileFeature): FeatureStyle;
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
}

// Tile and context interfaces
export interface TileContext {
  id: string;
  canvas: HTMLCanvasElement;
  zoom: number;
  tileSize: number;
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
