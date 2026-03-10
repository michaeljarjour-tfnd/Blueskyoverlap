import { NextRequest } from 'next/server';
import { getRedis } from '@/lib/redis/client';
import { fetchProfilesForDids } from '@/lib/bsky/api';

/**
 * Returns enriched profiles for an overlap sample, used by the drill-down modal.
 * The frontend passes the raw DID array in the request body (stored in its local state).
 */
export async function POST(req: NextRequest) {
  const { dids } = (await req.json()) as { dids: string[] };

  if (!Array.isArray(dids) || dids.length === 0) {
    return Response.json({ profiles: [], total: 0 });
  }

  const sample = dids.slice(0, 500); // Never resolve more than 500

  try {
    const profiles = await fetchProfilesForDids(sample);
    // Sort by follower count descending
    profiles.sort((a, b) => (b.followersCount ?? 0) - (a.followersCount ?? 0));

    return Response.json({ profiles, total: dids.length });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
