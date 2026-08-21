import { VectorTile, VectorTileFeature } from '@mapbox/vector-tile';
// Type-only imports. These are erased at compile time, so referring to the
// classes here creates no runtime cycle - which is what the `any` placeholders
// throughout this file were working around.
import type { MVTFeature } from './MVTFeature';
import type { MVTSource } from './MVTSource';

/**
 * Properties decoded from a vector tile feature.
 *
 * The MVT spec allows string, number and boolean values. Declare your own
 * shape and pass it as the type argument to `MVTSource` to get it back,
 * typed, on every feature the API hands you:
 *
 * ```ts
 * const source = new MVTSource<{ name: string; population: number }>(map, opts);
 * source.on('selectionchange', () => {
 *   source.getSelectedFeatures()[0]?.properties.name; // string
 * });
 * ```
 */
export type FeatureProperties = Record<string, unknown>;

/*
 * Note on the type parameter: `TProps` is constrained to `object`, not to
 * `FeatureProperties`. Constraining it to `Record<string, unknown>` would
 * force every caller to give their interface an index signature - and an index
 * signature permits *any* key, so `feature.properties.nmae` would type-check.
 * A plain interface gives exact checking, which is the point of declaring one.
 */

/**
 * Apply the caller's declared property shape to a decoded property bag.
 *
 * This is the decode boundary. A PBF hands back an untyped map of values, and
 * the type argument on `MVTSource` is the caller's assertion about what is in
 * it - something the library cannot verify and should not pretend to. Every
 * cast of that kind funnels through here, so there is exactly one place to
 * look when asking where the type system stops being load-bearing.
 */
export function asFeatureProperties<TProps extends object>(properties: unknown): TProps {
  return (properties ?? {}) as TProps;
}

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
export interface MVTMouseEvent<TProps extends object = FeatureProperties> {
  latLng: google.maps.LatLng;
  pixel: google.maps.Point;
  tileContext?: TileContext;
  tilePoint?: Point;
  /** Feature under the pointer, absent when the pointer hit empty space. */
  feature?: MVTFeature<TProps>;
  /** True when this event changed the selection. */
  selectionChanged?: boolean;
  /** Selection state of `feature` once this event had been applied. */
  isSelected?: boolean;
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

export interface CanvasAndFeatures<TProps extends object = FeatureProperties> {
  canvas: HTMLCanvasElement;
  features: MVTFeature<TProps>[];
}

// GeoJSON interfaces
/**
 * A GeoJSON position: `[longitude, latitude]`, optionally with elevation.
 *
 * Typed as `number[]` rather than a fixed tuple because the polygon merger
 * builds coordinates by mapping over decoded rings, which TypeScript widens to
 * `number[]`. Narrowing it here would only be reachable through a cast, and a
 * cast that the internals cannot actually honour is worse than an honest type.
 */
export type GeoJSONPosition = number[];

/**
 * Nested coordinate array, whose depth depends on the geometry type: a
 * position for Point, positions for LineString and MultiPoint, and one level
 * deeper again for Polygon and MultiPolygon.
 */
export type GeoJSONCoordinates = GeoJSONPosition | GeoJSONPosition[] | GeoJSONPosition[][] | GeoJSONPosition[][][];

export interface GeoJSONFeature<TProps extends object = FeatureProperties> {
  type: 'Feature';
  id?: string | number;
  properties: TProps;
  geometry: {
    type: 'Point' | 'LineString' | 'Polygon' | 'MultiPoint' | 'MultiLineString' | 'MultiPolygon';
    coordinates: GeoJSONCoordinates;
  };
}

export interface FeatureReplacementFunction<TProps extends object = FeatureProperties> {
  (
    feature: VectorTileFeature,
    featureId: string | number,
  ): Promise<GeoJSONFeature<TProps> | null> | GeoJSONFeature<TProps> | null;
}

export interface FeatureSelectionCallback<TProps extends object = FeatureProperties> {
  /**
   * @param featureData The feature as GeoJSON - the replacement returned by
   *   `getReplacementFeature`, the rings merged across tiles, or a minimal
   *   stub carrying the original properties when neither is available.
   */
  (featureId: string | number, featureData: GeoJSONFeature<TProps>, selected: boolean): void;
}

/**
 * The subset of options that constructor validation looks at.
 *
 * Only the keys that carry no type parameter, so validation stays free of the
 * variance that comes with `TProps`.
 */
export type ValidatableOptions = Pick<
  MVTSourceOptions,
  'url' | 'tileSize' | 'maxPixelRatio' | 'minZoom' | 'maxZoom' | 'style'
>;

/** Snapshot of a source's current workload, from `MVTSource.getStats()`. */
export interface MVTSourceStats {
  /** Tiles currently mounted by Google Maps. */
  visibleTiles: number;
  /** Decoded tiles held in the cache. */
  cachedTiles: number;
  /** Tiles that have settled, successfully or not. */
  loadedTiles: number;
  /** Tile requests still in flight. */
  pendingRequests: number;
  layers: number;
  features: number;
  selectedFeatures: number;
  hoveredFeatures: number;
  /** Backing-store scale tiles are being rendered at. */
  pixelRatio: number;
  debug: boolean;
  disposed: boolean;
}

/** How `setSelection` should combine its ids with the current selection. */
export interface SelectionOptions {
  /**
   * `replace` (the default) selects exactly the given ids, `add` unions them
   * into the current selection, and `remove` subtracts them.
   */
  mode?: 'replace' | 'add' | 'remove';
}

/**
 * Events an `MVTSource` emits, and the payload each carries.
 *
 * Subscribe with `source.on('tileerror', ...)`. Constructor callbacks
 * (`onClick`, `onMouseHover`) still work and are equivalent to registering a
 * single `click` / `hover` listener, but only `on`/`off`/`once` let you add a
 * second listener, remove one, or change one after construction.
 */
export interface MVTSourceEvents<TProps extends object = FeatureProperties> {
  /** A tile finished decoding and drawing. */
  tileload: { tileId: string; tileContext: TileContext };
  /** A tile failed to load. `status` is absent for network and abort errors. */
  tileerror: { tileId: string; status?: number; error?: unknown };
  /** Every tile visible at the time of the first load has settled. */
  load: void;
  /** Every currently visible tile has settled; fires again after each change. */
  idle: void;
  /** The set of selected feature ids changed. */
  selectionchange: { selected: (string | number)[]; added: (string | number)[]; removed: (string | number)[] };
  /** The pointer was clicked over the source. */
  click: MVTMouseEvent<TProps>;
  /** The pointer moved over the source. */
  hover: MVTMouseEvent<TProps>;
}

// Event callback types
export type ClickEventCallback<TProps extends object = FeatureProperties> = (event: MVTMouseEvent<TProps>) => void;
export type HoverEventCallback<TProps extends object = FeatureProperties> = (event: MVTMouseEvent<TProps>) => void;

// Tile availability manifest types
export interface TileManifest {
  [zoomLevel: string]: {
    [xCoordinate: string]: Array<[number, number]>; // [y_start, y_end] ranges
  };
}

export type TileAvailabilitySource = TileManifest | (() => Promise<TileManifest>) | (() => TileManifest);

// Configuration interfaces
export interface MVTSourceOptions<TProps extends object = FeatureProperties> {
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

