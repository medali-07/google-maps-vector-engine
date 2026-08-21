import { VectorTileFeature } from '@mapbox/vector-tile';
import { FeatureStyle, FeatureStyleFunction, GeometryType } from '../types';

/** Default palette used when no style is supplied. */
export const DEFAULT_COLORS = {
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
  DEBUG_TEXT: '#000000',
} as const;

/** Feature state the resolver needs in order to pick a style. */
export interface FeatureStateLookup {
  isSelected(featureId: string | number): boolean;
  isHovered(featureId: string | number): boolean;
  /** Feature count, used to decide whether caching is worth its overhead. */
  featureCount(): number;
}

/**
 * Resolves the effective style for a feature, merging selection and hover
 * state over the base style, with a bounded cache.
 *
 * Extracted from MVTSource so the merge precedence and cache-keying can be
 * tested without a map.
 */
export class StyleResolver {
  private static readonly MAX_CACHE_SIZE = 1000;

  private _cache: Map<string, FeatureStyle> = new Map();
  private _cacheVersion = 0;

  constructor(
    public style: FeatureStyle | FeatureStyleFunction,
    private _state: FeatureStateLookup,
  ) {}

  setStyle(style: FeatureStyle | FeatureStyleFunction): void {
    this.style = style;
    this.invalidate();
  }

  invalidate(): void {
    this._cacheVersion++;
    this._cache.clear();
  }

  clear(): void {
    this._cache.clear();
  }

  get size(): number {
    return this._cache.size;
  }

  /**
   * Style a feature should be drawn with, given its current state.
   */
  resolve(feature: VectorTileFeature, featureId: string | number): FeatureStyle {
    const isSelected = this._state.isSelected(featureId);
    const isHovered = this._state.isHovered(featureId);
    const baseStyle = typeof this.style === 'function' ? this.style(feature) : this.style;

    // Fast path: static style with no state changes
    if (typeof this.style !== 'function' && !isSelected && !isHovered) {
      return baseStyle;
    }

    // Only worth caching under load, or when a user function is involved.
    const shouldUseCache = typeof this.style === 'function' || this._state.featureCount() > 100;

    if (shouldUseCache) {
      const cacheKey = this._cacheKey(feature, featureId, isSelected, isHovered);
      const cachedStyle = this._cache.get(cacheKey);
      if (cachedStyle) {
        return cachedStyle;
      }
    }

    let resultStyle = { ...baseStyle };
    delete resultStyle.selected;
    delete resultStyle.hover;

    if (isSelected && baseStyle.selected) {
      resultStyle = { ...resultStyle, ...baseStyle.selected };
    } else if (isHovered && baseStyle.hover) {
      resultStyle = { ...resultStyle, ...baseStyle.hover };
    } else if (isSelected && !baseStyle.selected) {
      const computedSelectedStyle = StyleResolver.selectedStyleFor(feature);
      resultStyle = {
        ...resultStyle,
        ...(!resultStyle.fillStyle || resultStyle.fillStyle === 'transparent'
          ? { fillStyle: computedSelectedStyle.fillStyle }
          : {}),
        ...(!resultStyle.strokeStyle ? { strokeStyle: computedSelectedStyle.strokeStyle } : {}),
        ...(!resultStyle.lineWidth ? { lineWidth: computedSelectedStyle.lineWidth } : {}),
      };
    } else if (isHovered && !baseStyle.hover) {
      if (resultStyle.fillStyle && !resultStyle.fillStyle.includes('rgba(')) {
        const hoverFill = resultStyle.fillStyle.replace('0.3', '0.5').replace('0.4', '0.6');
        if (hoverFill !== resultStyle.fillStyle) {
          resultStyle.fillStyle = hoverFill;
        }
      }
    }

    if (shouldUseCache) {
      this._evictIfFull();
      this._cache.set(this._cacheKey(feature, featureId, isSelected, isHovered), resultStyle);
    }

    return resultStyle;
  }

  /**
   * Default style for a feature that has no user style.
   */
  static defaultStyleFor(feature: VectorTileFeature): FeatureStyle {
    const style: FeatureStyle = {};

    switch (feature.type) {
      case GeometryType.Point:
        style.fillStyle = DEFAULT_COLORS.POINT_FILL;
        style.radius = 5;
        break;
      case GeometryType.LineString:
        style.strokeStyle = DEFAULT_COLORS.LINE_STROKE;
        style.lineWidth = 3;
        break;
      case GeometryType.Polygon:
        style.fillStyle = DEFAULT_COLORS.POLYGON_FILL;
        style.strokeStyle = DEFAULT_COLORS.POLYGON_STROKE;
        style.lineWidth = 1;
        break;
    }

    return style;
  }

  /**
   * Fallback highlight for a selected feature whose style declares none.
   */
  static selectedStyleFor(feature: VectorTileFeature): FeatureStyle {
    switch (feature.type) {
      case GeometryType.Point:
        return {
          fillStyle: DEFAULT_COLORS.SELECTED_POINT,
          radius: 7,
        };
      case GeometryType.LineString:
        return {
          strokeStyle: DEFAULT_COLORS.SELECTED_LINE,
          lineWidth: 5,
        };
      case GeometryType.Polygon:
        return {
          fillStyle: DEFAULT_COLORS.SELECTED_POLYGON_FILL,
          strokeStyle: DEFAULT_COLORS.SELECTED_POLYGON_STROKE,
          lineWidth: 3,
        };
      default:
        return {};
    }
  }

  private _cacheKey(
    feature: VectorTileFeature,
    featureId: string | number,
    isSelected: boolean,
    isHovered: boolean,
  ): string {
    const state = (isSelected ? 'S' : '') + (isHovered ? 'H' : '');
    return `${this._cacheVersion}:${featureId}:${StyleResolver._featureHash(feature)}:${state}`;
  }

  // NOTE: hashes only a fixed property whitelist, so two features that differ
  // solely in a property outside this list collide and share a style. Tracked
  // in PLAN.md for Phase 3; kept as-is here to preserve Phase 2 behaviour.
  private static _featureHash(feature: VectorTileFeature): string {
    const props = feature.properties || {};
    const keyProps = [
      'type',
      'category',
      'class',
      'subtype',
      'importance',
      'level',
      'land_use',
      'population_density',
      'area',
      'length',
    ];

    let hash = `t${feature.type}`;
    for (const prop of keyProps) {
      if (props[prop] !== undefined) {
        hash += `_${prop}:${props[prop]}`;
      }
    }
    return hash;
  }

  private _evictIfFull(): void {
    if (this._cache.size >= StyleResolver.MAX_CACHE_SIZE) {
      const entries = Array.from(this._cache.entries());
      const keepCount = Math.floor(StyleResolver.MAX_CACHE_SIZE * 0.7);

      this._cache.clear();
      entries.slice(-keepCount).forEach(([key, value]) => {
        this._cache.set(key, value);
      });
    }
  }
}
