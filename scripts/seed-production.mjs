#!/usr/bin/env node

/**
 * Seed the journalist directory on production.
 *
 * Usage:
 *   ADMIN_SECRET=overlap-admin-2026 node scripts/seed-production.mjs
 *   ADMIN_SECRET=overlap-admin-2026 BASE_URL=https://custom-domain.com node scripts/seed-production.mjs
 */

import { readFileSync } from 'fs';

const BASE_URL = process.env.BASE_URL || 'https://blueskyoverlap.vercel.app';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
  console.error('❌ Set ADMIN_SECRET env var');
  process.exit(1);
}

const directory = JSON.parse(readFileSync('data/journalist-directory.json', 'utf-8'));
console.log(`📋 Loaded ${directory.length} journalists from directory`);
console.log(`🌐 Seeding to ${BASE_URL}/api/directory/seed`);

const res = await fetch(`${BASE_URL}/api/directory/seed`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ADMIN_SECRET}`,
  },
  body: JSON.stringify(directory),
});

if (!res.ok) {
  const text = await res.text();
  console.error(`❌ Seed failed (${res.status}): ${text}`);
  process.exit(1);
}

const result = await res.json();
console.log(`✅ Seeded ${result.seeded} journalists into Redis`);
