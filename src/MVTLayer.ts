import { VectorTileFeature } from '@mapbox/vector-tile';
import { MVTFeature } from './MVTFeature';
import { Mercator } from './Mercator';
import { createLogger } from './DebugLogger';
import {
  MVTLayerOptions,
  TileContext,
  MVTMouseEvent,
  CanvasAndFeatures,
  FeatureStyle,
  FeatureStyleFunction,
  FilterFunction,
  GeometryType
} from './types';

/**
 * MVTLayer - Manages individual vector tile layers and their features
 * Part of google-maps-vector-engine
 * 
 * Handles feature parsing, rendering, and interaction logic for a single layer
 * with proper z-ordering and efficient click detection.
 */
export class MVTLayer {
  public name: string;
  public style: FeatureStyle | FeatureStyleFunction;
  
  private _lineClickTolerance = 2;
  private _getIDForLayerFeature: (feature: VectorTileFeature) => string | number;
  private _filter: FilterFunction | false;
  private _customDraw: ((tileContext: TileContext, tile: any, style: FeatureStyle, feature: any) => void) | false;
  private _canvasAndMVTFeatures: Record<string, CanvasAndFeatures> = {};
  private _mVTFeatures: Record<string | number, MVTFeature> = {};
  private selectedFeature: MVTFeature | null = null;
  private minDistance: number = Number.POSITIVE_INFINITY;
  private logger = createLogger('MVTLayer');

  constructor(options: MVTLayerOptions) {
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
    tileContext: TileContext
  ): void {
    this._canvasAndMVTFeatures[tileContext.id] = {
      canvas: tileContext.canvas,
      features: []
    };

    if (!vectorTileFeatures || !Array.isArray(vectorTileFeatures)) {
      this.logger.warn('No vector tile features found for layer:', this.name);
      this.drawTile(tileContext);
      return;
    }

    const features: MVTFeature[] = [];
    
    for (let i = 0; i < vectorTileFeatures.length; i++) {
      const vectorTileFeature = vectorTileFeatures[i];
      const feature = this._parseVectorTileFeature(mVTSource, vectorTileFeature, tileContext, i);
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
    index: number
  ): MVTFeature | null {
    if (this._filter && typeof this._filter === 'function') {
      if (this._filter(vectorTileFeature, tileContext) === false) {
        return null;
      }
    }

    const featureId = this._getIDForLayerFeature(vectorTileFeature) || index;
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
        customDraw: this._customDraw
      };
      
      mVTFeature = new MVTFeature(options);
      mVTFeature.hovered = shouldBeHovered;
      this._mVTFeatures[featureId] = mVTFeature;
    } else {
      const baseStyle = this._getFeatureStyle(vectorTileFeature);
      mVTFeature.setStyle(baseStyle);
      mVTFeature.addTileFeature(vectorTileFeature, tileContext);
      
      if (mVTFeature.selected !== shouldBeSelected) {
        mVTFeature.setSelected(shouldBeSelected);
      }
      if (mVTFeature.hovered !== shouldBeHovered) {
        mVTFeature.hovered = shouldBeHovered;
      }
    }

    return mVTFeature;
  }

  /**
   * Draw all features in this tile with proper z-ordering
   */
  drawTile(tileContext: TileContext): void {
    const mVTFeatures = this._canvasAndMVTFeatures[tileContext.id]?.features;
    if (!mVTFeatures || mVTFeatures.length === 0) return;

    const regularFeatures: MVTFeature[] = [];
    const hoveredFeatures: MVTFeature[] = [];
    const selectedFeatures: MVTFeature[] = [];

    for (const feature of mVTFeatures) {
      if (feature.selected) {
        selectedFeatures.push(feature);
      } else if (feature.hovered) {
        hoveredFeatures.push(feature);
      } else {
        regularFeatures.push(feature);
      }
    }

    [...regularFeatures, ...hoveredFeatures, ...selectedFeatures].forEach(feature => {
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
    
    Object.values(this._mVTFeatures).forEach(mVTFeature => {
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
  handleClickEvent(event: MVTMouseEvent, mVTSource: any): MVTMouseEvent {
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
    event: MVTMouseEvent, 
    mVTFeatures: MVTFeature[], 
    _mVTSource: any
  ): MVTFeature | undefined {
    this.selectedFeature = null;
    this.minDistance = Number.POSITIVE_INFINITY;
    
    const selectedFeatures = mVTFeatures.filter(f => f.selected);
    if (selectedFeatures.length > 0) {
      this._checkFeaturesForClick(event, selectedFeatures);
      if (this.selectedFeature) {
        return this.selectedFeature;
      }
    }

    this._checkFeaturesForClick(event, mVTFeatures);
    return this.selectedFeature || undefined;
  }

  /**
   * Check features for click collision detection
   */
  private _checkFeaturesForClick(event: MVTMouseEvent, features: MVTFeature[]): void {
    for (let i = features.length - 1; i >= 0; i--) {
      const feature = features[i];
      
      if (this._isFeatureClicked(event, feature)) {
        this.selectedFeature = feature;
        if (this.minDistance === 0) {
          return;
        }
      }
    }
  }

  /**
   * Check if specific feature is clicked
   */
  private _isFeatureClicked(event: MVTMouseEvent, feature: MVTFeature): boolean {
    switch (feature.type) {
      case GeometryType.Polygon:
        return this._checkPolygonClick(event, feature);
      case GeometryType.Point:
        return this._checkPointClick(event, feature);
      case GeometryType.LineString:
        return this._checkLineClick(event, feature);
      default:
        return false;
    }
  }

  /**
   * Check polygon click using isPointInPath
   */
  private _checkPolygonClick(event: MVTMouseEvent, feature: MVTFeature): boolean {
    if (feature.isPointInPath(event.tilePoint!, event.tileContext!)) {
      this.minDistance = 0;
      return true;
    }
    return false;
  }

  /**
   * Check point click with radius
   */
  private _checkPointClick(event: MVTMouseEvent, feature: MVTFeature): boolean {
    const paths = feature.getPaths(event.tileContext!);
    
    for (const path of paths) {
      if (path.length > 0) {
        const point = path[0];
        const radius = feature.style.radius || 3;
        
        if (Mercator.inCircle(point.x, point.y, radius, event.tilePoint!.x, event.tilePoint!.y)) {
          this.minDistance = 0;
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check line click with tolerance
   */
  private _checkLineClick(event: MVTMouseEvent, feature: MVTFeature): boolean {
    const paths = feature.getPaths(event.tileContext!);
    
    for (const path of paths) {
      const distance = Mercator.getDistanceFromLine(event.tilePoint!, path);
      const lineWidth = feature.style.lineWidth || 1;
      const tolerance = lineWidth / 2 + this._lineClickTolerance;
      
      if (distance < tolerance && distance < this.minDistance) {
        this.minDistance = distance;
        return true;
      }
    }
    
    return false;
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
  getFeature(featureId: string | number): MVTFeature | undefined {
    return this._mVTFeatures[featureId];
  }

  /**
   * Get all features in this layer
   */
  getAllFeatures(): MVTFeature[] {
    return Object.values(this._mVTFeatures);
  }

  /**
   * Cleanup method for layer disposal
   */
  dispose(): void {
    // Clear all features
    Object.values(this._mVTFeatures).forEach(feature => {
      feature.dispose();
    });
    
    this._mVTFeatures = {};
    this._canvasAndMVTFeatures = {};
  }
}

