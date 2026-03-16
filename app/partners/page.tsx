'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatFollowers } from '@/lib/analysis/interpret';
import { VennDiagram, MiniVennSvg, ACCOUNT_COLORS, fmt } from '@/components/CollaborationVenn';
import type { OverlapData } from '@/components/CollaborationVenn';

// ── Types ────────────────────────────────────────────────────────────────────

interface MatchInfo {
  did: string;
  handle: string;
  displayName: string;
  avatar?: string;
  geography?: string;
  followerCount: number;
}

interface TrioRecommendation {
  matchA: MatchInfo;
  matchB: MatchInfo;
  overlaps: {
    userA: number;
    userB: number;
    ab: number;
    threeWay: number;
  };
  sizes: {
    user: number;
    a: number;
    b: number;
  };
  totalReach: number;
  newAudienceForUser: number;
  newAudienceForA: number;
  newAudienceForB: number;
  trioScore: number;
  overlapLevel: 'high' | 'medium' | 'low';
  signals: {
    sizeMatch: boolean;
    topicMatch: boolean;
    geoMatch: boolean;
  };
}

interface PairRecommendation {
  match: MatchInfo;
  overlap: number;
  sizes: { user: number; match: number };
  totalReach: number;
  newAudienceForUser: number;
  newAudienceForMatch: number;
  pairScore: number;
  overlapLevel: 'high' | 'medium' | 'low';
  signals: {
    sizeMatch: boolean;
    topicMatch: boolean;
    geoMatch: boolean;
  };
}

type MatchMode = 'trio' | 'pair';

interface UserInfo {
  did: string;
  handle: string;
  followerCount: number;
  avatar?: string;
  sampleSize?: number;
}

interface APIResponse {
  mode: MatchMode;
  user: UserInfo;
  trios?: TrioRecommendation[];
  pairs?: PairRecommendation[];
  totalJournalists: number;
  comparedCount: number;
}

interface NoCacheResponse {
  error: 'no_cache';
  user: { did: string; handle: string; followerCount: number };
}

interface DirectoryStats {
  totalJournalists: number;
  topics: string[];
  geographies: string[];
}

type Phase = 'idle' | 'loading' | 'results' | 'error' | 'no-cache';

// ── Topic clustering ────────────────────────────────────────────────────────

const TOPIC_CLUSTERS: Record<string, string[]> = {
  'Politics': ['Politics', 'Government Accountability', 'Policy'],
  'National Security': ['National Security', 'Foreign Policy'],
  'Immigration': ['Immigration'],
  'Labor & Economy': ['Labor', 'Finance/Economics', 'Business', 'Careers', 'Energy', 'Construction'],
  'Criminal Justice': ['Criminal Justice', 'Crime', 'Law/Legal Issues'],
  'Tech': ['Tech', 'Internet Culture', 'Games/Gaming', 'AI', 'Artificial Intelligence', 'Cybersecurity', 'Startups', 'Crypto', 'Social Media', 'Software', 'Apps'],
  'Science': ['Science', 'Space', 'Astronomy', 'Biology', 'Physics', 'Research'],
  'Data & OSINT': ['Data Visualization', 'Data', 'Charts', 'Infographics', 'Data Journalism', 'OSINT', 'Open Source Intelligence', 'Verification', 'Fact-Checking', 'Disinformation', 'Geolocation'],
  'Entertainment': ['Entertainment/Hollywood', 'Film/Movies', 'Music', 'Comedy', 'Gossip'],
  'Books & Writing': ['Books/Writing', 'Art', 'Photography', 'Design'],
  'Fashion & Style': ['Fashion', 'Culture'],
  'Health': ['Health/Wellness', 'Mental Health', 'Fitness', 'Running', 'Cancer', 'Diabetes', 'Medical', 'Disability', 'Reproductive Health', 'Public Health', 'Pandemic', 'COVID', 'Nursing', 'Healthcare', 'Drug Policy', 'Addiction', 'Aging'],
  'Parenting & Family': ['Parenting', 'Family', 'Lifestyle', 'Self Help', 'Dating/Romance'],
  'Food': ['Food', 'Restaurants', 'Recipes', 'Bars'],
  'Travel & Outdoors': ['Travel', 'Things to do', 'Things to Do', 'Outdoors'],
  'Climate & Environment': ['Climate/Environment', 'Agriculture', 'Animals', 'Weather', 'Sustainability', 'Conservation', 'Wildlife', 'Oceans'],
  'Social Justice': ['Identity/Belonging', 'Inequality', 'Gender', 'LGBTQIA', 'Activism', 'Human Rights'],
  'Faith & Religion': ['Faith/Religion'],
  'Investigative': ['Investigative'],
  'World News': ['World', 'General News', 'Explanatory', 'History', 'Media/Power', 'Solutions Journalism', 'Positive News', 'Positive news'],
  'Local News': ['Local', 'Local News', 'Local news', 'Urban planning', 'Transit/Transportation'],
  'Sports': ['Sports', 'NBA', 'NFL', 'MLB', 'Soccer', 'Football', 'Basketball', 'Baseball', 'Hockey', 'Tennis', 'Olympics', 'Esports'],
  'Education': ['Education', 'Higher Education', 'K-12', 'Teachers', 'Universities', 'Students'],
  'Personal Finance': ['Personal Finance', 'Real Estate'],
};

