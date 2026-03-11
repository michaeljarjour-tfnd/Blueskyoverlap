import type { Metadata } from 'next';
import { getRedis } from '@/lib/redis/client';
import type { SavedReport } from '@/lib/types';
import { formatFollowers } from '@/lib/analysis/interpret';
import ReportClient from './ReportClient';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getReport(id: string): Promise<SavedReport | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(`report:${id}`);
    if (!raw) return null;
    // Upstash may auto-deserialize JSON strings
    if (typeof raw === 'object') return raw as unknown as SavedReport;
    return JSON.parse(raw as string) as SavedReport;
  } catch {
    return null;
  }
}

// ── Dynamic OG metadata ─────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const report = await getReport(id);

  if (!report) {
    return {
      title: 'Report Not Found — Trustfnd',
      description: 'This report has expired or does not exist.',
    };
  }

  const { result } = report;
  const names = result.profiles.map((p) => p.displayName || `@${p.handle}`);
  const title = names.length <= 3
    ? `${names.join(' × ')} — Audience Overlap`
    : `${names.slice(0, 2).join(' × ')} +${names.length - 2} — Audience Overlap`;

  // Pick the first pair for the description
  const firstPair = result.pairwiseOverlaps[0];
  let description = 'Bluesky audience overlap analysis by Trustfnd';
  if (firstPair) {
    const sim = firstPair.followerJaccard.toFixed(1);
    const shared = formatFollowers(firstPair.followerOverlap);
    description = `${sim}% follower similarity, ${shared} shared followers`;
  }

  return {
    title: `${title} — Trustfnd`,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
    },
  };
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const report = await getReport(id);

  if (!report) {
    return (
      <main
        style={{
          maxWidth: 760,
          margin: '0 auto',
          padding: '64px 20px',
          textAlign: 'center',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/trustfnd-logo.svg"
          alt="Trustfnd"
          style={{ height: 22, width: 'auto', marginBottom: 32, display: 'inline-block' }}
        />
        <h1
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 28,
            fontWeight: 700,
            color: 'var(--color-navy)',
            marginBottom: 12,
          }}
        >
          Report not found
        </h1>
        <p
          style={{
            color: 'var(--color-text-muted)',
            fontSize: 15,
            lineHeight: 1.6,
            marginBottom: 32,
          }}
        >
          This report has expired or doesn&apos;t exist. Reports are available for 30 days after creation.
        </p>
        <a
          href="/"
          style={{
            display: 'inline-block',
            padding: '10px 20px',
            background: 'var(--color-blue)',
            color: '#fff',
            borderRadius: 5,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Run New Analysis
        </a>
      </main>
    );
  }

  // Build a full AnalysisResult with empty overlapDetails (drill-down disabled)
  const fullResult = {
    ...report.result,
    overlapDetails: {} as Record<string, { followerDids: string[]; engagementDids: string[] }>,
  };

  return <ReportClient result={fullResult} createdAt={report.createdAt} />;
}
