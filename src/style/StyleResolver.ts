import { VectorTileFeature } from '@mapbox/vector-tile';
import { ColorUtils } from '../ColorUtils';
import { FeatureStyle, FeatureStyleFunction, GeometryType, StyleContext } from '../types';

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

  /** Fill alpha multiplier applied by the fallback hover treatment. */
  static readonly HOVER_ALPHA_FACTOR = 1.5;

  /** Extra outline width applied by the fallback hover treatment, in CSS px. */
  static readonly HOVER_LINE_WIDTH_BOOST = 1;

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
   *
   * @param context Zoom and tile the feature is being drawn for, passed
   *                through to a style function so it can vary by zoom.
   */
  resolve(feature: VectorTileFeature, featureId: string | number, context?: StyleContext): FeatureStyle {
    const isSelected = this._state.isSelected(featureId);
    const isHovered = this._state.isHovered(featureId);
    const baseStyle = typeof this.style === 'function' ? this.style(feature, context) : this.style;

    // Fast path: static style with no state changes
    if (typeof this.style !== 'function' && !isSelected && !isHovered) {
      return baseStyle;
    }

    // Only worth caching under load, or when a user function is involved.
    const shouldUseCache = typeof this.style === 'function' || this._state.featureCount() > 100;
    const cacheKey = shouldUseCache ? this._cacheKey(feature, featureId, isSelected, isHovered, context) : '';

    if (shouldUseCache) {
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
      resultStyle = { ...resultStyle, ...StyleResolver.hoverStyleFor(resultStyle) };
    }

    if (shouldUseCache) {
      this._evictIfFull();
      this._cache.set(cacheKey, resultStyle);
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

  /**
   * Fallback hover treatment for a feature whose style declares no `hover`.
   *
   * Lifts the fill's alpha and thickens the outline. The width change matters:
   * signalling hover by colour alone disappears under monochromacy and under
   * most colour-vision deficiencies, so the emphasis has to be carried by
   * something other than hue as well.
   *
   * The previous implementation did a literal `"0.3"` to `"0.5"` string
   * replacement on the colour, and only when the colour did *not* start with
   * `rgba(` - which is every default this library ships, so it never once ran.
   */
  static hoverStyleFor(style: FeatureStyle): FeatureStyle {
    const hover: FeatureStyle = {};

    if (style.fillStyle) {
      const lifted = ColorUtils.scaleAlpha(style.fillStyle, StyleResolver.HOVER_ALPHA_FACTOR);
      if (lifted !== style.fillStyle) {
        hover.fillStyle = lifted;
      }
    }

    hover.lineWidth = (style.lineWidth ?? 1) + StyleResolver.HOVER_LINE_WIDTH_BOOST;

    return hover;
  }

  private _cacheKey(
    feature: VectorTileFeature,
    featureId: string | number,
    isSelected: boolean,
    isHovered: boolean,
    context?: StyleContext,
  ): string {
    const state = (isSelected ? 'S' : '') + (isHovered ? 'H' : '');
    const zoom = context ? context.zoom : '';
    return `${this._cacheVersion}:${zoom}:${featureId}:${StyleResolver._featureHash(feature)}:${state}`;
  }

  /**
   * Identity hash for a feature's properties, memoized per feature object.
   *
   * This used to hash a fixed ten-property whitelist, so any two features
   * differing only outside that list produced the same key and were served
   * each other's style. That bites whenever the id extractor maps several
   * features to one id - including the default, where every feature without a
   * `fid` property shares the fallback id.
   *
   * Hashing every property is correct but costs a sort and a walk, so the
   * result is cached against the feature object itself. Decoded features are
   * stable for the lifetime of a parsed tile, and a WeakMap keeps this from
   * pinning them once the tile is released.
   */
  private static _hashCache = new WeakMap<object, string>();

  private static _featureHash(feature: VectorTileFeature): string {
    const key = feature as unknown as object;
    const cached = StyleResolver._hashCache.get(key);
    if (cached !== undefined) return cached;

    const props = feature.properties || {};
    const names = Object.keys(props).sort();

    let hash = `t${feature.type}`;
    for (const name of names) {
      hash += `|${name}=${String(props[name])}`;
    }

    StyleResolver._hashCache.set(key, hash);
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
