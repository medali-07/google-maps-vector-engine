declare module '@mapbox/vector-tile' {
  export interface VectorTileFeature {
    id?: number | string;
    type: number;
    extent: number;
    properties: { [key: string]: any };
    loadGeometry(): Array<Array<{ x: number; y: number }>>;
    bbox(): [number, number, number, number] | null;
    toGeoJSON(x: number, y: number, z: number): GeoJSON.Feature;
  }

  export interface VectorTileLayer {
    name: string;
    version: number;
    extent: number;
    length: number;
    feature(i: number): VectorTileFeature;
  }

  export interface VectorTile {
    layers: { [key: string]: VectorTileLayer };
  }

  export class VectorTile {
    constructor(pbf: any, end?: number);
    layers: { [key: string]: VectorTileLayer };
  }

  export { VectorTileFeature, VectorTileLayer };
}
