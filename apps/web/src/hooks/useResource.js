import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
export function useResource(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(path));
  const [settledPath, setSettledPath] = useState(null);
  const sequence = useRef(0);
  const controller = useRef(null);
  const latestPath = useRef(path);
  latestPath.current = path;
  const refresh = useCallback(async () => {
    // A mutation can finish after its initiating filters changed. Its old refresh
    // must not abort the current page request and leave settledPath stranded.
    if (path !== latestPath.current) return null;
    const version = ++sequence.current;
    controller.current?.abort();
    if (!path) {
      setData(null);
      setSettledPath(null);
      setLoading(false);
      return null;
    }
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    try {
      setError('');
      const value = await api(path, { signal: request.signal });
      if (version === sequence.current) {
        setData(value);
        setSettledPath(path);
      }
      return value;
    } catch (err) {
      if (version === sequence.current && err.name !== 'AbortError') {
        setError(err.message);
        setSettledPath(path);
      }
    } finally {
      if (version === sequence.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    setLoading(true);
    refresh();
    return () => {
      controller.current?.abort();
    };
  }, [refresh]);
  return {
    data: settledPath === path ? data : null,
    error: settledPath === path ? error : '',
    loading: settledPath === path ? loading : Boolean(path),
    refresh,
  };
}
