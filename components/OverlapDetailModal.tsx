'use client';

import { useEffect, useState } from 'react';
import type { BskyProfile, PairwiseOverlap } from '@/lib/types';
import { formatFollowers } from '@/lib/analysis/interpret';

interface Props {
  overlapId: string;
  type: 'followers' | 'engagement';
  pairwiseOverlaps: PairwiseOverlap[];
  onClose: () => void;
}

export default function OverlapDetailModal({
  overlapId,
  type,
  pairwiseOverlaps,
  onClose,
}: Props) {
  const [profiles, setProfiles] = useState<BskyProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const overlap = pairwiseOverlaps.find((o) => o.id === overlapId);

  useEffect(() => {
    const fetchDetails = async () => {
      setLoading(true);
      setError(null);

      try {
        // We don't have the DID samples readily available on the client.
        // The modal asks the server to look them up from the overlap ID.
        // For now we use a simple fetch with the overlap metadata.
        // In a real implementation, we'd store the DID samples in component state
        // and pass them here, but for simplicity we'll show a message.
        setError(
          'Drill-down requires the DID samples to be passed from the analysis result. ' +
            'This will be wired up once the full analysis result includes overlap DIDs.'
        );
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [overlapId, type]);

  const filtered = profiles.filter(
    (p) =>
      !query ||
      p.handle.toLowerCase().includes(query.toLowerCase()) ||
      (p.displayName ?? '').toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--color-navy)' }}>
              Shared {type === 'followers' ? 'Followers' : 'Engagers'}
            </div>
            {overlap && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                @{overlap.account1.handle} × @{overlap.account2.handle}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 22,
              cursor: 'pointer',
              color: 'var(--color-text-faint)',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Search */}
        {profiles.length > 0 && (
          <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--color-border)' }}>
            <input
              className="handle-input"
              type="text"
              placeholder="Search by handle or name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {loading && (
            <div
              style={{
                padding: 40,
                textAlign: 'center',
                color: 'var(--color-text-muted)',
                fontSize: 14,
              }}
            >
              Loading profiles…
            </div>
          )}

          {error && (
            <div
              style={{
                padding: 24,
                color: 'var(--color-text-muted)',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {!loading && !error && profiles.length === 0 && (
            <div
              style={{
                padding: 40,
                textAlign: 'center',
                color: 'var(--color-text-faint)',
                fontSize: 14,
              }}
            >
              No profiles to show.
            </div>
          )}

          {filtered.map((p) => (
            <a
              key={p.did}
              href={`https://bsky.app/profile/${p.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 24px',
                textDecoration: 'none',
                borderBottom: '1px solid var(--color-border)',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background = 'var(--color-bg-light)')
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = '')
              }
            >
              {p.avatar && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.avatar}
                  alt=""
                  style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    color: 'var(--color-navy)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.displayName || p.handle}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-text-muted)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  @{p.handle}
                </div>
              </div>
              {p.followersCount != null && (
                <span style={{ fontSize: 12, color: 'var(--color-text-faint)', flexShrink: 0 }}>
                  {formatFollowers(p.followersCount)}
                </span>
              )}
            </a>
          ))}
        </div>

        {total > 0 && (
          <div
            style={{
              padding: '12px 24px',
              borderTop: '1px solid var(--color-border)',
              fontSize: 12,
              color: 'var(--color-text-faint)',
              flexShrink: 0,
            }}
          >
            Showing {filtered.length} of {total} shared{' '}
            {type === 'followers' ? 'followers' : 'engagers'}
          </div>
        )}
      </div>
    </div>
  );
}
