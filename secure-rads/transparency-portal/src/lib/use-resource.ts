import { useCallback, useEffect, useState } from "react";

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function useResource<T>(loader: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<ResourceState<T>>({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setState((current) => ({ ...current, loading: true }));
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    loader()
      .then((data) => {
        if (active) setState({ data, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (active) {
          setState({ data: null, error: err instanceof Error ? err.message : String(err), loading: false });
        }
      });
    return () => {
      active = false;
    };
  }, [loader, nonce]);

  return { ...state, reload };
}