  /**
   * Lowest zoom at which Google Maps will request tiles from this source.
   *
   * Defaults to 0. Until 1.0 this was hardcoded to 6 and was not an option, so
   * the library rendered nothing at all below zoom 6 with no way to change it
   * and nothing in the docs saying so.
   */
  minZoom?: number;

  /**
   * Highest zoom at which Google Maps will request tiles.
   *
   * Defaults to 22, the Google Maps maximum. This is deliberately *not*
   * `sourceMaxZoom`: setting it to the source's own maximum makes Google Maps
   * stop asking for tiles there, which left the overzoom path unreachable and
   * defeated the point of `sourceMaxZoom`. Use `sourceMaxZoom` to say how deep
   * your tiles go, and this only if you want rendering to stop entirely.
   */
  maxZoom?: number;
  style?: FeatureStyle | FeatureStyleFunction;
  selectedFeatures?: (string | number)[];
  customDraw?: CustomDrawFunction<TProps>;
  getReplacementFeature?: FeatureReplacementFunction<TProps>;
  featureSelectionCallback?: FeatureSelectionCallback<TProps>;

  // Tile availability manifest (optional)
  tileAvailabilityManifest?: TileAvailabilitySource;

  // Event handling configuration
  onClick?: ClickEventCallback<TProps>;
  onMouseHover?: HoverEventCallback<TProps>;

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

export interface MVTLayerOptions<TProps extends object = FeatureProperties> {
  getIDForLayerFeature: (feature: VectorTileFeature) => string | number;
  filter: FilterFunction | false;
  style: FeatureStyle | FeatureStyleFunction;
  name: string;
  customDraw: CustomDrawFunction<TProps> | false;
}

export interface MVTFeatureOptions<TProps extends object = FeatureProperties> {
  mVTSource: MVTSource<TProps>;
  vectorTileFeature: VectorTileFeature;
  tileContext: TileContext;
  style: FeatureStyle;
  selected: boolean;
  featureId: string | number;
  customDraw: CustomDrawFunction<TProps> | false;
}

// Function types
export type CustomDrawFunction<TProps extends object = FeatureProperties> = (
  tileContext: TileContext,
  tile: TileFeatureData,
  style: FeatureStyle,
  feature: MVTFeature<TProps>,
) => void;

export type FilterFunction = (feature: VectorTileFeature, tileContext: TileContext) => boolean;

export type IDExtractorFunction = (feature: VectorTileFeature) => string | number;

// Geometry type constants
export enum GeometryType {
  Point = 1,
  LineString = 2,
  Polygon = 3,
}
