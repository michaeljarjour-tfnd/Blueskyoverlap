'use client';

import ResultsSection from '@/components/ResultsSection';
import type { AnalysisResult } from '@/lib/types';

interface Props {
  result: AnalysisResult;
  createdAt: string;
}

export default function ReportClient({ result, createdAt }: Props) {
  const date = new Date(createdAt);
  const formattedDate = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <main
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '32px 20px 64px',
      }}
    >
      {/* Header */}
      <div
        style={{
          marginBottom: 48,
          paddingBottom: 32,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/trustfnd-logo.svg"
          alt="Trustfnd"
          style={{ height: 22, width: 'auto', marginBottom: 20, display: 'block' }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <h1
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 28,
                fontWeight: 700,
                color: 'var(--color-navy)',
                lineHeight: 1.2,
                letterSpacing: '-0.02em',
                margin: 0,
              }}
            >
              Saved Report
            </h1>
            <p
              style={{
                color: 'var(--color-text-muted)',
                fontSize: 13,
                margin: '6px 0 0',
              }}
            >
              Created {formattedDate}
            </p>
          </div>
          <a
            href="/"
            style={{
              padding: '8px 16px',
              border: '1px solid var(--color-border)',
              borderRadius: 5,
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--color-navy)',
              textDecoration: 'none',
              background: '#fff',
            }}
          >
            New Analysis
          </a>
        </div>
      </div>

      {/* Results */}
      <ResultsSection result={result} mode="saved" />

      {/* Footer */}
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
    </main>
  );
}
