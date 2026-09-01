import { VectorTileFeature } from '@mapbox/vector-tile';
import { MVTFeature } from './MVTFeature';
import { Mercator } from './Mercator';
import { createLogger } from './DebugLogger';
import {
  MVTLayerOptions,
  TileContext,
  MVTMouseEvent,
  CanvasAndFeatures,
  FeatureProperties,
  FeatureStyle,
  FeatureStyleFunction,
  FilterFunction,
  GeometryType,
} from './types';

/**
 * MVTLayer - Manages individual vector tile layers and their features
 * Part of google-maps-vector-engine
 *
 * Handles feature parsing, rendering, and interaction logic for a single layer
 * with proper z-ordering and efficient click detection.
 */
/** Per-pass hit-test accumulator. Kept out of the class so two overlapping
 *  hit tests - hover and click - cannot read each other's partial state. */
interface HitTestState<TProps extends object = FeatureProperties> {
  feature: MVTFeature<TProps> | null;
  minDistance: number;
}

export class MVTLayer<TProps extends object = FeatureProperties> {
  public name: string;
  public style: FeatureStyle | FeatureStyleFunction;

  private _lineClickTolerance = 2;
  private _getIDForLayerFeature: (feature: VectorTileFeature) => string | number;
  private _filter: FilterFunction | false;
  private _customDraw: ((tileContext: TileContext, tile: any, style: FeatureStyle, feature: any) => void) | false;
  private _canvasAndMVTFeatures: Record<string, CanvasAndFeatures<TProps>> = {};
  private _mVTFeatures: Record<string | number, MVTFeature<TProps>> = {};
  private logger = createLogger('MVTLayer');

  constructor(options: MVTLayerOptions<TProps>) {
    this._getIDForLayerFeature = options.getIDForLayerFeature;
    this.style = options.style;
    this.name = options.name;
    this._filter = options.filter || false;
    this._customDraw = options.customDraw || false;
  }

  /**
   * Parse vector tile features for this layer
   */
  parseVectorTileFeatures(
    mVTSource: any, // MVTSource
    vectorTileFeatures: VectorTileFeature[],
    tileContext: TileContext,
  ): void {
    this._canvasAndMVTFeatures[tileContext.id] = {
      canvas: tileContext.canvas,
      features: [],
    };

    if (!vectorTileFeatures || !Array.isArray(vectorTileFeatures)) {
      this.logger.warn('No vector tile features found for layer:', this.name);
      this.drawTile(tileContext);
      return;
    }

    const features: MVTFeature<TProps>[] = [];

    // Ids already seen in this parse, so a second tile feature carrying the
    // same id registers as an additional part of the first rather than
    // overwriting it - tilers split one logical feature into several within a
    // tile (clipped rings, road segments).
    const seenThisParse = new Set<string | number>();

    for (let i = 0; i < vectorTileFeatures.length; i++) {
      const vectorTileFeature = vectorTileFeatures[i];
      const feature = this._parseVectorTileFeature(mVTSource, vectorTileFeature, tileContext, i, seenThisParse);
      if (feature) {
        features.push(feature);
      }
    }

    this._canvasAndMVTFeatures[tileContext.id].features = features;
    this.drawTile(tileContext);
  }

  /**
   * Parse a single vector tile feature
   */
  private _parseVectorTileFeature(
    mVTSource: any,
    vectorTileFeature: VectorTileFeature,
    tileContext: TileContext,
    index: number,
    seenThisParse: Set<string | number>,
  ): MVTFeature<TProps> | null {
    if (this._filter && typeof this._filter === 'function') {
      if (this._filter(vectorTileFeature, tileContext) === false) {
        return null;
      }
    }

    // `?? index` rather than `|| index`: 0 and '' are legitimate feature ids
    // (the MVT spec allows id 0), and the falsy fallback replaced them with a
    // tile-local index - a different identity in every tile the feature spans,
    // and one that can alias a real feature carrying that id.
    const featureId = this._getIDForLayerFeature(vectorTileFeature) ?? index;
    const isAdditionalPart = seenThisParse.has(featureId);
    seenThisParse.add(featureId);
    let mVTFeature = this._mVTFeatures[featureId];

    const shouldBeSelected = mVTSource.isFeatureSelected?.(featureId) || false;
    const shouldBeHovered = mVTSource.isFeatureHovered?.(featureId) || false;

    if (!mVTFeature) {
      const baseStyle = this._getFeatureStyle(vectorTileFeature);

      const options = {
        mVTSource,
        vectorTileFeature,
        tileContext,
        style: baseStyle,
        selected: shouldBeSelected,
        featureId,
        customDraw: this._customDraw,
      };

      mVTFeature = new MVTFeature<TProps>(options);
      mVTFeature.hovered = shouldBeHovered;
      this._mVTFeatures[featureId] = mVTFeature;
    } else {
      const baseStyle = this._getFeatureStyle(vectorTileFeature);
      mVTFeature.setStyle(baseStyle);
      mVTFeature.addTileFeature(vectorTileFeature, tileContext, isAdditionalPart);

      if (mVTFeature.selected !== shouldBeSelected) {
        mVTFeature.setSelected(shouldBeSelected);
      }
      if (mVTFeature.hovered !== shouldBeHovered) {
        mVTFeature.hovered = shouldBeHovered;
      }

      // An additional part joined an existing entry; the feature is already
      // in this parse's features array, so do not draw it twice.
      if (isAdditionalPart) return null;
    }

    return mVTFeature;
  }

