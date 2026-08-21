#!/usr/bin/env node
/**
 * Generate the real Mapbox Vector Tile fixture used by the decode tests.
 *
 * The suite used to `jest.mock` away `@mapbox/vector-tile` and `pbf` wholesale,
 * so the parse path had never executed. The one helper that claimed to build a
 * tile returned a 64-byte buffer with a comment calling `0x1a` the "MVT magic
 * number" - protobuf has no magic number - and nothing ever called it.
 *
 * This writes a genuine tile that the real decoder reads, so those tests assert
 * against actual geometry. Run with `node scripts/generate-tile-fixture.js`;
 * the output is committed, so this only needs re-running if the fixture
 * changes.
 *
 * Wire format: https://github.com/mapbox/vector-tile-spec/tree/master/2.1
 */

// pbf 4 and @mapbox/vector-tile 2 are ESM-only, hence the .mjs extension on
// this script rather than the repo's default CommonJS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Pbf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXTENT = 4096;

const GEOM_TYPE = { POINT: 1, LINESTRING: 2, POLYGON: 3 };
const CMD = { MOVE_TO: 1, LINE_TO: 2, CLOSE_PATH: 7 };

/** Command integer: the command id in the low 3 bits, repeat count above. */
const command = (id, count) => (id & 0x7) | (count << 3);

/** Parameter integer: zigzag encoded, so small negatives stay small. */
const zigzag = (value) => (value << 1) ^ (value >> 31);

/**
 * Encode rings as MVT geometry commands, relative to a moving cursor.
 *
 * @param {number[][][]} rings Each ring is [[x, y], ...] in tile coordinates.
 * @param {boolean} close Emit ClosePath after each ring (polygons only).
 */
function encodeGeometry(rings, close) {
  const geometry = [];
  let cursorX = 0;
  let cursorY = 0;

  for (const ring of rings) {
    if (ring.length === 0) continue;

    geometry.push(command(CMD.MOVE_TO, 1));
    geometry.push(zigzag(ring[0][0] - cursorX), zigzag(ring[0][1] - cursorY));
    cursorX = ring[0][0];
    cursorY = ring[0][1];

    const rest = ring.slice(1);
    if (rest.length > 0) {
      geometry.push(command(CMD.LINE_TO, rest.length));
      for (const [x, y] of rest) {
        geometry.push(zigzag(x - cursorX), zigzag(y - cursorY));
        cursorX = x;
        cursorY = y;
      }
    }

    if (close) geometry.push(command(CMD.CLOSE_PATH, 1));
  }

  return geometry;
}

function writeValue(value, pbf) {
  if (typeof value === 'string') pbf.writeStringField(1, value);
  else if (typeof value === 'boolean') pbf.writeBooleanField(7, value);
  else if (Number.isInteger(value)) pbf.writeSVarintField(6, value);
  else pbf.writeDoubleField(3, value);
}

function writeFeature(feature, pbf) {
  if (feature.id !== undefined) pbf.writeVarintField(1, feature.id);
  if (feature.tags.length) pbf.writePackedVarint(2, feature.tags);
  pbf.writeVarintField(3, feature.type);
  pbf.writePackedVarint(4, feature.geometry);
}

function writeLayer(layer, pbf) {
  pbf.writeVarintField(15, 2); // version
  pbf.writeStringField(1, layer.name);
  for (const feature of layer.features) pbf.writeMessage(2, writeFeature, feature);
  for (const key of layer.keys) pbf.writeStringField(3, key);
  for (const value of layer.values) pbf.writeMessage(4, writeValue, value);
  pbf.writeVarintField(5, EXTENT);
}

function writeTile(layers, pbf) {
  for (const layer of layers) pbf.writeMessage(3, writeLayer, layer);
}

/**
 * Build a layer, interning property keys and values into the shared tables the
 * MVT format uses instead of repeating them per feature.
 */
function buildLayer(name, rawFeatures) {
  const keys = [];
  const values = [];
  const keyIndex = new Map();
  const valueIndex = new Map();

  const features = rawFeatures.map((raw) => {
    const tags = [];

    for (const [key, value] of Object.entries(raw.properties || {})) {
      if (!keyIndex.has(key)) {
        keyIndex.set(key, keys.length);
        keys.push(key);
      }
      const valueKey = `${typeof value}:${String(value)}`;
      if (!valueIndex.has(valueKey)) {
        valueIndex.set(valueKey, values.length);
        values.push(value);
      }
      tags.push(keyIndex.get(key), valueIndex.get(valueKey));
    }

    return {
      id: raw.id,
      tags,
      type: raw.type,
      geometry: encodeGeometry(raw.rings, raw.type === GEOM_TYPE.POLYGON),
    };
  });

  return { name, features, keys, values };
}

// A tile with all three geometry types, across two layers, so the decode tests
// can exercise every branch of the geometry switch.
const layers = [
  buildLayer('buildings', [
    {
      id: 1,
      type: GEOM_TYPE.POLYGON,
      properties: { name: 'Block A', height: 12, active: true },
      // A square covering the middle quarter of the tile.
      rings: [
        [
          [1024, 1024],
          [3072, 1024],
          [3072, 3072],
          [1024, 3072],
        ],
      ],
    },
    {
      id: 2,
      type: GEOM_TYPE.POLYGON,
      properties: { name: 'Block B', height: 30, active: false },
      rings: [
        [
          [0, 0],
          [512, 0],
          [512, 512],
          [0, 512],
        ],
      ],
    },
  ]),
  buildLayer('roads', [
    {
      id: 10,
      type: GEOM_TYPE.LINESTRING,
      properties: { name: 'Main Street', lanes: 4 },
      rings: [
        [
          [0, 2048],
          [2048, 2048],
          [4096, 2048],
        ],
      ],
    },
    {
      id: 11,
      type: GEOM_TYPE.POINT,
      properties: { name: 'Junction' },
      rings: [[[2048, 2048]]],
    },
  ]),
];

const pbf = new Pbf();
writeTile(layers, pbf);
const buffer = Buffer.from(pbf.finish());

const outDir = path.join(__dirname, '..', 'tests', 'fixtures');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'sample.pbf');
fs.writeFileSync(outFile, buffer);

// Prove it round-trips through the real decoder before committing it.
const decoded = new VectorTile(new Pbf(new Uint8Array(buffer)));
const summary = Object.entries(decoded.layers).map(([name, layer]) => `${name}(${layer.length})`);

console.log(`Wrote ${outFile} - ${buffer.length} bytes`);
console.log(`Decodes as: ${summary.join(', ')}`);
