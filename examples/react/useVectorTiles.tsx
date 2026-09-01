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
  // Mirrored into state so consumers re-render when the source appears: a ref
  // mutation inside the effect schedules no render, and returning
  // `sourceRef.current` from the render phase would stay null until some
  // unrelated update happened by.
  const [source, setSource] = useState<MVTSource<TProps> | null>(null);
  const [selected, setSelected] = useState<(string | number)[]>([]);
  const [stats, setStats] = useState<MVTSourceStats | null>(null);
  const [error, setError] = useState<MVTOptionsError | null>(null);

  // `options` is almost always a fresh object literal each render, so it must
  // not be an effect dependency or the source is torn down every render. Only
  // the url is treated as identifying; call the setters for the rest.
  const url = options.url;

  // What the source is currently using, so the setter effects below can tell
  // a real change from the identity churn of a fresh options literal.
  const appliedStyle = useRef(options.style);
  const appliedLayers = useRef(options.visibleLayers);

  useEffect(() => {
    if (!map) return;

    let created: MVTSource<TProps>;
    try {
      created = new MVTSource<TProps>(map, options);
    } catch (constructionError) {
      if (constructionError instanceof MVTOptionsError) {
        setError(constructionError);
        return;
      }
      throw constructionError;
    }

    sourceRef.current = created;
    appliedStyle.current = options.style;
    appliedLayers.current = options.visibleLayers;
    setSource(created);
    setError(null);

    const stopSelection = created.on('selectionchange', ({ selected: ids }) => setSelected(ids));
    const stopIdle = created.on('idle', () => setStats(created.getStats()));

    return () => {
      stopSelection();
      stopIdle();
      created.dispose();
      sourceRef.current = null;
      setSource(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, url]);

  // Push style and layer changes through the setters rather than rebuilding
  // the source, which would discard every decoded tile. Both are guarded
  // against identity churn: `options` is usually a fresh literal each render,
  // and calling a setter per render would mean a full redraw per render.
  // A style function must be memoised by the caller (useMemo) — identity is
  // the only change signal a function gives us.
  useEffect(() => {
    if (options.style && options.style !== appliedStyle.current) {
      appliedStyle.current = options.style;
      sourceRef.current?.setStyle(options.style);
    }
  }, [options.style]);

  // Arrays are compared by content, so an inline `visibleLayers: [...]`
  // literal does not trigger a redraw per render.
  useEffect(() => {
    const next = options.visibleLayers;
    const prev = appliedLayers.current;
    const unchanged =
      next === prev ||
      (Array.isArray(next) &&
        Array.isArray(prev) &&
        next.length === prev.length &&
        next.every((layer, i) => layer === prev[i]));
    if (!unchanged) {
      appliedLayers.current = next;
      sourceRef.current?.setVisibleLayers(next);
    }
  });

  const setSelection = useCallback((ids: (string | number)[], mode: 'replace' | 'add' | 'remove' = 'replace') => {
    sourceRef.current?.setSelection(ids, { mode });
  }, []);

  return { source, selected, stats, error, setSelection };
}