  /**
   * Draw all features in this tile with proper z-ordering
   */
  drawTile(tileContext: TileContext): void {
    const mVTFeatures = this._canvasAndMVTFeatures[tileContext.id]?.features;
    if (!mVTFeatures || mVTFeatures.length === 0) return;

    const regularFeatures: MVTFeature<TProps>[] = [];
    const hoveredFeatures: MVTFeature<TProps>[] = [];
    const selectedFeatures: MVTFeature<TProps>[] = [];

    for (const feature of mVTFeatures) {
      if (feature.selected) {
        selectedFeatures.push(feature);
      } else if (feature.hovered) {
        hoveredFeatures.push(feature);
      } else {
        regularFeatures.push(feature);
      }
    }

    [...regularFeatures, ...hoveredFeatures, ...selectedFeatures].forEach((feature) => {
      feature.draw(tileContext);
    });
  }

  /**
   * Get computed style for a feature
   */
  private _getFeatureStyle(feature: VectorTileFeature): FeatureStyle {
    if (typeof this.style === 'function') {
      return this.style(feature);
    }
    return this.style as FeatureStyle;
  }

  /**
   * Update style for all features while preserving selection/hover state
   */
  setStyle(style: FeatureStyle | FeatureStyleFunction): void {
    this.style = style;

    Object.values(this._mVTFeatures).forEach((mVTFeature) => {
      const firstTileId = Object.keys(mVTFeature.tiles)[0];
      if (firstTileId && mVTFeature.tiles[firstTileId]) {
        const vectorTileFeature = mVTFeature.tiles[firstTileId].vectorTileFeature;
        const newStyle = this._getFeatureStyle(vectorTileFeature);

        const wasSelected = mVTFeature.selected;
        const wasHovered = mVTFeature.hovered;

        mVTFeature.setStyle(newStyle);

        mVTFeature.selected = wasSelected;
        mVTFeature.hovered = wasHovered;
      }
    });
  }

  /**
   * Select a feature by ID
   */
  setSelected(featureId: string | number): void {
    const feature = this._mVTFeatures[featureId];
    if (feature) {
      feature.select();
    }
  }

  /**
   * Set filter function for this layer
   */
  setFilter(filter: FilterFunction | false): void {
    this._filter = filter;
  }

  /**
   * Handle click events on features in this layer
   */
  handleClickEvent(event: MVTMouseEvent<TProps>, mVTSource: any): MVTMouseEvent<TProps> {
    const canvasAndFeatures = this._canvasAndMVTFeatures[event.tileContext!.id];
    if (!canvasAndFeatures) return event;

    const { features: mVTFeatures } = canvasAndFeatures;
    if (!mVTFeatures) return event;

    event.feature = this._findClickedFeature(event, mVTFeatures, mVTSource);
    return event;
  }

  /**
   * Find clicked feature with priority for selected features
   */
  private _findClickedFeature(
    event: MVTMouseEvent<TProps>,
    mVTFeatures: MVTFeature<TProps>[],
    _mVTSource: any,
  ): MVTFeature<TProps> | undefined {
    // `hit` and `minDistance` used to be instance fields. Hover ran through a
    // timer while click ran synchronously, so two hit tests could interleave
    // and read each other's partial state - one returning the other's feature,
    // or an exact hit being discarded because the other pass had already reset
    // minDistance. They are locals now, so each pass is self-contained.
    const hit: HitTestState<TProps> = { feature: null, minDistance: Number.POSITIVE_INFINITY };

    const selectedFeatures = mVTFeatures.filter((f) => f.selected);
    if (selectedFeatures.length > 0) {
      this._checkFeaturesForClick(event, selectedFeatures, hit);
      if (hit.feature) {
        return hit.feature;
      }
    }

    this._checkFeaturesForClick(event, mVTFeatures, hit);
    return hit.feature || undefined;
  }

