import { defineConfig } from 'tsup';

/**
 * Runtime dependencies stay external for the CJS and ESM builds so consumers
 * can dedupe them. Only the browser bundle inlines everything, because a
 * `<script>` tag has nothing to resolve them with.
 */
const RUNTIME_DEPS = ['@mapbox/vector-tile', 'pbf', '@turf/union', '@turf/intersect'];

export default defineConfig([
  {
    // Node and bundler entry points.
    //
    // tsc cannot produce a working ESM build here: it emits import specifiers
    // exactly as written, so `./src/MVTSource` stays extensionless and Node's
    // ESM resolver rejects it with ERR_MODULE_NOT_FOUND. Rewriting every
    // import in src/ to carry a `.js` suffix would fix it, at the cost of
    // making every specifier in the codebase lie about the file it points to.
    entry: ['index.ts'],
    outDir: 'dist',
    format: ['cjs', 'esm'],
    target: 'es2020',
    platform: 'neutral',
    external: RUNTIME_DEPS,
    // Bundled declarations, emitted as both .d.ts and .d.mts. publint flags a
    // single "types" entry as ambiguous under the "import" condition, because
    // a .d.ts is resolved as CJS there. Bundling also collapses the whole
    // dist/src/**.d.ts tree into one file with no relative specifiers, which
    // is what makes it valid under moduleResolution: node16.
    dts: true,
    sourcemap: false,
    clean: false,
    // Splitting keeps the lazily imported GeoJSON subsystem, and the Turf
    // dependency it pulls in, out of the entry chunk.
    splitting: true,
    treeshake: true,
  },
  {
    // Browser drop-in: `<script src="...">` then `window.GoogleMapsVectorEngine`.
    entry: { 'google-maps-vector-engine': 'index.ts' },
    outDir: 'dist',
    format: ['iife'],
    globalName: 'GoogleMapsVectorEngine',
    target: 'es2020',
    platform: 'browser',
    // Self-contained: a script tag cannot resolve bare specifiers.
    noExternal: RUNTIME_DEPS,
    dts: false,
    minify: true,
    // No sourcemap: it was 677KB, five times the bundle itself, for a CDN
    // drop-in whose users are not stepping through it.
    sourcemap: false,
    clean: false,
    // An IIFE is a single scope by definition, so the lazy import is inlined.
    splitting: false,
    outExtension: () => ({ js: '.min.js' }),
  },
]);
