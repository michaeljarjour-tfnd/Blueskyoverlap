'use client';

import { useEffect, useRef, useState } from 'react';
import type { JournalistEntry } from '@/lib/types';

interface SearchResult {
  results: JournalistEntry[];
  isSearching: boolean;
}

export function useDirectorySearch(query: string, options?: { limit?: number; debounceMs?: number }): SearchResult {
  const { limit = 8, debounceMs = 250 } = options ?? {};
  const [results, setResults] = useState<JournalistEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear previous debounce timer
    if (timerRef.current) clearTimeout(timerRef.current);

    // Too short — clear results immediately
    if (query.length < 2) {
      abortRef.current?.abort();
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    timerRef.current = setTimeout(async () => {
      // Abort any in-flight request
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const res = await fetch(
          `/api/directory/search?q=${encodeURIComponent(query)}&limit=${limit}`,
          { signal: ctrl.signal },
        );
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = await res.json();
        setResults(data.results ?? []);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setResults([]);
        }
      } finally {
        if (!ctrl.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, limit, debounceMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return { results, isSearching };
}
