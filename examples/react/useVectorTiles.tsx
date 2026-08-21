/**
 * React binding for MVTSource.
 *
 * The only two things that matter here, and the two most commonly got wrong:
 *
 * 1. `dispose()` must run on unmount. The source registers map listeners, keeps
 *    tile requests in flight and holds decoded geometry; without it, every
 *    remount leaks all of that.
 * 2. Nothing about the source belongs in React state. It is a mutable object
 *    that owns canvas elements, and re-rendering on every tile would be both
 *    pointless and slow. Keep it in a ref and subscribe for the bits the UI
 *    actually renders.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MVTSource, MVTOptionsError } from 'google-maps-vector-engine';
import type { MVTSourceOptions, MVTSourceStats } from 'google-maps-vector-engine';

export interface UseVectorTilesResult<TProps extends object> {
  /** The live source, or null before the map is ready. */
  source: MVTSource<TProps> | null;
  /** Currently selected feature ids, mirrored into React state. */
  selected: (string | number)[];
  /** Refreshed whenever the source goes idle. */
  stats: MVTSourceStats | null;
  /** Set to a construction error, if the options were rejected. */
  error: MVTOptionsError | null;
  setSelection: (ids: (string | number)[], mode?: 'replace' | 'add' | 'remove') => void;
}

export function useVectorTiles<TProps extends object = Record<string, unknown>>(
  map: google.maps.Map | null,
  options: MVTSourceOptions<TProps>,
): UseVectorTilesResult<TProps> {
  const sourceRef = useRef<MVTSource<TProps> | null>(null);
  const [selected, setSelected] = useState<(string | number)[]>([]);
  const [stats, setStats] = useState<MVTSourceStats | null>(null);
  const [error, setError] = useState<MVTOptionsError | null>(null);

  // `options` is almost always a fresh object literal each render, so it must
  // not be an effect dependency or the source is torn down every render. Only
  // the url is treated as identifying; call the setters for the rest.
  const url = options.url;

  useEffect(() => {
    if (!map) return;

    let source: MVTSource<TProps>;
    try {
      source = new MVTSource<TProps>(map, options);
    } catch (constructionError) {
      if (constructionError instanceof MVTOptionsError) {
        setError(constructionError);
        return;
      }
      throw constructionError;
    }

    sourceRef.current = source;
    setError(null);

    const stopSelection = source.on('selectionchange', ({ selected: ids }) => setSelected(ids));
    const stopIdle = source.on('idle', () => setStats(source.getStats()));

    return () => {
      stopSelection();
      stopIdle();
      source.dispose();
      sourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, url]);

  // Push style changes through the setter rather than rebuilding the source,
  // which would discard every decoded tile.
  useEffect(() => {
    if (options.style) sourceRef.current?.setStyle(options.style);
  }, [options.style]);

  useEffect(() => {
    sourceRef.current?.setVisibleLayers(options.visibleLayers);
  }, [options.visibleLayers]);

  const setSelection = useCallback(
    (ids: (string | number)[], mode: 'replace' | 'add' | 'remove' = 'replace') => {
      sourceRef.current?.setSelection(ids, { mode });
    },
    [],
  );

  return { source: sourceRef.current, selected, stats, error, setSelection };
}
