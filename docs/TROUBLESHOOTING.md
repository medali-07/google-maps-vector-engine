# 🔧 Troubleshooting

## Common Issues

### "google is not defined"

**Solution**: Load Google Maps API before initializing MVTSource

```typescript
// Wait for Google Maps to load
function waitForGoogleMaps(): Promise<void> {
  return new Promise((resolve) => {
    if (window.google && window.google.maps) {
      resolve();
    } else {
      const checkGoogle = () => {
        if (window.google && window.google.maps) {
          resolve();
        } else {
          setTimeout(checkGoogle, 100);
        }
      };
      checkGoogle();
    }
  });
}

await waitForGoogleMaps();
const mvtSource = new MVTSource(map, options);
```

### Tiles Not Loading

**Diagnosis**:
1. Check browser Network tab for failed requests
2. Verify tile URL template is correct
3. Check CORS headers on tile server

**Solution**:
```typescript
// Enable debug mode
const mvtSource = new MVTSource(map, {
  url: 'https://your-tiles.com/{z}/{x}/{y}.pbf',
  debug: true  // Shows detailed loading info
});

// Test tile URL manually
fetch('https://your-tiles.com/10/512/512.pbf')
  .then(response => {
    console.log('Tile response:', response.status);
    return response.arrayBuffer();
  })
  .then(data => console.log('Tile size:', data.byteLength))
  .catch(error => console.error('Tile error:', error));
```

### CORS Errors

**Server-side solution** (Apache):
```apache
Header always set Access-Control-Allow-Origin "*"
Header always set Access-Control-Allow-Methods "GET, OPTIONS"
```

**Development proxy** (webpack):
```javascript
module.exports = {
  devServer: {
    proxy: {
      '/tiles': {
        target: 'https://your-tile-server.com',
        changeOrigin: true
      }
    }
  }
};
```

### Poor Performance

**Solutions**:
```typescript
const mvtSource = new MVTSource(map, {
  url: 'https://tiles.com/{z}/{x}/{y}.pbf',
  cache: true,                    // Essential
  visibleLayers: ['boundaries'],  // Limit layers
  style: DefaultStyles.minimal(), // Simple styles
  debug: false                    // Disable in production
});
```

### Features Not Clickable

**Solution**:
```typescript
const mvtSource = new MVTSource(map, {
  url: 'https://tiles.com/{z}/{x}/{y}.pbf',
  setSelectedOnClick: true,
  onClick: (event) => {
    if (event.feature) {
      console.log('Feature:', event.feature.properties);
    } else {
      console.log('No feature found');
    }
  }
});
```

### Memory Leaks

**Solution**: Always dispose when done
```typescript
// React
useEffect(() => {
  return () => {
    if (mvtSource) {
      mvtSource.dispose();
    }
  };
}, [mvtSource]);

// Vue
onUnmounted(() => {
  mvtSource?.dispose();
});
```

## Debug Mode

Enable for development:
```typescript
const mvtSource = new MVTSource(map, {
  url: 'https://tiles.com/{z}/{x}/{y}.pbf',
  debug: true
});
```

Shows:
- Tile loading times
- Feature parsing stats
- Click detection details
- Memory usage
- Performance metrics

## Environment Setup

### Webpack
```javascript
module.exports = {
  resolve: {
    fallback: {
      "path": false,
      "fs": false
    }
  }
};
```

### Vite
```typescript
export default defineConfig({
  define: { global: 'globalThis' },
  optimizeDeps: {
    include: ['google-maps-vector-engine']
  }
});
```

## Getting Help

1. Enable `debug: true` for detailed logs
2. Check browser Network tab for tile requests
3. Test with minimal example
4. [Open an issue](https://github.com/medali-07/google-maps-vector-engine/issues) with:
   - Browser/environment details
   - Console errors
   - Minimal reproduction code