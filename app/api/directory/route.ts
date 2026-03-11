import { NextRequest, NextResponse } from 'next/server';
import { getDirectoryEntries, getDirectoryStats } from '@/lib/redis/directory';

/**
 * GET /api/directory — Public: browse the journalist directory
 *
 * Query params:
 *   ?topic=Politics&geo=National - US&page=1&limit=20&stats=true
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // Stats-only mode
  if (searchParams.get('stats') === 'true') {
    const stats = await getDirectoryStats();
    return NextResponse.json(stats);
  }

  const topic = searchParams.get('topic') || undefined;
  const geography = searchParams.get('geo') || undefined;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
  const offset = (page - 1) * limit;

  const { entries, total } = await getDirectoryEntries({ topic, geography, limit, offset });

  return NextResponse.json({
    entries,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}
