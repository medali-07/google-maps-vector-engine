/**
 * google-maps-vector-engine - High Performance Vector Tiles for Google Maps
 * 
 * Modern TypeScript implementation for efficient rendering of Mapbox Vector Tiles
 * with fast feature lookups, batched rendering, and comprehensive event handling.
 */

// Core classes
export { MVTSource } from './src/MVTSource';
export { MVTLayer } from './src/MVTLayer';
export { MVTFeature } from './src/MVTFeature';

// Import for internal use
import { MVTSource } from './src/MVTSource';

// Utilities
export { Mercator } from './src/Mercator';
export { ColorUtils } from './src/ColorUtils';
export { DebugLogger, debugLogger, createLogger } from './src/DebugLogger';

// Types
export type {
  // Core types
  Point,
  TileCoord,
  TileBounds,
  LatLng,
  
  // Style types
  FeatureStyle,
  FeatureStyleFunction,
  
  // Event types
  MVTMouseEvent,
  MouseEventOptions,
  
  // Configuration types
  MVTSourceOptions,
  MVTLayerOptions,
  MVTFeatureOptions,
  
  // Manifest types
  TileManifest,
  TileAvailabilitySource,
  
  // Function types
  CustomDrawFunction,
  FilterFunction,
  IDExtractorFunction
} from './src/types';

export { GeometryType } from './src/types';

/**
 * Create MVTSource with sensible defaults
 */
export function createMVTSource(map: google.maps.Map, url: string, options: Partial<import('./src/types').MVTSourceOptions> = {}) {
  return new MVTSource(map, {
    url,
    tileSize: 256,
    cache: true,
    debug: false,
    ...options
  });
}

/**
 * Default style presets
 */
export const DefaultStyles = {
  basic: (): import('./src/types').FeatureStyle => ({
    fillStyle: 'rgba(200, 200, 200, 0.5)',
    strokeStyle: 'rgba(100, 100, 100, 1)',
    lineWidth: 1,
    radius: 4,
  }),
  
  minimal: (): import('./src/types').FeatureStyle => ({
    fillStyle: 'rgba(150, 150, 150, 0.3)',
    strokeStyle: 'rgba(100, 100, 100, 0.8)',
    lineWidth: 1,
    radius: 3,
  }),
  
  highContrast: (): import('./src/types').FeatureStyle => ({
    fillStyle: 'rgba(0, 120, 255, 0.6)',
    strokeStyle: 'rgba(0, 80, 200, 1)',
    lineWidth: 2,
    radius: 5,
    selected: {
      fillStyle: 'rgba(255, 140, 0, 0.8)',
      strokeStyle: 'rgba(255, 100, 0, 1)',
      lineWidth: 3
    },
    hover: {
      fillStyle: 'rgba(0, 150, 255, 0.7)',
      lineWidth: 2
    }
  }),
  
  // Specialized styles for different geometry types
  selected: {
    polygon: (): import('./src/types').FeatureStyle => ({
      fillStyle: 'rgba(255, 140, 0, 0.7)',
      strokeStyle: 'rgba(255, 100, 0, 1)',
      lineWidth: 3
    }),
    
    point: (): import('./src/types').FeatureStyle => ({
      fillStyle: 'rgba(255, 140, 0, 0.9)',
      strokeStyle: 'rgba(255, 100, 0, 1)',
      lineWidth: 2,
      radius: 6
    }),
    
    line: (): import('./src/types').FeatureStyle => ({
      strokeStyle: 'rgba(255, 140, 0, 1)',
      lineWidth: 4
    })
  }
};

/**
 * Utilities for tile availability manifests
 */
export const ManifestUtils = {
  createManifestFetcher: (apiUrl: string, headers?: Record<string, string>) => {
    return async (): Promise<import('./src/types').TileManifest> => {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', ...headers }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch tile manifest: ${response.status} ${response.statusText}`);
      }
      
      return response.json();
    };
  },

  validateManifest: (manifest: any): manifest is import('./src/types').TileManifest => {
    if (!manifest || typeof manifest !== 'object') return false;
    
    for (const [zoomLevel, xCoords] of Object.entries(manifest)) {
      if (!/^\d+$/.test(zoomLevel) || !xCoords || typeof xCoords !== 'object') return false;
      
      for (const [xCoord, yRanges] of Object.entries(xCoords as any)) {
        if (!/^\d+$/.test(xCoord) || !Array.isArray(yRanges)) return false;
        
        for (const yRange of yRanges) {
          if (!Array.isArray(yRange) || yRange.length !== 2 || 
              typeof yRange[0] !== 'number' || typeof yRange[1] !== 'number') {
            return false;
          }
        }
      }
    }
    
    return true;
  }
};

/**
 * Common utility functions
 */
