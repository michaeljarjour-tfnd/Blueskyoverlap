'use client';

import { useCallback, useRef, useState } from 'react';
import AnalysisForm from '@/components/AnalysisForm';
import ProgressPanel from '@/components/ProgressPanel';
import ResultsSection from '@/components/ResultsSection';
import type {
  AnalysisResult,
  SseEvent,
  SpeedTier,
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<ProgressState>({ message: '', pct: 0 });
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeHandles, setActiveHandles] = useState<string[]>([]);
  const [activeSpeedTier, setActiveSpeedTier] = useState<SpeedTier>('quick');
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = useCallback(
    async (handles: string[], speedTier: SpeedTier) => {
      // Abort any in-flight request
      abortRef.current?.abort();
      setActiveHandles(handles);
      setActiveSpeedTier(speedTier);
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setPhase('loading');
      setProgress({ message: 'Starting…', pct: 0 });
      setResult(null);
      setErrorMsg(null);

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
                setResult(event.data);
                setPhase('results');
              } else if (event.type === 'error') {
                setErrorMsg(event.message);
                setPhase('error');
              }
            } catch {
              // Malformed JSON — skip
            }
          }
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

  const handleReset = () => {
    abortRef.current?.abort();
    setPhase('idle');
    setResult(null);
    setErrorMsg(null);
    setProgress({ message: '', pct: 0 });
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
        <ResultsSection result={result} />
      )}

      <Footer />
    </main>
  );
}
