# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-09-30

### Added
- Performance testing suite with benchmarks and memory monitoring
- Context pooling system for canvas operations
- Enhanced debugging capabilities

### Optimized
- MVTSource: Enhanced feature indexing, batched redraws, style caching
- MVTLayer: Improved z-ordering, streamlined feature parsing
- MVTFeature: Smart context pooling, cached Path2D objects
- Reduced memory footprint with cache size limits
- Faster feature lookups and rendering performance

### Changed
- Reduced package size by 57% (108kB → 46.4kB)
- Removed JavaScript source maps from production builds
- Excluded source files from published package
- Enabled comment removal and build optimizations
- Improved TypeScript build configuration

## [0.1.1] - 2025-09-16

### Added
- Prettier code formatting configuration
- ESLint code quality and style enforcement

### Fixed
- Fixed race condition in async getReplacementFeature API calls
  - Added AbortController to track and cancel pending replacement requests
  - Enhanced deselection logic to immediately cancel ongoing API calls
  - Added selection state validation before applying replacement results
  - Prevented duplicate requests for the same feature
  - Eliminates unwanted feature selections after deselection
  - Improves UX responsiveness for rapid user interactions

## [0.1.0] - 2025-09-12

### Added
- Initial release of google-maps-vector-engine
- High-performance vector tile rendering for Google Maps
- Fast feature lookups with O(1) indexed access
- Batched tile redraws with 60fps debouncing
- Advanced styling with embedded selection/hover states
- Interactive feature selection and event handling
- TypeScript support with comprehensive type definitions
- Configurable feature ID extraction with `defaultFeatureId` parameter
- Manifest utility functions for tile availability optimization
- Debug logging system with colored output and performance monitoring
- Color utilities for consistent styling
- Mercator projection utilities for coordinate transformations

### Features
- MVTSource: Main vector tile source for Google Maps
- MVTLayer: Individual layer management with efficient rendering
- MVTFeature: Feature representation with cached contexts
- DefaultStyles: Pre-built styling configurations
- MVTUtils: Common utility functions for filtering and styling
- ManifestUtils: Tile availability manifest management
- Comprehensive event handling system
- GeoJSON overlay support for complex features
