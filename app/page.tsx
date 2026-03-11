'use client';

import { useCallback, useRef, useState } from 'react';
import AnalysisForm from '@/components/AnalysisForm';
import ProgressPanel from '@/components/ProgressPanel';
import ResultsSection from '@/components/ResultsSection';
import type {
  AnalysisResult,
  BskyProfile,
  SseEvent,
  SpeedTier,
  ChunkedFetchPhase,
  FetchChunkResponse,
} from '@/lib/types';

// ── State machine ──────────────────────────────────────────────────────────────

type Phase = 'idle' | 'loading' | 'results' | 'error';

interface ProgressState {
  message: string;
  pct: number;
  followerProgress?: Record<string, { fetched: number; max: number }>;
  postProgress?: Record<string, { analyzed: number; total: number }>;
}

// ── Summary strip ──────────────────────────────────────────────────────────────

const TIER_LABELS: Record<SpeedTier, string> = {
  quick: 'Quick analysis',
  balanced: 'Balanced analysis',
  complete: 'Complete analysis',
};

function SummaryStrip({
  handles,
  speedTier,
  loading,
  onAction,
}: {
  handles: string[];
  speedTier: SpeedTier;
  loading: boolean;
  onAction: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 16px',
        background: '#fff',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        marginBottom: 16,
        flexWrap: 'wrap',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          color: 'var(--color-navy)',
        }}
      >
        {handles.map((h, i) => (
          <span key={h} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 500 }}>@{h}</span>
            {i < handles.length - 1 && (
              <span style={{ color: 'var(--color-text-faint)' }}>×</span>
            )}
          </span>
        ))}
        <span
          style={{
            marginLeft: 4,
            padding: '2px 7px',
            borderRadius: 3,
            background: '#EBF2FD',
            color: 'var(--color-blue)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.04em',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {TIER_LABELS[speedTier]}
        </span>
      </div>
      <button onClick={onAction} className="btn-ghost" style={{ marginTop: 0 }}>
        {loading ? 'Cancel' : 'New Analysis'}
      </button>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function Header() {
  return (
    <div
      style={{
        marginBottom: 48,
        paddingBottom: 32,
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {/* Trustfnd wordmark */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/trustfnd-logo.svg"
        alt="Trustfnd"
        style={{ height: 22, width: 'auto', marginBottom: 20, display: 'block' }}
      />
      <h1
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 42,
          fontWeight: 700,
          color: 'var(--color-navy)',
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
          margin: '0 0 10px',
        }}
      >
        Meet your Match
      </h1>
      <p
        style={{
          color: 'var(--color-text-muted)',
          fontSize: 15,
          maxWidth: 520,
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        Analyze how much your audience overlaps with another Bluesky user.
      </p>
    </div>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer
      style={{
        marginTop: 64,
        paddingTop: 24,
        borderTop: '1px solid var(--color-border)',
        textAlign: 'left',
      }}
    >
      <p
        style={{
          fontSize: 12,
          color: 'var(--color-text-faint)',
          margin: 0,
          lineHeight: 1.6,
        }}
      >
        Created by Trustfnd. Collaborative growth for independent journalism.
      </p>
    </footer>
  );
}

// ── Helper: sleep ─────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const CHUNK_MAX_RETRIES = 3;

/** Fetch a single chunk with retries on 500 errors. Throws on non-retryable errors. */
async function fetchChunkWithRetry(
  body: Record<string, unknown>,
  signal: AbortSignal
): Promise<FetchChunkResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < CHUNK_MAX_RETRIES; attempt++) {
    if (signal.aborted) throw new DOMException('Analysis cancelled', 'AbortError');

    try {
      const res = await fetch('/api/fetch-chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });

      if (res.ok) {
        return (await res.json()) as FetchChunkResponse;
      }

      // 4xx errors are not retryable (bad request, etc.)
      if (res.status >= 400 && res.status < 500) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `Chunk failed: ${res.statusText}`);
      }

      // 5xx errors — retry after a short delay
      lastError = new Error(`Server error ${res.status}`);
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      // Network errors (Vercel timeout, connection reset) — retryable
      lastError = err as Error;
    }

    if (attempt < CHUNK_MAX_RETRIES - 1) {
      await sleep(1000 * (attempt + 1));
    }
  }

  throw lastError ?? new Error('Chunk fetch failed after retries');
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<ProgressState>({ message: '', pct: 0 });
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeHandles, setActiveHandles] = useState<string[]>([]);
  const [activeSpeedTier, setActiveSpeedTier] = useState<SpeedTier>('quick');
  const [fetchPhase, setFetchPhase] = useState<ChunkedFetchPhase | undefined>(undefined);
  const [timeEstimate, setTimeEstimate] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchStartRef = useRef(0);

  // ── SSE-based submit (Quick / Balanced) ──────────────────────────────────

  const handleSseSubmit = useCallback(
    async (handles: string[], speedTier: SpeedTier, ctrl: AbortController) => {
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handles, speedTier, intent: 'general' }),
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`Server error: ${res.statusText}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let resultReceived = false;

        const readTimeout = setTimeout(() => {
          reader.cancel();
        }, 90_000);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6)) as SseEvent;

              if (event.type === 'progress') {
                setProgress({
                  message: event.message,
                  pct: event.pct,
                  followerProgress: event.followerProgress,
                  postProgress: event.postProgress,
                });
              } else if (event.type === 'result') {
                resultReceived = true;
                setResult(event.data);
                setPhase('results');
                reader.cancel();
              } else if (event.type === 'error') {
                resultReceived = true;
                setErrorMsg(event.message);
                setPhase('error');
                reader.cancel();
              }
            } catch {
              // Malformed JSON — skip
            }
          }
        }

        clearTimeout(readTimeout);

        if (!resultReceived) {
          setErrorMsg(
            'The analysis timed out. Try Quick or Balanced mode for large accounts — or just run it again. It picks up where it left off, so retries are much faster.'
          );
          setPhase('error');
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setErrorMsg((err as Error).message ?? 'Something went wrong');
          setPhase('error');
        }
      }
    },
    []
  );

  // ── Chunked submit (Complete) ────────────────────────────────────────────

  const handleChunkedSubmit = useCallback(
    async (handles: string[], ctrl: AbortController) => {
      try {
        // Phase 1: Resolve profiles
        setFetchPhase('profiles');
        setProgress({ message: 'Fetching profiles...', pct: 5 });

        const profileResponses = await Promise.all(
          handles.map((h) =>
            fetch(`/api/profile?handle=${encodeURIComponent(h)}`, {
              signal: ctrl.signal,
            }).then((r) => r.json())
          )
        );

        const profiles: BskyProfile[] = profileResponses.map((r) => r.profile ?? r);
        const dids = profiles.map((p) => p.did);

        if (profiles.some((p) => !p.did)) {
          throw new Error('Failed to resolve one or more profiles');
        }

        // Initialize progress state
        const folProgress: Record<string, { fetched: number; max: number }> = {};
        const postProgress: Record<string, { analyzed: number; total: number }> = {};
        for (const p of profiles) {
          folProgress[p.did] = { fetched: 0, max: p.followersCount ?? 1 };
          postProgress[p.did] = { analyzed: 0, total: 60 };
        }
        setProgress({ message: '', pct: 10, followerProgress: folProgress, postProgress });

        fetchStartRef.current = Date.now();
        let totalFetchedSoFar = 0;
        const totalNeeded = profiles.reduce((s, p) => s + (p.followersCount ?? 0), 0);

        // Phase 2: Fetch followers (chunked, sequential per account)
        setFetchPhase('followers');

        for (let i = 0; i < dids.length; i++) {
          if (ctrl.signal.aborted) return;
          const did = dids[i];
          const totalFollowers = profiles[i].followersCount ?? 0;

          while (true) {
            if (ctrl.signal.aborted) return;

            const chunk = await fetchChunkWithRetry({
              did,
              tier: 'complete',
              dataType: 'followers',
              totalFollowers,
            }, ctrl.signal);

            // Update progress
            folProgress[did] = { fetched: chunk.fetched, max: chunk.total || totalFollowers };
            totalFetchedSoFar = Object.values(folProgress).reduce((s, v) => s + v.fetched, 0);

            // Time estimate
            const elapsed = (Date.now() - fetchStartRef.current) / 1000;
            if (totalFetchedSoFar > 0 && elapsed > 2) {
              const rate = totalFetchedSoFar / elapsed;
              const remaining = Math.max(0, totalNeeded - totalFetchedSoFar) / rate;
              setTimeEstimate(remaining);
            }

            const overallPct = 10 + Math.floor((totalFetchedSoFar / Math.max(totalNeeded, 1)) * 60);
            setProgress((prev) => ({
              ...prev,
              pct: Math.min(overallPct, 70),
              followerProgress: { ...folProgress },
            }));

            if (chunk.status === 'complete' || chunk.status === 'cached') break;

            // Poll delay
            await sleep(300);
          }
        }

        // Phase 3: Fetch engagement (chunked, sequential per account)
        setFetchPhase('engagement');
        setTimeEstimate(null);

        for (let i = 0; i < dids.length; i++) {
          if (ctrl.signal.aborted) return;
          const did = dids[i];

          while (true) {
            if (ctrl.signal.aborted) return;

            const chunk = await fetchChunkWithRetry({
              did,
              tier: 'complete',
              dataType: 'engagement',
              maxPosts: 60,
            }, ctrl.signal);

            postProgress[did] = { analyzed: chunk.fetched, total: chunk.total || 60 };
            const postDone = Object.values(postProgress).reduce((s, v) => s + v.analyzed, 0);
            const postTotal = Object.values(postProgress).reduce((s, v) => s + v.total, 0);
            const engPct = postTotal > 0 ? 70 + Math.floor((postDone / postTotal) * 15) : 75;
            setProgress((prev) => ({
              ...prev,
              pct: Math.min(engPct, 85),
              postProgress: { ...postProgress },
            }));

            if (chunk.status === 'complete' || chunk.status === 'cached') break;

            await sleep(300);
          }
        }

        // Phase 4: Compute overlaps
        setFetchPhase('computing');
        setTimeEstimate(null);
        setProgress((prev) => ({ ...prev, pct: 90 }));

        const computeRes = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            handles,
            speedTier: 'complete',
            intent: 'general',
            prefetched: true,
            dids,
            profiles,
          }),
          signal: ctrl.signal,
        });

        if (!computeRes.ok) {
          const err = await computeRes.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error ?? 'Compute failed');
        }

        const analysisResult = (await computeRes.json()) as AnalysisResult;
        setResult(analysisResult);
        setPhase('results');
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setErrorMsg((err as Error).message ?? 'Something went wrong');
          setPhase('error');
        }
      }
    },
    []
  );

  // ── Unified submit handler ───────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (handles: string[], speedTier: SpeedTier) => {
      abortRef.current?.abort();
      setActiveHandles(handles);
      setActiveSpeedTier(speedTier);
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setPhase('loading');
      setProgress({ message: 'Starting…', pct: 0 });
      setResult(null);
      setErrorMsg(null);
      setFetchPhase(undefined);
      setTimeEstimate(null);

      if (speedTier === 'complete') {
        await handleChunkedSubmit(handles, ctrl);
      } else {
        await handleSseSubmit(handles, speedTier, ctrl);
      }
    },
    [handleSseSubmit, handleChunkedSubmit]
  );

  const handleReset = () => {
    abortRef.current?.abort();
    setPhase('idle');
    setResult(null);
    setErrorMsg(null);
    setProgress({ message: '', pct: 0 });
    setFetchPhase(undefined);
    setTimeEstimate(null);
  };

  return (
    <main
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '32px 20px 64px',
      }}
    >
      <Header />

      {/* Form — shown only when idle */}
      {phase === 'idle' && (
        <AnalysisForm onSubmit={handleSubmit} loading={false} />
      )}

      {/* Summary strip — shown during loading and results */}
      {(phase === 'loading' || phase === 'results') && (
        <SummaryStrip
          handles={activeHandles}
          speedTier={activeSpeedTier}
          loading={phase === 'loading'}
          onAction={handleReset}
        />
      )}

      {/* Progress */}
      {phase === 'loading' && (
        <ProgressPanel
          pct={progress.pct}
          message={progress.message}
          followerProgress={progress.followerProgress}
          postProgress={progress.postProgress}
          speedTier={activeSpeedTier}
          fetchPhase={fetchPhase}
        />
      )}

      {/* Error */}
      {phase === 'error' && (
        <div className="alert alert-error">
          <strong>Error:</strong> {errorMsg}
          <div style={{ marginTop: 12 }}>
            <button onClick={handleReset} className="btn-ghost">
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {phase === 'results' && result && (
        <ResultsSection result={result} mode="live" />
      )}

      <Footer />
    </main>
  );
}