export const MVTUtils = {
  /**
   * Extract feature ID from a vector tile feature
   */
  extractFeatureId: (feature: import('@mapbox/vector-tile').VectorTileFeature, defaultProperty: string = 'fid'): string | number => {
    // Try feature.id first (most reliable)
    if (feature.id !== undefined && feature.id !== null) {
      return feature.id;
    }
    
    // Try the configured default property
    const defaultValue = feature.properties[defaultProperty];
    if (defaultValue !== undefined && defaultValue !== null && typeof defaultValue !== 'boolean') {
      return defaultValue;
    }
    
    // Try common ID properties
    const commonIdProps = ['id', 'objectid', 'fid', 'gid', 'uid'];
    for (const prop of commonIdProps) {
      const value = feature.properties[prop];
      if (value !== undefined && value !== null && typeof value !== 'boolean') {
        return value;
      }
    }
    
    // Last resort: generate a consistent hash from properties
    const propsStr = JSON.stringify(feature.properties);
    let hash = 0;
    for (let i = 0; i < propsStr.length; i++) {
      const char = propsStr.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `generated_${Math.abs(hash)}`;
  },
  
  /**
   * Create a property-based filter function
   */
  createPropertyFilter: (property: string, values: (string | number)[]) => {
    return (feature: import('@mapbox/vector-tile').VectorTileFeature) => {
      const value = feature.properties[property];
      return (typeof value === 'string' || typeof value === 'number') && values.includes(value);
    };
  },
  
  /**
   * Create a property-based style function
   */
  createPropertyBasedStyle: (property: string, styleMap: Record<string | number, import('./src/types').FeatureStyle>) => {
    return (feature: import('@mapbox/vector-tile').VectorTileFeature): import('./src/types').FeatureStyle => {
      const value = feature.properties[property];
      return (typeof value === 'string' || typeof value === 'number') 
        ? styleMap[value] || DefaultStyles.basic()
        : DefaultStyles.basic();
    };
  },
  
  /**
   * Performance monitoring utilities
   */
  performance: {
    /**
     * Get basic performance metrics from an MVT source
     */
    getMetrics: (mvtSource: any) => {
      const tiles = Object.keys(mvtSource.mVTLayers).length;
      const selectedFeatures = mvtSource.getSelectedFeatureIds?.().length || 0;
      return {
        tilesLoaded: mvtSource.loadedTilesLen || 0,
        layersVisible: tiles,
        featuresSelected: selectedFeatures,
        debugEnabled: mvtSource.options?.debug || false
      };
    },
    
    /**
     * Measure time taken for feature selection
     */
    measureSelectionTime: (mvtSource: any, featureIds: (string | number)[]) => {
      const start = performance.now();
      mvtSource.setSelectedFeatures?.(featureIds);
      const end = performance.now();
      return end - start;
    },
    
    /**
     * Benchmark feature lookup performance
     */
    benchmarkFeatureLookup: (mvtSource: any, sampleSize: number = 100) => {
      const selectedIds = mvtSource.getSelectedFeatureIds?.() || [];
      if (selectedIds.length === 0) return 0;
      
      const start = performance.now();
      for (let i = 0; i < sampleSize; i++) {
        const randomId = selectedIds[Math.floor(Math.random() * selectedIds.length)];
        mvtSource.getFeature?.(randomId);
      }
      const end = performance.now();
      return (end - start) / sampleSize; // Average time per lookup
    }
  }
};

/**
 * Factory functions for common configurations
 */
export const MVTFactory = {
  /**
   * Create configuration for administrative boundaries
   */
  createAdministrativeConfig: (
    baseUrl: string, 
    type: 'communes' | 'departments' | 'iris' | 'postal_code',
    options: Partial<import('./src/types').MVTSourceOptions> = {}
  ): import('./src/types').MVTSourceOptions => {
    const layerMap = {
      'communes': 'communes',
      'departments': 'departments', 
      'iris': 'iris',
      'postal_code': 'postal_code'
    };
    
    return {
      url: `${baseUrl.replace(/\/$/, '')}/${type}/{z}/{x}/{y}.pbf`,
      visibleLayers: [layerMap[type]],
      style: {
        fillStyle: 'rgba(70, 130, 180, 0.3)',
        strokeStyle: 'rgba(70, 130, 180, 0.8)',
        lineWidth: 1,
        selected: DefaultStyles.selected.polygon(),
        hover: {
          fillStyle: 'rgba(70, 130, 180, 0.5)',
          lineWidth: 2
        }
      },
      setSelectedOnClick: true,
      cache: true,
      ...options
    };
  },
  
  /**
   * Create high-performance configuration
   */
  createHighPerformanceConfig: (
    url: string,
    options: Partial<import('./src/types').MVTSourceOptions> = {}
  ): import('./src/types').MVTSourceOptions => {
    return {
      url,
      cache: true,
      debug: false,
      tileSize: 256,
      sourceMaxZoom: 18,
      style: DefaultStyles.minimal(),
      ...options
    };
  }
};