/** Map raw directory topics to consolidated cluster names. */
function consolidateTopics(rawTopics: string[]): string[] {
  const clusters = new Set<string>();
  for (const raw of rawTopics) {
    let matched = false;
    for (const [cluster, members] of Object.entries(TOPIC_CLUSTERS)) {
      if (members.some(m => m.toLowerCase() === raw.toLowerCase())) {
        clusters.add(cluster);
        matched = true;
        break;
      }
    }
    if (!matched) clusters.add(raw); // Keep unclustered topics as-is
  }
  return Array.from(clusters).sort();
}

// ── Geography consolidation (client-side, mirrors API logic) ────────────────

function consolidateGeographies(rawGeos: string[]): string[] {
  const regions = new Set<string>();
  for (const raw of rawGeos) {
    const region = consolidateGeo(raw);
    if (region) regions.add(region);
  }
  return Array.from(regions).sort();
}

function consolidateGeo(raw: string): string {
  const lower = raw.toLowerCase().trim();

  // North America: US (any format), Canada, Mexico
  if (lower.includes('national') && lower.includes('us')) return 'North America';
  if (lower.includes('d.c.') || lower.includes('washington, dc')) return 'North America';
  if (lower.match(/,\s*[a-z]{2}$/)) return 'North America'; // "City, ST" format
  if (lower.match(/^.+?\s*-\s*us$/)) return 'North America'; // "State - US" format
  if (lower.includes('canada') || lower.includes('mexico')) return 'North America';
  if (lower === 'us' || lower === 'usa' || lower === 'united states') return 'North America';

  // Europe
  if (lower.includes('united kingdom') || lower.includes('uk') || lower.includes('england')) return 'Europe';
  if (lower.includes('france') || lower.includes('germany') || lower.includes('spain')) return 'Europe';
  if (lower.includes('italy') || lower.includes('netherlands') || lower.includes('ireland')) return 'Europe';
  if (lower.includes('sweden') || lower.includes('norway') || lower.includes('denmark')) return 'Europe';
  if (lower.includes('portugal') || lower.includes('belgium') || lower.includes('switzerland')) return 'Europe';
  if (lower.includes('poland') || lower.includes('austria') || lower.includes('greece')) return 'Europe';

  // Oceania
  if (lower.includes('australia') || lower.includes('new zealand')) return 'Oceania';

  // Asia
  if (lower.includes('japan') || lower.includes('china') || lower.includes('india')) return 'Asia';
  if (lower.includes('korea') || lower.includes('singapore') || lower.includes('hong kong')) return 'Asia';

  // South America
  if (lower.includes('brazil') || lower.includes('argentina') || lower.includes('colombia')) return 'South America';

  // Africa
  if (lower.includes('south africa') || lower.includes('nigeria') || lower.includes('kenya')) return 'Africa';

  if (lower === 'international') return 'International';

  return raw;
}

/** Normalize user-typed geography to continent. */
function normalizeUserGeo(input: string): string {
  const lower = input.toLowerCase().trim();
  if (!lower) return '';

  const continentMap: Record<string, string> = {
    // North America
    'new york': 'North America', 'nyc': 'North America', 'manhattan': 'North America',
    'brooklyn': 'North America', 'boston': 'North America', 'philly': 'North America',
    'philadelphia': 'North America', 'pittsburgh': 'North America',
    'dc': 'North America', 'washington dc': 'North America',
    'washington d.c.': 'North America', 'washington': 'North America',
    'la': 'North America', 'los angeles': 'North America', 'san francisco': 'North America',
    'sf': 'North America', 'seattle': 'North America', 'portland': 'North America',
    'san diego': 'North America', 'denver': 'North America', 'las vegas': 'North America',
    'chicago': 'North America', 'detroit': 'North America', 'minneapolis': 'North America',
    'miami': 'North America', 'atlanta': 'North America', 'charlotte': 'North America',
    'nashville': 'North America', 'raleigh': 'North America',
    'dallas': 'North America', 'houston': 'North America', 'austin': 'North America',
    'san antonio': 'North America', 'phoenix': 'North America',
    'us': 'North America', 'usa': 'North America', 'united states': 'North America',
    'america': 'North America', 'canada': 'North America', 'toronto': 'North America',
    'vancouver': 'North America', 'montreal': 'North America', 'mexico': 'North America',
    // Europe
    'london': 'Europe', 'uk': 'Europe', 'england': 'Europe', 'united kingdom': 'Europe',
    'paris': 'Europe', 'france': 'Europe', 'berlin': 'Europe', 'munich': 'Europe',
    'germany': 'Europe', 'spain': 'Europe', 'italy': 'Europe', 'netherlands': 'Europe',
    'ireland': 'Europe', 'scotland': 'Europe', 'sweden': 'Europe',
    // Oceania
    'sydney': 'Oceania', 'melbourne': 'Oceania', 'australia': 'Oceania',
    'new zealand': 'Oceania', 'auckland': 'Oceania',
    // Asia
    'tokyo': 'Asia', 'japan': 'Asia', 'india': 'Asia', 'singapore': 'Asia',
    'hong kong': 'Asia', 'korea': 'Asia', 'china': 'Asia',
    // South America
    'brazil': 'South America', 'argentina': 'South America', 'colombia': 'South America',
    // Africa
    'south africa': 'Africa', 'nigeria': 'Africa', 'kenya': 'Africa',
  };

  if (continentMap[lower]) return continentMap[lower];

  // Check if it's already a valid continent
  const validContinents = ['North America', 'South America', 'Europe', 'Asia', 'Oceania', 'Africa', 'International'];
  if (validContinents.includes(input)) return input;

  // Try consolidateGeo for anything else
  const consolidated = consolidateGeo(input);
  if (consolidated !== input) return consolidated;

  return input;
}

