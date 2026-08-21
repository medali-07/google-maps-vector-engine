# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - unreleased

The first release the package's own toolchain could verify. Lint checked one
30-line type shim, the coverage threshold was set above what the suite could
reach so `test:coverage` could never pass, the ESM build did not import, and
all 89 JSDoc blocks were stripped from the published types. Those are fixed,
and the bugs they were hiding are fixed with them.

Breaking changes are listed in [MIGRATION.md](./MIGRATION.md).

### Fixed

- `releaseTile()` was an empty stub, so memory grew without bound on every pan.
  The 50-tile cap that masked it — which broke clicking on any viewport above
  ~1080p — is gone with it.
- Tile requests were never aborted. A late response could re-create layers and
  repopulate caches on a disposed source, writing to a detached canvas.
- `tileLoaded()` could never resolve: its condition was unsatisfiable, and each
  call spawned a self-recursive timer that ran forever. It also hung when the
  source was disposed mid-wait, because dispose cancelled the poll timer that
  would have settled it.
- `drawTile` handed the same DOM canvas to Google Maps twice, permanently
  blanking the first tile.
- `ContextPool` returned contexts bound to unrelated canvases, drawing geometry
  onto the wrong tile. Removed entirely; `getContext('2d')` is already
  idempotent and free.
- Tile ids used unwrapped x while hit testing used normalised x, so clicks were
  dead on every repeated world copy and across the antimeridian, and the
  request URL could carry a negative x.
- Fractional zoom during smooth transitions on vector basemaps discarded every
  tile response.
- The default feature id extractor was passed unbound, so `this` was the layer
  rather than the source. It threw on the first feature of every tile whenever
  no extractor was supplied — the default configuration — and the retry path
  swallowed it, so the tile silently never appeared.
- Polygon merging across tiles was broken by the Turf 7 API change: both
  `union` and `intersect` threw on every call, and both call sites caught and
  continued, so overlapping rings silently never merged.
- `fillOpacity` was declared, documented, included in the style hash, and never
  read by any code path.
- The hover fallback did a literal `"0.3"` → `"0.5"` substring replacement on
  the colour, gated on the colour *not* being `rgba(...)` — which is every
  default shipped here, so it had never run.
- Colour parsing failed on uppercase `RGB(...)` and on leading whitespace,
  silently defeating `fillOpacity` and the hover fallback for valid CSS input.
- One click ran the selection handler once per clickable layer, firing user
  callbacks repeatedly and letting one layer wipe another's hover.
- Hover state stuck permanently when the pointer left the map.
- `MVTLayer` kept hit-test state in instance fields, so two overlapping hit
  tests could discard each other's result.
- GeoJSON overlays for overzoomed features were projected from the child tile
  rather than the parent, placing them wrongly.
- Overlay hover handlers passed a fabricated object literal in place of the
  feature, so every documented property beyond two was absent at runtime.
- `setTileAvailabilityManifest(undefined)` did not clear the manifest.
- `getReplacementFeature` did nothing unless `featureSelectionCallback` was
  also supplied.
- `DebugLogger` was a process-global singleton: a second source constructed
  with `debug: false` silenced the first.

### Added

- Retina rendering. Tiles render at `min(devicePixelRatio, maxPixelRatio)`,
  with hit testing scaled to match.
- `on` / `off` / `once` over `tileload`, `tileerror`, `load`, `idle`,
  `selectionchange`, `click` and `hover`.
- Constructor validation, throwing a typed `MVTOptionsError` naming the option
  at fault.
- Cursor feedback over clickable features, via `hoverCursor`.
- Tile fade-in, via `fadeInDuration`.
- Colour-vision-safe `accessible` and `dark` presets, with measured contrast
  ratios documented, plus the `AccessiblePalette` they are built from.
- Zoom-dependent styling: style functions now receive a `StyleContext`.
- `getStats()`, `getFeatureBounds()`, `fitBounds()`, `refreshTile()`,
  `setOpacity()`, `show()` / `hide()` / `isVisible()`, and getters completing
  the `setUrl` / `setFilter` / `setStyle` / `setClickableLayers` pairs.
- `minZoom` and `maxZoom` options.
- A browser bundle for `<script>` and CDN use.
- A runnable demo in `examples/`, plus React and Vue bindings.

### Changed

- **Breaking.** Selection collapses to `setSelection(ids, { mode })`.
  `multipleSelection` no longer latches on programmatic calls.
- **Breaking.** `maxZoom` no longer defaults to `sourceMaxZoom`, which had made
  the overzoom path unreachable. `minZoom` is no longer hardcoded to 6.
- **Breaking.** The `exports` map exposes only the package root, so deep
  imports of internals no longer resolve. The ESM entry moved to
  `dist/index.mjs`.
- **Breaking.** `MVTFactory.createAdministrativeConfig` and
  `MVTUtils.performance` are removed; `getStats()` replaces the latter.
- `MVTSource` is generic over feature properties. `MVTMouseEvent.feature` is
  typed rather than `any`; `src/types.ts` has no `any` left.
- Redraws and hover are frame-aligned and throttled rather than debounced, so
  neither starves under continuous input.
- The GeoJSON merge subsystem is loaded on first use, keeping Turf out of the
  entry chunk.

### Removed

- `@turf/turf` in favour of `@turf/union` and `@turf/intersect`: installed size
  9.7 MB → 620 KB.
- The unused `IMVTSource`, `IMVTFeature` and `IMVTLayer` interfaces.
- `puppeteer`, which was never used and downloaded ~170 MB per install.

### Internal

- Coverage 34% → 93.7% statements, with 85/85/80 enforced in CI.
- Package size 322 kB → 149 kB; 50 files → 33.
- `publint` and `@arethetypeswrong/cli` clean; CI checks both, plus a bundle
  size budget and a smoke test that installs the packed tarball.
- Every TypeScript snippet in the documentation is now type-checked.

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

[unreleased]: https://github.com/medali-07/google-maps-vector-engine/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/medali-07/google-maps-vector-engine/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/medali-07/google-maps-vector-engine/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/medali-07/google-maps-vector-engine/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/medali-07/google-maps-vector-engine/releases/tag/v0.1.0
