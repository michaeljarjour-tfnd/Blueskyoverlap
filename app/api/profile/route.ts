import { NextRequest } from 'next/server';
import { getProfile, extractHandle } from '@/lib/bsky/api';
import { isCached } from '@/lib/redis/followers';
import type { SpeedTier } from '@/lib/types';

export async function GET(req: NextRequest) {
  const handle = req.nextUrl.searchParams.get('handle');
  if (!handle) {
    return Response.json({ error: 'handle is required' }, { status: 400 });
  }

  try {
    const profile = await getProfile(extractHandle(handle));
    const tier = (req.nextUrl.searchParams.get('tier') ?? 'quick') as SpeedTier;
    const cached = await isCached(profile.did, tier);

    return Response.json({ profile, cached });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message ?? 'Could not fetch profile' },
      { status: 404 }
    );
  }
}