// ── Loading animation (verb wheel — matches analysis page) ─────────────────

const PROGRESS_WORDS = [
  'Fetching', 'Indexing', 'Comparing', 'Scanning', 'Loading',
  'Processing', 'Computing', 'Connecting', 'Counting', 'Querying',
  'Crosschecking', 'Triangulating', 'Crunching', 'Mapping',
  'Perusing', 'Tallying', 'Calculating', 'Investigating',
  'Surveying', 'Decoding', 'Assembling', 'Checking', 'Finding',
  'Grinding', 'Sleuthing', 'Researching', 'Unraveling', 'Deliberating',
  'Hacking', 'Figuring', 'Spelunking', 'Networking', 'Ruminating',
  'Calibrating', 'Extrapolating', 'Correlating', 'Tabulating', 'Synthesizing',
  'Reconciling', 'Interpolating', 'Aggregating', 'Enumerating', 'Deduplicating',
  'Normalizing', 'Quantifying', 'Classifying', 'Disambiguating', 'Partitioning',
  'Scrutinizing', 'Unspooling', 'Verifying', 'Advancing',
];

const STAR_FRAMES = ['·', '*', '✶', '✺', '✶', '*', '·'];

function shuffleDeck(exclude?: string): string[] {
  const deck = [...PROGRESS_WORDS];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  if (exclude && deck[0] === exclude) {
    const swap = Math.floor(Math.random() * (deck.length - 1)) + 1;
    [deck[0], deck[swap]] = [deck[swap], deck[0]];
  }
  return deck;
}

