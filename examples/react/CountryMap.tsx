/**
 * A complete React component using the hook, against the same keyless demo
 * tileset the vanilla example uses.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { DefaultStyles } from 'google-maps-vector-engine';
import { useVectorTiles } from './useVectorTiles';

/** The properties the demo tileset carries on each country. */
interface Country {
  fid: number;
  NAME: string;
  ABBREV: string;
  ADM0_A3: string;
  CONTINENT: string;
}

export function CountryMap({ apiKey }: { apiKey: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);

  useEffect(() => {
    if (!container.current) return;

    // In a real app use @googlemaps/js-api-loader; this keeps the example to
    // one dependency.
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.onload = () => {
      setMap(new google.maps.Map(container.current!, { center: { lat: 20, lng: 0 }, zoom: 3 }));
    };
    document.head.append(script);

    return () => script.remove();
  }, [apiKey]);

  // Memoised so the style is not a new function on every render, which would
  // invalidate the style cache each time.
  const style = useMemo(() => DefaultStyles.accessible(), []);

  const { selected, stats, error, setSelection, source } = useVectorTiles<Country>(map, {
    url: 'https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf',
    sourceMaxZoom: 6,
    clickableLayers: ['countries'],
    cache: true,
    style,
    onClick: (event) => {
      // `event.feature` is typed: properties.NAME is a string, not any.
      if (event.feature) console.log('clicked', event.feature.properties.NAME);
    },
  });

  if (error) {
    return <p role="alert">Bad option &ldquo;{error.option}&rdquo;: {error.message}</p>;
  }

  const names = selected
    .map((id) => source?.getFeature(id))
    .filter((feature): feature is NonNullable<typeof feature> => Boolean(feature))
    .map((feature) => feature.properties.NAME);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', height: '100vh' }}>
      <aside style={{ padding: 16, overflowY: 'auto' }}>
        <h2>Selected</h2>
        <p>{names.length ? names.join(', ') : 'Nothing selected.'}</p>
        <button onClick={() => setSelection([])} disabled={!selected.length}>
          Clear
        </button>

        {stats && (
          <dl>
            <dt>visible tiles</dt>
            <dd>{stats.visibleTiles}</dd>
            <dt>features</dt>
            <dd>{stats.features}</dd>
            <dt>in flight</dt>
            <dd>{stats.pendingRequests}</dd>
          </dl>
        )}
      </aside>

      <div ref={container} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
