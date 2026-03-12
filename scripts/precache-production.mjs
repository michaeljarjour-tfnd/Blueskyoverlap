#!/usr/bin/env node

/**
 * Run the precache endpoint repeatedly until all journalists have cached followers.
 * Each call processes as many journalists as it can within the time budget (~50s).
 *
 * Usage:
 *   ADMIN_SECRET=overlap-admin-2026 node scripts/precache-production.mjs
 *   ADMIN_SECRET=overlap-admin-2026 BASE_URL=https://custom-domain.com node scripts/precache-production.mjs
 */

const BASE_URL = process.env.BASE_URL || 'https://blueskyoverlap.vercel.app';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
  console.error('❌ Set ADMIN_SECRET env var');
  process.exit(1);
}

let round = 0;

while (true) {
  round++;
  console.log(`\n🔄 Precache round ${round}...`);
  console.log(`   ${BASE_URL}/api/directory/precache`);

  try {
    const res = await fetch(`${BASE_URL}/api/directory/precache`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_SECRET}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`❌ Precache failed (${res.status}): ${text}`);
      // Don't exit — maybe a transient error. Wait and retry.
      console.log('   Waiting 10s before retry...');
      await new Promise((r) => setTimeout(r, 10_000));
      continue;
    }

    const result = await res.json();
    console.log(`   ✅ Processed: ${result.processed ?? '?'}`);
    console.log(`   📊 Remaining: ${result.remaining ?? '?'}`);

    if (result.remaining === 0 || result.done) {
      console.log('\n🎉 All journalists precached!');
      break;
    }

    // Brief pause between rounds to be nice to the server
    console.log('   Waiting 5s before next round...');
    await new Promise((r) => setTimeout(r, 5_000));
  } catch (err) {
    console.error(`❌ Network error: ${err.message}`);
    console.log('   Waiting 10s before retry...');
    await new Promise((r) => setTimeout(r, 10_000));
  }
}