function VerbWheel({ active }: { active: boolean }) {
  const [displayWord, setDisplayWord] = useState('Scanning');
  const [typedChars, setTypedChars] = useState(0);
  const [starIdx, setStarIdx] = useState(0);
  const [pct, setPct] = useState(0);
  const deckRef = useRef<string[]>([]);
  const lastWordRef = useRef<string>('');

  // Verb cycling
  useEffect(() => {
    if (!active) return;
    const nextWord = () => {
      if (!deckRef.current.length) {
        deckRef.current = shuffleDeck(lastWordRef.current);
      }
      const word = deckRef.current.shift()!;
      lastWordRef.current = word;
      setDisplayWord(word);
      setTypedChars(0);
      setStarIdx(0);
    };
    nextWord();
    const id = setInterval(nextWord, 1800);
    return () => clearInterval(id);
  }, [active]);

  // Typewriter
  useEffect(() => {
    const targetLen = displayWord.length + 3;
    if (typedChars >= targetLen) return;
    const timeout = setTimeout(() => setTypedChars(c => c + 1), 40);
    return () => clearTimeout(timeout);
  }, [typedChars, displayWord]);

  // Star spinner
  useEffect(() => {
    const id = setInterval(() => setStarIdx(i => (i + 1) % STAR_FRAMES.length), 500);
    return () => clearInterval(id);
  }, []);

  // Fake progress bar — moves quickly at first, slows down
  useEffect(() => {
    if (!active) { setPct(0); return; }
    const id = setInterval(() => {
      setPct(prev => {
        if (prev >= 90) return prev + 0.1;
        if (prev >= 70) return prev + 0.3;
        if (prev >= 40) return prev + 0.8;
        return prev + 2;
      });
    }, 200);
    return () => clearInterval(id);
  }, [active]);

  const visibleText = (displayWord + '...').slice(0, typedChars);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--color-blue)', letterSpacing: '-0.01em' }}>
          {STAR_FRAMES[starIdx]}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--color-navy)', minWidth: 200 }}>
          {visibleText}
        </span>
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-faint)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
          <span>Finding matches</span>
        </div>
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: `${Math.min(pct, 95)}%` }} />
        </div>
      </div>
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function Header() {
  return (
    <div style={{ marginBottom: 48, paddingBottom: 32, borderBottom: '1px solid var(--color-border)' }}>
      {/* Logo + tagline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/trustfnd-logo.svg" alt="Trustfnd" style={{ height: 22, width: 'auto' }} />
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Meet Your Match</span>
      </div>
      <h1 style={{
        fontFamily: 'var(--font-sans)', fontSize: 42, fontWeight: 700,
        color: 'var(--color-navy)', lineHeight: 1.15, letterSpacing: '-0.02em', margin: '0 0 10px',
      }}>
        Collaborator Matches
      </h1>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 15, maxWidth: 540, lineHeight: 1.6, margin: 0 }}>
        Find matching collaborators based on your Bluesky audiences.
      </p>
      <a
        href="/"
        style={{
          display: 'inline-block',
          marginTop: 14,
          fontSize: 13,
          color: 'var(--color-blue)',
          textDecoration: 'none',
          fontWeight: 500,
        }}
      >
        Select accounts to analyze →
      </a>
    </div>
  );
}

// ── Footer ──────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer style={{
      marginTop: 64, paddingTop: 32, borderTop: '1px solid var(--color-border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16,
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/trustfnd-wordmark-red.svg" alt="Trustfnd" style={{ height: 28, width: 'auto' }} />
      <div style={{ display: 'flex', gap: 24 }}>
        <a href="https://trustfnd.com/terms-and-privacy" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 13, color: 'var(--color-text-muted)', textDecoration: 'none' }}>
          Terms of Service
        </a>
        <a href="https://trustfnd.com/terms-and-privacy" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 13, color: 'var(--color-text-muted)', textDecoration: 'none' }}>
          Privacy Policy
        </a>
      </div>
    </footer>
  );
}

// ── Signal badge ─────────────────────────────────────────────────────────────

function SignalBadge({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 3,
      fontSize: 10, fontWeight: 500, background: '#EBF2FD', color: 'var(--color-blue)', marginRight: 4,
    }}>
      {label}
    </span>
  );
}

// ── Venn data adapters ───────────────────────────────────────────────────────

function trioToOverlapData(trio: TrioRecommendation, userHandle: string): OverlapData {
  const overlaps = trio.overlaps ?? { userA: 0, userB: 0, ab: 0, threeWay: 0 };
  const sizes = trio.sizes ?? { user: 0, a: 0, b: 0 };
  const totalFollowers = sizes.user + sizes.a + sizes.b;
  return {
    accounts: [
      { handle: userHandle, displayName: userHandle, followerCount: sizes.user },
      { handle: trio.matchA.handle, displayName: trio.matchA.displayName || trio.matchA.handle, followerCount: sizes.a },
      { handle: trio.matchB.handle, displayName: trio.matchB.displayName || trio.matchB.handle, followerCount: sizes.b },
    ],
    pairwiseOverlap: [
      { handleA: userHandle, handleB: trio.matchA.handle, sharedFollowers: overlaps.userA, jaccardSimilarity: (sizes.user + sizes.a) > overlaps.userA ? overlaps.userA / (sizes.user + sizes.a - overlaps.userA) : 0 },
      { handleA: userHandle, handleB: trio.matchB.handle, sharedFollowers: overlaps.userB, jaccardSimilarity: (sizes.user + sizes.b) > overlaps.userB ? overlaps.userB / (sizes.user + sizes.b - overlaps.userB) : 0 },
      { handleA: trio.matchA.handle, handleB: trio.matchB.handle, sharedFollowers: overlaps.ab, jaccardSimilarity: (sizes.a + sizes.b) > overlaps.ab ? overlaps.ab / (sizes.a + sizes.b - overlaps.ab) : 0 },
    ],
    tripleOverlap: overlaps.threeWay,
    uniqueReach: trio.totalReach,
    totalFollowers,
    homogeneityScore: totalFollowers > 0 ? 1 - (trio.totalReach / totalFollowers) : 0,
  };
}

function pairToPartnerOverlapData(pair: PairRecommendation, userHandle: string): OverlapData {
  const totalFollowers = pair.sizes.user + pair.sizes.match;
  return {
    accounts: [
      { handle: userHandle, displayName: userHandle, followerCount: pair.sizes.user },
      { handle: pair.match.handle, displayName: pair.match.displayName || pair.match.handle, followerCount: pair.sizes.match },
    ],
    pairwiseOverlap: [{
      handleA: userHandle,
      handleB: pair.match.handle,
      sharedFollowers: pair.overlap,
      jaccardSimilarity: totalFollowers > pair.overlap ? pair.overlap / (totalFollowers - pair.overlap) : 0,
    }],
    uniqueReach: pair.totalReach,
    totalFollowers,
    homogeneityScore: totalFollowers > 0 ? 1 - (pair.totalReach / totalFollowers) : 0,
  };
}

// ── Trio card ────────────────────────────────────────────────────────────────

function TrioCard({
  trio,
  rank,
  userHandle,
  userAvatar,
}: {
  trio: TrioRecommendation;
  rank: number;
  userHandle: string;
  userAvatar?: string;
}) {
  const handles = [userHandle, trio.matchA.handle, trio.matchB.handle];
  const analysisUrl = `/?handles=${handles.map(h => encodeURIComponent(h)).join(',')}&autostart=complete`;

  return (
    <div style={{
      background: '#fff', border: '1px solid var(--color-border)',
      borderRadius: 8, padding: '24px', marginBottom: 20,
      transition: 'border-color 0.15s',
    }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-blue)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
            color: '#fff', background: 'var(--color-navy)',
            width: 26, height: 26, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {rank}
          </span>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-navy)' }}>
            You + {trio.matchA.displayName || trio.matchA.handle} + {trio.matchB.displayName || trio.matchB.handle}
          </span>
        </div>
        {/* Signals */}
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {trio.signals.sizeMatch && <SignalBadge label="Similar size" />}
          {trio.signals.topicMatch && <SignalBadge label="Topic match" />}
          {trio.signals.geoMatch && <SignalBadge label="Same region" />}
        </div>
      </div>

      {/* Stats bar — Collaboration reach + Median new audience + signals */}
      {(() => {
        const totalFollowers = trio.sizes.user + trio.sizes.a + trio.sizes.b;
        const newAudiences = [trio.newAudienceForUser ?? 0, trio.newAudienceForA ?? 0, trio.newAudienceForB ?? 0].sort((a, b) => a - b);
        const medianNew = newAudiences[1];
        const overlapLabel = trio.overlapLevel === 'high' ? 'High topic match'
          : trio.overlapLevel === 'medium' ? 'Moderate overlap' : 'Low overlap';
        return (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>Collaboration reach</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color: 'var(--color-navy)', lineHeight: 1.1 }}>
                {fmt(trio.totalReach)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                vs. {fmt(totalFollowers)} total followers
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>Median new audience</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color: 'var(--color-navy)', lineHeight: 1.1 }}>
                {fmt(medianNew)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>per creator</div>
            </div>
            <div style={{ marginLeft: 'auto', paddingTop: 4 }}>
              <span style={{
                display: 'inline-block', padding: '6px 14px', borderRadius: 4,
                fontSize: 12, fontWeight: 700, letterSpacing: '0.03em',
                background: trio.overlapLevel === 'high' ? '#04182B' : trio.overlapLevel === 'medium' ? '#EBF2FD' : '#f0f4f8',
                color: trio.overlapLevel === 'high' ? '#fff' : trio.overlapLevel === 'medium' ? '#034EAD' : '#5a6a7a',
              }}>
                {overlapLabel}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Full interactive Venn diagram with legend */}
      {(() => {
        const vennData = trioToOverlapData(trio, userHandle);
        const overlaps = trio.overlaps ?? { userA: 0, userB: 0, ab: 0, threeWay: 0 };
        const totalOverlap = overlaps.userA + overlaps.userB + overlaps.ab - 2 * overlaps.threeWay;
        const avgJaccard = vennData.pairwiseOverlap.length > 0
          ? (vennData.pairwiseOverlap.reduce((s, p) => s + p.jaccardSimilarity, 0) / vennData.pairwiseOverlap.length) * 100
          : 0;
        const reachPct = vennData.uniqueReach > 0 ? ((overlaps.threeWay / vennData.uniqueReach) * 100).toFixed(1) : '0';
        const interpLabel = avgJaccard > 40 ? 'Very high' : avgJaccard > 20 ? 'High' : avgJaccard > 10 ? 'Moderate' : avgJaccard > 3 ? 'Low' : 'Minimal';
        return (
          <div style={{
            background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 6, padding: '20px 22px', marginBottom: 16,
          }}>
            <div className="section-label" style={{ marginBottom: 12 }}>Follower Overlap</div>
            <VennDiagram data={vennData} />

            {/* Below-Venn stats */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
              gap: 16, marginTop: 16, paddingTop: 14,
              borderTop: '1px solid var(--color-border)',
            }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>Shared by all three</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--color-navy)', lineHeight: 1.1 }}>
                  {fmt(overlaps.threeWay)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3 }}>
                  {reachPct}% of unique reach
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>Overlap percentage</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--color-navy)', lineHeight: 1.1 }}>
                  {avgJaccard.toFixed(0)}%
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3 }}>
                  {interpLabel} overlap
                </div>
              </div>
              <div />
            </div>
          </div>
        );
      })()}

      {/* New audience opportunity */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
        gap: 10, padding: '12px 14px', background: '#f8fafc',
        borderRadius: 4, border: '1px solid #f1f5f9', marginBottom: 12,
      }}>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginBottom: 3 }}>
            New people for you
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: 'var(--color-navy)' }}>
            +{formatFollowers(trio.newAudienceForUser ?? 0)}
          </div>
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginBottom: 3 }}>
            New for {(trio.matchA.displayName || trio.matchA.handle).split(' ')[0]}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: 'var(--color-navy)' }}>
            +{formatFollowers(trio.newAudienceForA ?? 0)}
          </div>
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginBottom: 3 }}>
            New for {(trio.matchB.displayName || trio.matchB.handle).split(' ')[0]}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: 'var(--color-navy)' }}>
            +{formatFollowers(trio.newAudienceForB ?? 0)}
          </div>
        </div>
      </div>

      {/* Deep dive */}
      <div style={{ textAlign: 'right' }}>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
          Discover engagement overlaps and how many people you could convert together
        </p>
        <a href={analysisUrl} style={{
          display: 'inline-block', padding: '8px 20px', borderRadius: 4,
          background: '#04182B', color: '#fff', fontSize: 13, fontWeight: 500,
          textDecoration: 'none',
          boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
        }}>
          Dive deeper
        </a>
      </div>
    </div>
  );
}

