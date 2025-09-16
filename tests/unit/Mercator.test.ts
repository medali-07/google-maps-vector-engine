import { Mercator } from '../../src/Mercator';
import { TileCoord, LatLng } from '../../src/types';

// Mock Google Maps LatLng for testing
const createMockLatLng = (lat: number, lng: number) => ({
  lat: () => lat,
  lng: () => lng
}) as google.maps.LatLng;

describe('Mercator', () => {
  describe('Point Transformations', () => {
    test('should convert LatLng to Mercator point', () => {
      const latLng = createMockLatLng(0, 0);
      const point = Mercator.fromLatLngToPoint(latLng);
      
      expect(point).toHaveProperty('x');
      expect(point).toHaveProperty('y');
      expect(typeof point.x).toBe('number');
      expect(typeof point.y).toBe('number');
    });

    test('should convert Mercator point to LatLng', () => {
      const point = { x: 128, y: 128 };
      const latLng = Mercator.fromPointToLatLng(point);
      
      expect(latLng).toHaveProperty('lat');
      expect(latLng).toHaveProperty('lng');
      expect(typeof latLng.lat).toBe('number');
      expect(typeof latLng.lng).toBe('number');
    });
  });

  describe('Tile Operations', () => {
    test('should get tile coordinates from LatLng', () => {
      const latLng = createMockLatLng(0, 0);
      const tileCoord = Mercator.getTileAtLatLng(latLng, 10);
      
      expect(tileCoord).toHaveProperty('x');
      expect(tileCoord).toHaveProperty('y');
      expect(tileCoord).toHaveProperty('z');
      expect(tileCoord.z).toBe(10);
    });

    test('should calculate tile bounds correctly', () => {
      const tileCoord = { x: 1, y: 1, z: 1 };
      const bounds = Mercator.getTileBounds(tileCoord);
      
      expect(bounds).toHaveProperty('ne');
      expect(bounds).toHaveProperty('sw');
      expect(bounds.ne.lat).toBeGreaterThan(bounds.sw.lat);
      expect(bounds.ne.lng).toBeGreaterThan(bounds.sw.lng);
    });

    test('should handle tile bounds at different zoom levels', () => {
      const zoom1Bounds = Mercator.getTileBounds({ x: 0, y: 0, z: 1 });
      const zoom2Bounds = Mercator.getTileBounds({ x: 0, y: 0, z: 2 });
      
      // Higher zoom should have smaller bounds
      const zoom1Size = zoom1Bounds.ne.lat - zoom1Bounds.sw.lat;
      const zoom2Size = zoom2Bounds.ne.lat - zoom2Bounds.sw.lat;
      
      expect(zoom2Size).toBeLessThan(zoom1Size);
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed coordinate objects', () => {
      expect(() => {
        Mercator.fromPointToLatLng({} as any);
      }).not.toThrow();
      
      expect(() => {
        Mercator.fromPointToLatLng({ x: 'invalid' } as any);
      }).not.toThrow();
    });
  });

  describe('Consistency', () => {
    test('should maintain consistent tile boundaries', () => {
      for (let zoom = 0; zoom <= 10; zoom++) {
        const gridSize = Math.pow(2, zoom);
        
        for (let x = 0; x < Math.min(gridSize, 4); x++) {
          for (let y = 0; y < Math.min(gridSize, 4); y++) {
            const bounds = Mercator.getTileBounds({ x, y, z: zoom });
            
            expect(bounds.ne.lat).toBeGreaterThan(bounds.sw.lat);
            expect(bounds.ne.lng).toBeGreaterThan(bounds.sw.lng);
          }
        }
      }
    });
  });
});