  /**
   * Check features for click collision detection
   */
  private _checkFeaturesForClick(
    event: MVTMouseEvent<TProps>,
    features: MVTFeature<TProps>[],
    hit: HitTestState<TProps>,
  ): void {
    for (let i = features.length - 1; i >= 0; i--) {
      const feature = features[i];

      if (this._isFeatureClicked(event, feature, hit)) {
        hit.feature = feature;
        if (hit.minDistance === 0) {
          return;
        }
      }
    }
  }

  /**
   * Check if specific feature is clicked
   */
  private _isFeatureClicked(
    event: MVTMouseEvent<TProps>,
    feature: MVTFeature<TProps>,
    hit: HitTestState<TProps>,
  ): boolean {
    switch (feature.type) {
      case GeometryType.Polygon:
        return this._checkPolygonClick(event, feature, hit);
      case GeometryType.Point:
        return this._checkPointClick(event, feature, hit);
      case GeometryType.LineString:
        return this._checkLineClick(event, feature, hit);
      default:
        return false;
    }
  }

  /**
   * Check polygon click using isPointInPath
   */
  private _checkPolygonClick(
    event: MVTMouseEvent<TProps>,
    feature: MVTFeature<TProps>,
    hit: HitTestState<TProps>,
  ): boolean {
    if (feature.isPointInPath(event.tilePoint!, event.tileContext!)) {
      hit.minDistance = 0;
      return true;
    }
    return false;
  }

  /**
   * Check point click with radius
   */
  private _checkPointClick(
    event: MVTMouseEvent<TProps>,
    feature: MVTFeature<TProps>,
    hit: HitTestState<TProps>,
  ): boolean {
    const paths = feature.getPaths(event.tileContext!);

    for (const path of paths) {
      if (path.length > 0) {
        const point = path[0];
        const radius = feature.style.radius || 3;

        if (Mercator.inCircle(point.x, point.y, radius, event.tilePoint!.x, event.tilePoint!.y)) {
          hit.minDistance = 0;
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check line click with tolerance
   */
  private _checkLineClick(
    event: MVTMouseEvent<TProps>,
    feature: MVTFeature<TProps>,
    hit: HitTestState<TProps>,
  ): boolean {
    const paths = feature.getPaths(event.tileContext!);

    for (const path of paths) {
      const distance = Mercator.getDistanceFromLine(event.tilePoint!, path);
      const lineWidth = feature.style.lineWidth || 1;
      const tolerance = lineWidth / 2 + this._lineClickTolerance;

      if (distance < tolerance && distance < hit.minDistance) {
        hit.minDistance = distance;
        return true;
      }
    }

    return false;
  }

  /**
   * Release everything this layer holds for a tile.
   *
   * Drops the tile from every feature that spans it, and disposes features
   * that no longer appear in any tile. Returns true when the layer retains no
   * tiles at all, so the source can drop the layer itself.
   */
  releaseTile(tileId: string): boolean {
    const canvasAndFeatures = this._canvasAndMVTFeatures[tileId];
    delete this._canvasAndMVTFeatures[tileId];

    if (canvasAndFeatures) {
      for (const feature of canvasAndFeatures.features as MVTFeature<TProps>[]) {
        if (feature.removeTile(tileId) === 0) {
          // dispose() calls back into MVTSource.unregisterFeature, which
          // removes it from the source's feature index.
          feature.dispose();
          delete this._mVTFeatures[feature.featureId];
        }
      }
      canvasAndFeatures.features = [];
    }

    return Object.keys(this._canvasAndMVTFeatures).length === 0;
  }

  /**
   * Get canvas for a specific tile
   */
  getCanvas(id: string): HTMLCanvasElement | null {
    return this._canvasAndMVTFeatures[id]?.canvas || null;
  }

  /**
   * Get feature by ID
   */
  getFeature(featureId: string | number): MVTFeature<TProps> | undefined {
    return this._mVTFeatures[featureId];
  }

  /**
   * Get all features in this layer
   */
  getAllFeatures(): MVTFeature<TProps>[] {
    return Object.values(this._mVTFeatures);
  }

  /**
   * Cleanup method for layer disposal
   */
  dispose(): void {
    // Clear all features
    Object.values(this._mVTFeatures).forEach((feature) => {
      feature.dispose();
    });

    this._mVTFeatures = {};
    this._canvasAndMVTFeatures = {};
  }
}
