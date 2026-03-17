import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { getRedis } from '@/lib/redis/client';
import type { AnalysisResult, SavedReport } from '@/lib/types';

const REPORT_TTL = 60 * 60 * 24 * 30; // 30 days

export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return Response.json(
      { error: 'Report saving is temporarily unavailable' },
      { status: 503 }
    );
  }

  try {
    const body = (await req.json()) as AnalysisResult;

    if (!body.profiles || !body.pairwiseOverlaps) {
      return Response.json(
        { error: 'Invalid report data' },
        { status: 400 }
      );
    }

    const reportId = nanoid(8);

    const saved: SavedReport = {
      reportId,
      createdAt: new Date().toISOString(),
      result: body,
    };

    await redis.set(`report:${reportId}`, JSON.stringify(saved), { ex: REPORT_TTL });

    // Build the URL from the request origin
    const origin = req.headers.get('x-forwarded-host')
      ? `https://${req.headers.get('x-forwarded-host')}`
      : req.nextUrl.origin;

    return Response.json({
      id: reportId,
      url: `${origin}/report/${reportId}`,
    });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message ?? 'Failed to save report' },
      { status: 500 }
    );
  }
}
