import { NextRequest, NextResponse } from 'next/server';
import { seedDirectory } from '@/lib/redis/directory';
import { fetchProfilesForDids } from '@/lib/bsky/api';
import type { JournalistEntry } from '@/lib/types';

/**
 * POST /api/directory/seed — Admin: bulk-seed journalists into Redis
 *
 * Protected by ADMIN_SECRET env var.
 * Body: JournalistEntry[]
 *
 * Automatically fetches Bluesky avatars for each journalist during seed.
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

  // Enrich entries with Bluesky avatars (batch resolve 25 at a time)
  const dids = entries.map(e => e.did).filter(Boolean);
  if (dids.length > 0) {
    try {
      const profiles = await fetchProfilesForDids(dids);
      const avatarMap = new Map<string, string>();
      for (const p of profiles) {
        if (p.avatar) avatarMap.set(p.did, p.avatar);
      }
      for (const entry of entries) {
        if (!entry.avatar && avatarMap.has(entry.did)) {
          entry.avatar = avatarMap.get(entry.did);
        }
      }
    } catch {
      // Non-fatal: seed without avatars if Bluesky API is unavailable
      console.warn('[seed] Failed to fetch avatars from Bluesky, seeding without them');
    }
  }

  const count = await seedDirectory(entries);

  return NextResponse.json({ seeded: count });
}