// ── No cache view ───────────────────────────────────────────────────────────

function NoCacheView({ user, onReset }: {
  user: NoCacheResponse['user'] | null;
  onReset: () => void;
}) {
  const followerCount = user?.followerCount ?? 0;
  const estimateMinutes = followerCount > 50000 ? '5-10' : followerCount > 10000 ? '2-3' : '1-2';

  return (
    <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6, padding: '40px 28px', textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-navy)', marginBottom: 10 }}>
        Almost there!
      </div>
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)', maxWidth: 440, margin: '0 auto 8px', lineHeight: 1.6 }}>
        We found{' '}
        {user ? <strong>@{user.handle}</strong> : 'your account'}
        {followerCount > 0 && ` (${formatFollowers(followerCount)} followers)`}
        , but we haven&apos;t analyzed your followers yet.
      </p>
      <p style={{ fontSize: 13, color: 'var(--color-text-faint)', maxWidth: 440, margin: '0 auto 24px', lineHeight: 1.5 }}>
        We need to fetch your followers first so we can find your best collaborations. This takes about <strong>{estimateMinutes} minutes</strong>.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        {user && (
          <a
            href={`/?handles=${encodeURIComponent(user.handle)}&autostart=complete`}
            style={{
              display: 'inline-block', padding: '12px 24px',
              background: 'var(--color-navy)', color: '#F8FFFF', borderRadius: 4,
              fontSize: 14, fontWeight: 500, textDecoration: 'none',
              fontFamily: 'var(--font-sans)', transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--color-blue)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'var(--color-navy)'; }}
          >
            Start Analysis (~{estimateMinutes} min)
          </a>
        )}
        <button onClick={onReset} className="btn-ghost">Try another handle</button>
      </div>
    </div>
  );
}

