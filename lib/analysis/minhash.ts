/**
 * MinHash signatures for Jaccard similarity estimation.
 *
 * Each signature consists of k minimum hash values. Two signatures can be
 * compared to estimate Jaccard similarity: the fraction of matching minimums
 * approximates |A ∩ B| / |A ∪ B|, with error rate ~1/√k.
 *
 * Hash function: FNV-1a (fast, good distribution, zero dependencies).
 * Each of k hash functions is fnv1a(item) XOR seed[i].
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(str: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}

/** Deterministic seeds — same across runs so cached signatures are comparable. */
function generateSeeds(k: number): Uint32Array {
  const seeds = new Uint32Array(k);
  let s = 0x12345678;
  for (let i = 0; i < k; i++) {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    seeds[i] = s >>> 0;
  }
  return seeds;
}

// Pre-generate seeds for common k values
const SEEDS_256 = generateSeeds(256);
const SEEDS_512 = generateSeeds(512);

function getSeeds(k: number): Uint32Array {
  if (k === 256) return SEEDS_256;
  if (k === 512) return SEEDS_512;
  return generateSeeds(k);
}

export class MinHashSignature {
  readonly k: number;
  private mins: Uint32Array;
  private seeds: Uint32Array;

  constructor(k: number) {
    this.k = k;
    this.seeds = getSeeds(k);
    this.mins = new Uint32Array(k).fill(0xffffffff);
  }

  /** Feed an item into the signature. Call once per set element. */
  update(item: string): void {
    const h = fnv1a(item);
    for (let i = 0; i < this.k; i++) {
      const v = (h ^ this.seeds[i]) >>> 0;
      if (v < this.mins[i]) this.mins[i] = v;
    }
  }

  /** Estimate Jaccard similarity (0–1) against another signature of the same k. */
  jaccard(other: MinHashSignature): number {
    if (this.k !== other.k) throw new Error('MinHash k mismatch');
    let matches = 0;
    for (let i = 0; i < this.k; i++) {
      if (this.mins[i] === other.mins[i]) matches++;
    }
    return matches / this.k;
  }

  /** Export signature as a plain number array (for Redis caching). */
  toArray(): number[] {
    return Array.from(this.mins);
  }

  /** Restore a signature from a cached array. */
  static fromArray(arr: number[]): MinHashSignature {
    const sig = new MinHashSignature(arr.length);
    sig.mins = new Uint32Array(arr);
    return sig;
  }
}

/**
 * Project real overlap count from Jaccard similarity and actual set sizes.
 *
 * Given: J = |A ∩ B| / |A ∪ B|, and |A ∪ B| = |A| + |B| - |A ∩ B|
 * Solving: overlap = J × (|A| + |B|) / (1 + J)
 */
export function projectOverlap(jaccard: number, sizeA: number, sizeB: number): number {
  if (jaccard <= 0) return 0;
  return Math.round(jaccard * (sizeA + sizeB) / (1 + jaccard));
}
