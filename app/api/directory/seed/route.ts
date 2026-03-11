import { NextRequest, NextResponse } from 'next/server';
import { seedDirectory } from '@/lib/redis/directory';
import type { JournalistEntry } from '@/lib/types';

/**
 * POST /api/directory/seed — Admin: bulk-seed journalists into Redis
 *
 * Protected by ADMIN_SECRET env var.
 * Body: JournalistEntry[]
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const entries: JournalistEntry[] = await req.json();

  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json({ error: 'Body must be a non-empty array of JournalistEntry' }, { status: 400 });
  }

  const count = await seedDirectory(entries);

  return NextResponse.json({ seeded: count });
}