// ── Pair card ────────────────────────────────────────────────────────────────

function PairCard({
  pair,
  rank,
  userHandle,
  userAvatar,
}: {
  pair: PairRecommendation;
  rank: number;
  userHandle: string;
  userAvatar?: string;
}) {
  const handles = [userHandle, pair.match.handle];
  const analysisUrl = `/?handles=${handles.map(h => encodeURIComponent(h)).join(',')}&autostart=complete`;

  return (
    <div style={{
      background: '#fff', border: '1px solid var(--color-border)',
      borderRadius: 8, padding: '24px', marginBottom: 20,
      transition: 'border-color 0.15s',
    }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-blue)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
            color: '#fff', background: 'var(--color-navy)',
            width: 26, height: 26, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {rank}
          </span>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-navy)' }}>
            You + {pair.match.displayName || pair.match.handle}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {pair.signals.sizeMatch && <SignalBadge label="Similar size" />}
          {pair.signals.topicMatch && <SignalBadge label="Topic match" />}
          {pair.signals.geoMatch && <SignalBadge label="Same region" />}
        </div>
      </div>

      {/* Stats bar — Collaboration reach + Median new audience + signals */}
      {(() => {
        const totalFollowers = pair.sizes.user + pair.sizes.match;
        const medianNew = Math.round(((pair.newAudienceForUser ?? 0) + (pair.newAudienceForMatch ?? 0)) / 2);
        const overlapLabel = pair.overlapLevel === 'high' ? 'High topic match'
          : pair.overlapLevel === 'medium' ? 'Moderate overlap' : 'Low overlap';
        return (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>Collaboration reach</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color: 'var(--color-navy)', lineHeight: 1.1 }}>
                {fmt(pair.totalReach)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                vs. {fmt(totalFollowers)} total followers
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>Median new audience</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color: 'var(--color-navy)', lineHeight: 1.1 }}>
                {fmt(medianNew)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>per creator</div>
            </div>
            <div style={{ marginLeft: 'auto', paddingTop: 4 }}>
              <span style={{
                display: 'inline-block', padding: '6px 14px', borderRadius: 4,
                fontSize: 12, fontWeight: 700, letterSpacing: '0.03em',
                background: pair.overlapLevel === 'high' ? '#04182B' : pair.overlapLevel === 'medium' ? '#EBF2FD' : '#f0f4f8',
                color: pair.overlapLevel === 'high' ? '#fff' : pair.overlapLevel === 'medium' ? '#034EAD' : '#5a6a7a',
              }}>
                {overlapLabel}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Full interactive Venn diagram with legend */}
      {(() => {
        const vennData = pairToPartnerOverlapData(pair, userHandle);
        const jaccard = vennData.pairwiseOverlap[0]?.jaccardSimilarity ?? 0;
        const jaccardPct = jaccard * 100;
        const reachPct = vennData.uniqueReach > 0 ? ((pair.overlap / vennData.uniqueReach) * 100).toFixed(1) : '0';
        const interpLabel = jaccardPct > 40 ? 'Very high' : jaccardPct > 20 ? 'High' : jaccardPct > 10 ? 'Moderate' : jaccardPct > 3 ? 'Low' : 'Minimal';
        return (
          <div style={{
            background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 6, padding: '20px 22px', marginBottom: 16,
          }}>
            <div className="section-label" style={{ marginBottom: 12 }}>Follower Overlap</div>
            <VennDiagram data={vennData} />

            {/* Below-Venn stats */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              gap: 16, marginTop: 16, paddingTop: 14,
              borderTop: '1px solid var(--color-border)',
            }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>Shared followers</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--color-navy)', lineHeight: 1.1 }}>
                  {fmt(pair.overlap)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3 }}>
                  {reachPct}% of unique reach
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>Overlap percentage</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--color-navy)', lineHeight: 1.1 }}>
                  {jaccardPct.toFixed(0)}%
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3 }}>
                  {interpLabel} overlap
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* New audience opportunity */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 10, padding: '12px 14px', background: '#f8fafc',
        borderRadius: 4, border: '1px solid #f1f5f9', marginBottom: 12,
      }}>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginBottom: 3 }}>
            New people for you
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: 'var(--color-navy)' }}>
            +{formatFollowers(pair.newAudienceForUser ?? 0)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>
            from {(pair.match.displayName || pair.match.handle).split(' ')[0]}
          </div>
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginBottom: 3 }}>
            New for {(pair.match.displayName || pair.match.handle).split(' ')[0]}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: 'var(--color-navy)' }}>
            +{formatFollowers(pair.newAudienceForMatch ?? 0)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>
            from you
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'right' }}>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
          Discover engagement overlaps and how many people you could convert together
        </p>
        <a href={analysisUrl} style={{
          display: 'inline-block', padding: '8px 20px', borderRadius: 4,
          background: '#04182B', color: '#fff', fontSize: 13, fontWeight: 500,
          textDecoration: 'none',
          boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
        }}>
          Dive deeper
        </a>
      </div>
    </div>
  );
}

