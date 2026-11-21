import { useEffect, useState } from 'react';
import { api, filtersKey } from './api';

export function useApi(path, filters) {
  const key = `${path}?${filtersKey(filters)}`;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    let live = true;
    setLoading(true);
    setError('');
    api(path, filters, { signal: ac.signal })
      .then((d) => {
        if (!live) return;
        setData(d);
        setError('');
      })
      .catch((e) => {
        if (!live || e.name === 'AbortError') return;
        setError(String(e.message || e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      ac.abort();
    };
  }, [key]);

  return { data, error, loading };
}
