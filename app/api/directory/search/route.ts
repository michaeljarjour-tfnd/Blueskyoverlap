import { NextRequest, NextResponse } from 'next/server';
import { searchDirectory } from '@/lib/redis/directory';

/**
 * GET /api/directory/search?q=term&limit=8
 *
 * Text search across the journalist directory by handle or displayName.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || '';
  const limit = Math.min(20, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '8', 10)));

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const results = await searchDirectory(q, limit);

  return NextResponse.json(
    { results },
    { headers: { 'Cache-Control': 'private, max-age=5' } },
  );
}