// ── Results view ────────────────────────────────────────────────────────────

function ResultsView({ result, onReset }: {
  result: APIResponse;
  onReset: () => void;
}) {
  const { user, comparedCount } = result;
  const hasTrios = result.mode === 'trio' && result.trios && result.trios.length > 0;
  const hasPairs = result.mode === 'pair' && result.pairs && result.pairs.length > 0;
  const hasResults = hasTrios || hasPairs;

  return (
    <div>
      {/* Summary strip */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: '12px 16px', background: '#fff',
        border: '1px solid var(--color-border)', borderRadius: 6,
        marginBottom: 20, flexWrap: 'wrap',
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-navy)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 500 }}>@{user.handle}</span>
          <span style={{ padding: '2px 7px', borderRadius: 3, background: '#EBF2FD', color: 'var(--color-blue)', fontSize: 11, fontWeight: 600 }}>
            {formatFollowers(user.followerCount)} followers
          </span>
          <span style={{ color: 'var(--color-text-faint)', fontSize: 11 }}>
            · {comparedCount} journalists compared
          </span>
        </div>
        <button onClick={onReset} className="btn-ghost" style={{ marginTop: 0 }}>New Search</button>
      </div>

      {/* Results */}
      {hasResults ? (
        <>
          {hasTrios && result.trios!.map((trio, i) => (
            <TrioCard
              key={`${trio.matchA.did}-${trio.matchB.did}`}
              trio={trio}
              rank={i + 1}
              userHandle={user.handle}
              userAvatar={user.avatar}
            />
          ))}
          {hasPairs && result.pairs!.map((pair, i) => (
            <PairCard
              key={pair.match.did}
              pair={pair}
              rank={i + 1}
              userHandle={user.handle}
              userAvatar={user.avatar}
            />
          ))}
        </>
      ) : (
        <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6, padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-navy)', marginBottom: 8 }}>
            No collaborations found yet
          </div>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
            The directory is still growing — check back soon as more journalists are added.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Multi-select topic picker ────────────────────────────────────────────────

function TopicMultiSelect({ options, selected, onChange }: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [customValue, setCustomValue] = useState('');

  const toggleTopic = (topic: string) => {
    onChange(selected.includes(topic) ? selected.filter(t => t !== topic) : [...selected, topic]);
  };

  const addCustom = () => {
    const trimmed = customValue.trim();
    if (trimmed && !selected.includes(trimmed)) onChange([...selected, trimmed]);
    setCustomValue('');
    setIsAdding(false);
  };

  return (
    <div className="input-group" style={{ marginBottom: 0 }}>
      <label>Your topics</label>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6,
        padding: '10px 12px', border: '1px solid var(--color-border)',
        borderRadius: 4, background: '#fff', minHeight: 40,
      }}>
        {options.map((topic) => {
          const active = selected.includes(topic);
          return (
            <button key={topic} type="button" onClick={() => toggleTopic(topic)}
              style={{
                display: 'inline-block', padding: '4px 10px', borderRadius: 3,
                fontSize: 12, fontWeight: 500, border: '1px solid',
                borderColor: active ? 'var(--color-blue)' : 'var(--color-border)',
                background: active ? '#EBF2FD' : '#fff',
                color: active ? 'var(--color-blue)' : 'var(--color-text-muted)',
                cursor: 'pointer', transition: 'all 0.1s', fontFamily: 'var(--font-sans)',
              }}>
              {active && '✓ '}{topic}
            </button>
          );
        })}
        {selected.filter(t => !options.includes(t)).map(topic => (
          <button key={topic} type="button" onClick={() => toggleTopic(topic)}
            style={{
              display: 'inline-block', padding: '4px 10px', borderRadius: 3,
              fontSize: 12, fontWeight: 500, border: '1px solid var(--color-blue)',
              background: '#EBF2FD', color: 'var(--color-blue)',
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}>
            ✓ {topic}
          </button>
        ))}
        {!isAdding ? (
          <button type="button" onClick={() => setIsAdding(true)}
            style={{
              display: 'inline-block', padding: '4px 10px', borderRadius: 3,
              fontSize: 12, fontWeight: 500, border: '1px dashed var(--color-border)',
              background: 'transparent', color: 'var(--color-text-faint)',
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}>
            + Add new
          </button>
        ) : (
          <input type="text" value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addCustom(); }
              if (e.key === 'Escape') { setIsAdding(false); setCustomValue(''); }
            }}
            onBlur={addCustom} autoFocus placeholder="Type topic…"
            style={{
              width: 110, padding: '4px 8px', borderRadius: 3, fontSize: 12,
              border: '1px solid var(--color-blue)', outline: 'none', fontFamily: 'var(--font-sans)',
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Single select with custom option ─────────────────────────────────────────

function ComboSelect({ label, options, value, onChange, placeholder }: {
  label: string; options: string[]; value: string;
  onChange: (v: string) => void; placeholder: string;
}) {
  const [isCustom, setIsCustom] = useState(false);
  return (
    <div className="input-group" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      {!isCustom ? (
        <select className="handle-input" value={value}
          onChange={(e) => {
            if (e.target.value === '__custom__') { setIsCustom(true); onChange(''); }
            else onChange(e.target.value);
          }}
          style={{ cursor: 'pointer' }}>
          <option value="">{placeholder}</option>
          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          <option value="__custom__">+ Add new…</option>
        </select>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="handle-input" type="text" placeholder="Type your own…"
            value={value} onChange={(e) => onChange(e.target.value)} autoFocus style={{ flex: 1 }} />
          <button type="button" onClick={() => { setIsCustom(false); onChange(''); }}
            className="btn-ghost" style={{ padding: '6px 10px', fontSize: 12, marginTop: 0 }}>✕</button>
        </div>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function PartnersPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [handle, setHandle] = useState('');
  const [matchMode, setMatchMode] = useState<MatchMode>('trio');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedGeo, setSelectedGeo] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [geographies, setGeographies] = useState<string[]>([]);
  const [apiResult, setApiResult] = useState<APIResponse | null>(null);
  const [noCacheUser, setNoCacheUser] = useState<NoCacheResponse['user'] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch('/api/directory?stats=true')
      .then(r => r.json())
      .then((data: DirectoryStats) => {
        // Consolidate topics into broad categories
        if (data.topics?.length) {
          const consolidated = consolidateTopics(data.topics);
          setTopics(consolidated);
        }
        // Consolidate geographies into regions
        if (data.geographies?.length) {
          const consolidated = consolidateGeographies(data.geographies);
          setGeographies(consolidated);
        }
      })
      .catch(() => {});
  }, []);

  const cleanHandle = (input: string): string => {
    const trimmed = input.trim().replace(/^@/, '');
    const m = trimmed.match(/bsky\.app\/profile\/([^/?#]+)/);
    return m ? m[1] : trimmed;
  };

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = cleanHandle(handle);
    if (!clean) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setPhase('loading');
    setApiResult(null);
    setNoCacheUser(null);
    setErrorMsg(null);

    try {
      const params = new URLSearchParams({ handle: clean, limit: '3', mode: matchMode });
      if (selectedTopics.length > 0) params.set('topics', selectedTopics.join(','));
      if (selectedGeo) params.set('geography', selectedGeo);

      const res = await fetch(`/api/partners?${params}`, { signal: ctrl.signal });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if ((body as NoCacheResponse).error === 'no_cache') {
          setNoCacheUser((body as NoCacheResponse).user || null);
          setPhase('no-cache');
          return;
        }
        const msg = (body as { error?: string }).error || '';
        if (res.status === 504 || res.status === 502 || !msg) {
          throw new Error('The request timed out — try again or switch to Pair mode (faster).');
        }
        throw new Error(msg.toLowerCase().includes('not found') ? `Could not find Bluesky account: ${clean}` : msg);
      }

      setApiResult(await res.json() as APIResponse);
      setPhase('results');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setErrorMsg((err as Error).message || 'Something went wrong — please try again.');
      setPhase('error');
    }
  }, [handle, matchMode, selectedTopics, selectedGeo]);

  const handleReset = () => {
    abortRef.current?.abort();
    setPhase('idle');
    setApiResult(null);
    setNoCacheUser(null);
    setErrorMsg(null);
  };

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px 64px' }}>
      <Header />

      {phase === 'idle' && (
        <form onSubmit={handleSubmit} className="card">
          {/* Match type toggle — prominent at top */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{ display: 'flex', borderRadius: 6, border: '1px solid var(--color-border)', overflow: 'hidden', flex: 1 }}>
              {(['pair', 'trio'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMatchMode(m)}
                  style={{
                    flex: 1, padding: '10px 14px', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: matchMode === m ? 'var(--color-navy)' : '#fff',
                    color: matchMode === m ? '#fff' : 'var(--color-text-muted)',
                    transition: 'all 0.15s ease',
                  }}>
                  {m === 'trio' ? 'Trio' : 'Pair'}
                </button>
              ))}
            </div>
          </div>

          <div className="input-group">
            <label>Your Bluesky handle</label>
            <input className="handle-input" type="text" placeholder="e.g. yourname.bsky.social"
              value={handle} onChange={e => setHandle(e.target.value)}
              autoComplete="off" spellCheck={false} />
          </div>
          <p className="tip">Paste your handle or a full Bluesky profile URL.</p>

          {(topics.length > 0 || geographies.length > 0) && (
            <>
              <hr className="divider" />
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
                Add your topic and location to improve your matches.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {topics.length > 0 && (
                  <TopicMultiSelect options={topics} selected={selectedTopics} onChange={setSelectedTopics} />
                )}
                {geographies.length > 0 && (
                  <ComboSelect label="Your location" options={geographies}
                    value={selectedGeo}
                    onChange={(v) => setSelectedGeo(normalizeUserGeo(v))}
                    placeholder="Select location…" />
                )}
              </div>
            </>
          )}

          <button type="submit" className="btn" disabled={!handle.trim()} style={{ marginTop: 20 }}>
            Find Collaborations
          </button>
        </form>
      )}

      {phase === 'loading' && <VerbWheel active />}

      {phase === 'no-cache' && <NoCacheView user={noCacheUser} onReset={handleReset} />}

      {phase === 'error' && (
        <div className="alert alert-error">
          <strong>Error:</strong> {errorMsg}
          <div style={{ marginTop: 12 }}><button onClick={handleReset} className="btn-ghost">Try again</button></div>
        </div>
      )}

      {phase === 'results' && apiResult && (
        <ResultsView
          result={apiResult}
          onReset={handleReset}
        />
      )}

      <Footer />
    </main>
  );
}
