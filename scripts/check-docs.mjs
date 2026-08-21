#!/usr/bin/env node
/**
 * Type-check every TypeScript snippet in the Markdown docs.
 *
 * The docs carried 67 fenced `typescript` blocks that nothing ever compiled,
 * so they drifted freely: they went on demonstrating `await tileLoaded()` for
 * the whole period it could never resolve, and kept calling methods that had
 * been renamed. A snippet nobody compiles is a comment that looks like code.
 *
 * Each block is wrapped in a shared preamble that declares the things a
 * snippet may reasonably assume already exist (`map`, `mvtSource`, a feature),
 * written to a temporary file, and type-checked as one program.
 *
 * A block that is deliberately not compilable - pseudo-code, a fragment, a
 * deliberate error being described - opts out with `// docs-check: skip` on
 * its first line. That is visible in the rendered docs, which is the point:
 * opting out should cost something.
 *
 * Run with `npm run check:docs`.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  'README.md',
  'MIGRATION.md',
  'examples/README.md',
  'docs/API.md',
  'docs/EXAMPLES.md',
  'docs/ADVANCED.md',
  'docs/PERFORMANCE.md',
  'docs/TROUBLESHOOTING.md',
];

/** Every value and type the package exports, injected only when needed. */
const LIBRARY_VALUES = [
  'MVTSource', 'MVTLayer', 'MVTFeature', 'Mercator', 'ColorUtils',
  'DebugLogger', 'debugLogger', 'createLogger', 'GeometryType',
  'MVTError', 'MVTOptionsError', 'createMVTSource',
  'DefaultStyles', 'AccessiblePalette', 'ManifestUtils', 'MVTUtils', 'MVTFactory',
];

const LIBRARY_TYPES = [
  'Point', 'TileCoord', 'TileBounds', 'LatLng', 'FeatureStyle', 'FeatureStyleFunction',
  'StyleContext', 'MVTMouseEvent', 'MouseEventOptions', 'MVTSourceEvents',
  'ClickEventCallback', 'HoverEventCallback', 'TileContext', 'TileFeatureData',
  'CanvasAndFeatures', 'FeatureProperties', 'GeoJSONFeature', 'GeoJSONPosition',
  'GeoJSONCoordinates', 'FeatureReplacementFunction', 'FeatureSelectionCallback',
  'MVTSourceOptions', 'MVTLayerOptions', 'MVTFeatureOptions', 'SelectionOptions',
  'MVTSourceStats', 'TileManifest', 'TileAvailabilitySource',
  'CustomDrawFunction', 'FilterFunction', 'IDExtractorFunction',
];

/** True when the snippet already brings this name in itself. */
const declaresOwn = (code, name) =>
  new RegExp(`\\b(?:const|let|var|function|class|interface|type|enum)\\s+${name}\\b`).test(code) ||
  new RegExp(`import[^;]*\\b${name}\\b[^;]*from`).test(code);

const usesName = (code, name) => new RegExp(`\\b${name}\\b`).test(code);

/**
 * Imports this snippet needs from the package.
 *
 * Injected per snippet rather than as one blanket preamble, so a snippet that
 * shows its own `import { ManifestUtils } from ...` - which is what a reader
 * should see - does not collide with it.
 */
function importsFor(code) {
  const values = LIBRARY_VALUES.filter((n) => usesName(code, n) && !declaresOwn(code, n));
  const types = LIBRARY_TYPES.filter((n) => usesName(code, n) && !declaresOwn(code, n));

  const lines = [];
  if (values.length) lines.push(`import { ${values.join(', ')} } from 'google-maps-vector-engine';`);
  if (types.length) lines.push(`import type { ${types.join(', ')} } from 'google-maps-vector-engine';`);
  return lines.join('\n');
}


/**
 * Things a snippet may assume already exist, supplied only when the snippet
 * uses the name and does not define it itself.
 *
 * Declaring them unconditionally collides with the many snippets that quite
 * properly write `const mvtSource = new MVTSource(...)` themselves.
 */
const AMBIENT = {
  map: 'declare const map: google.maps.Map;',
  options: 'declare const options: MVTSourceOptions;',
  mvtSource: 'declare const mvtSource: MVTSource;',
  source: 'declare const source: MVTSource;',
  canvas: 'declare const canvas: HTMLCanvasElement;',
  tileUrl: 'declare const tileUrl: string;',
  url: 'declare const url: string;',
  baseUrl: 'declare const baseUrl: string;',
  sourceMaxZoom: 'declare const sourceMaxZoom: number;',
  apiKey: 'declare const apiKey: string;',
  feature: "declare const feature: import('@mapbox/vector-tile').VectorTileFeature;",
  featureId: 'declare const featureId: string | number;',
  manifest: 'declare const manifest: TileManifest;',
  // Framework hooks, for the lifecycle snippets that are about disposal rather
  // than about React or Vue.
  useEffect: 'declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;',
  useState: 'declare function useState<T>(initial: T): [T, (next: T) => void];',
  useRef: 'declare function useRef<T>(initial: T): { current: T };',
  useMemo: 'declare function useMemo<T>(factory: () => T, deps?: unknown[]): T;',
  onUnmounted: 'declare function onUnmounted(hook: () => void): void;',
  onMounted: 'declare function onMounted(hook: () => void): void;',
  defineConfig: 'declare function defineConfig<T>(config: T): T;',
};

/**
 * Helper functions the docs call to make a point about the library.
 *
 * These stand in for whatever the reader's app already has. Keeping the list
 * explicit rather than auto-declaring every unresolved name means a genuine
 * typo in a snippet still fails the check.
 */
const APP_HELPERS = [
  'showCountryInfo',
  'showPointOfInterestInfo',
  'doSomething',
  'updateUI',
  'loadBuildingDetails',
  'toggleBoundarySelection',
  'addToBoundarySelection',
  'selectBoundary',
  'trackFeatureInteraction',
  'calculateRegion',
  'getDynamicManifest',
  'calculateArea',
  'generateComplexStyle',
];

for (const name of APP_HELPERS) {
  AMBIENT[name] ??= `declare function ${name}(...args: any[]): any;`;
}

/** Ambient declarations this snippet needs, minus anything it defines. */
function ambientsFor(code) {
  return Object.entries(AMBIENT)
    .filter(([name]) => {
      // No need to detect parameters: a parameter of the same name simply
      // shadows the ambient, which is exactly the behaviour we want.
      return usesName(code, name) && !declaresOwn(code, name);
    })
    .map(([, declaration]) => declaration)
    .join('\n');
}

/**
 * The full generated header for a snippet: imports plus ambients.
 *
 * Imports are computed from the snippet *and* the ambients, because an ambient
 * like `declare const mvtSource: MVTSource` introduces a type reference of its
 * own that has to resolve.
 */
function preambleFor(code) {
  const ambients = ambientsFor(code);
  return [importsFor(code + '\n' + ambients), ambients].filter(Boolean).join('\n') + '\n';
}

/** Pull every fenced ts/typescript block out of a Markdown file. */
function extractBlocks(markdown, file) {
  const blocks = [];
  const fence = /^(`{3,})(tsx?|typescript)[^\n]*\n([\s\S]*?)^\1\s*$/gm;

  let match;
  while ((match = fence.exec(markdown)) !== null) {
    const line = markdown.slice(0, match.index).split('\n').length;
    const code = match[3];
    // React snippets are TypeScript too; they just need the JSX parser. The
    // docs fence them as `typescript`, so detect rather than demand a rename.
    const jsx = match[2] === 'tsx' || /^\s*(?:return\s*\(\s*)?</m.test(code) || /<\/[A-Za-z]/.test(code);
    blocks.push({ file, line, code, jsx });
  }
  return blocks;
}

const all = [];
for (const file of FILES) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) continue;
  all.push(...extractBlocks(fs.readFileSync(full, 'utf8'), file));
}

const skipped = all.filter((b) => /^\s*\/\/\s*docs-check:\s*skip/m.test(b.code));
const checked = all.filter((b) => !skipped.includes(b));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-check-'));
const written = checked.map((block, index) => {
  // Each block becomes its own module, so a `const` in one cannot collide with
  // a `const` of the same name in another.
  const name = `snippet-${String(index).padStart(3, '0')}.${block.jsx ? 'tsx' : 'ts'}`;
  const header = preambleFor(block.code);
  // `export {}` forces every snippet to be a module. Without it, a snippet
  // that imports nothing is a *script*, and its top-level `const` collides
  // with the same name in every other script in the program.
  fs.writeFileSync(
    path.join(dir, name),
    `${header}\n// ${block.file}:${block.line}\n${block.code}\nexport {};\n`,
  );
  return { ...block, name };
});

// React and Vue are not devDependencies - installing two frameworks to
// type-check documentation would be a poor trade. These shims keep the
// framework snippets structurally checked without them.
fs.writeFileSync(
  path.join(dir, 'frameworks.d.ts'),
  `declare module 'vue' {
  export type Ref<T> = { value: T };
  export function ref<T>(value: T): Ref<T>;
  export function shallowRef<T>(value: T): Ref<T>;
  export function computed<T>(getter: () => T): Ref<T>;
  export function watch(source: unknown, cb: (...args: any[]) => void, options?: unknown): void;
  export function onMounted(hook: () => void): void;
  export function onUnmounted(hook: () => void): void;
  export function onBeforeUnmount(hook: () => void): void;
  export function defineProps<T>(): T;
}

declare module 'react' {
  export function useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
  export function useRef<T>(initial: T): { current: T };
  export function useMemo<T>(factory: () => T, deps?: unknown[]): T;
  export function useCallback<T>(fn: T, deps?: unknown[]): T;
}

declare namespace JSX {
  interface IntrinsicElements {
    [element: string]: any;
  }
  interface Element {}
}
`,
);

fs.writeFileSync(
  path.join(dir, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        lib: ['ES2020', 'DOM'],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        esModuleInterop: true,
        // Snippets illustrate an API; they are not asked to use every value
        // they declare, and `any` in a doc example is the reader's problem to
        // fill in, not an error.
        noUnusedLocals: false,
        noUnusedParameters: false,
        types: ['google.maps'],
        // 'preserve' rather than 'react-jsx': the latter emits an import of
        // react/jsx-runtime, which is not installed.
        jsx: 'preserve',
        baseUrl: ROOT,
        paths: {
          // Snippets should show the import a reader would actually write, so
          // the package name has to resolve back to this repo.
          'google-maps-vector-engine': [path.join(ROOT, 'index.ts')],
          '*': [path.join(ROOT, 'node_modules/*')],
        },
      },
      include: ['*.ts', '*.tsx', '*.d.ts'],
    },
    null,
    2,
  ),
);

// The snippets import '../index', so the temp directory has to sit one level
// under a directory that resolves to the repo.
const stage = path.join(ROOT, '.docs-check');
fs.rmSync(stage, { recursive: true, force: true });
fs.cpSync(dir, stage, { recursive: true });
fs.rmSync(dir, { recursive: true, force: true });

let output = '';
let failed = false;
try {
  execFileSync(path.join(ROOT, 'node_modules/.bin/tsc'), ['--project', path.join(stage, 'tsconfig.json')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (error) {
  failed = true;
  output = `${error.stdout || ''}${error.stderr || ''}`;
}

if (failed) {
  // Map each diagnostic back to the doc file and line it came from.
  const byFile = new Map(written.map((b) => [b.name, b]));
  const seen = new Set();

  for (const line of output.split('\n')) {
    const m = /^(?:.*[/\\])?(snippet-\d+\.tsx?)\((\d+),\d+\):\s*(.*)$/.exec(line);
    if (!m) continue;

    const block = byFile.get(m[1]);
    if (!block) continue;

    const preambleLines = preambleFor(block.code).split('\n').length + 1;
    const offset = Number(m[2]) - preambleLines;
    const key = `${block.file}:${block.line + offset}:${m[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);

    console.error(`${block.file}:~${block.line + offset}  ${m[3]}`);
  }
}

if (!process.env.DOCS_CHECK_KEEP) fs.rmSync(stage, { recursive: true, force: true });

console.log(
  `\nChecked ${checked.length} snippet${checked.length === 1 ? '' : 's'} across ${FILES.length} files` +
    (skipped.length ? `, ${skipped.length} marked "docs-check: skip"` : '') +
    (failed ? '\nDocumentation snippets do not compile.' : '\nAll documentation snippets compile.'),
);

process.exit(failed ? 1 : 0);
