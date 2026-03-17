'use client';

import { useRef, useState, useCallback } from 'react';
import { useDirectorySearch } from '@/hooks/useDirectorySearch';
import type { JournalistEntry } from '@/lib/types';

interface HandleTypeaheadProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (handle: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** When provided, shows a "Recent" section when the input is empty/focused. */
  recentHandles?: string[];
  /** Handles to exclude from suggestions (already used in other inputs). */
  excludeHandles?: Set<string>;
  label?: string;
  optional?: boolean;
}

// Inline handle extraction (mirrors AnalysisForm)
function extractHandle(input: string): string {
  const trimmed = input.trim().replace(/^@/, '');
  const profileMatch = trimmed.match(/bsky\.app\/profile\/([^/?#]+)/);
  if (profileMatch) return profileMatch[1];
  return trimmed;
}

export default function HandleTypeahead({
  value,
  onChange,
  onSelect,
  placeholder = 'e.g. someone.bsky.social',
  disabled = false,
  recentHandles,
  excludeHandles,
  label,
  optional,
}: HandleTypeaheadProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const extracted = extractHandle(value);
  const { results: directoryResults } = useDirectorySearch(extracted);

  // Filter recent handles by what's typed and exclude already-used handles
  const filteredRecent = (recentHandles ?? []).filter(h => {
    if (excludeHandles?.has(h.toLowerCase())) return false;
    if (extracted.length === 0) return true;
    return h.toLowerCase().includes(extracted.toLowerCase());
  });

  // Filter directory results to exclude already-used handles
  const filteredDirectory = directoryResults.filter(entry => {
    if (excludeHandles?.has(entry.handle.toLowerCase())) return false;
    // Also exclude if already in recent (avoid duplicates)
    if (filteredRecent.some(r => r.toLowerCase() === entry.handle.toLowerCase())) return false;
    return true;
  });

  const showRecent = filteredRecent.length > 0;
  const showDirectory = filteredDirectory.length > 0;
  const hasItems = showRecent || showDirectory;
  const dropdownOpen = isOpen && hasItems;

  // Build flat list of selectable items for keyboard nav
  const allItems: { handle: string; type: 'recent' | 'directory' }[] = [];
  if (showRecent) {
    for (const h of filteredRecent) allItems.push({ handle: h, type: 'recent' });
  }
  if (showDirectory) {
    for (const entry of filteredDirectory) allItems.push({ handle: entry.handle, type: 'directory' });
  }

  const handleSelect = useCallback((handle: string) => {
    onSelect(handle);
    setIsOpen(false);
    setHighlightIndex(-1);
  }, [onSelect]);

  const handleFocus = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setIsOpen(true);
  };

  const handleBlur = () => {
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      setHighlightIndex(-1);
    }, 150);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!dropdownOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(prev => (prev + 1) % allItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(prev => (prev <= 0 ? allItems.length - 1 : prev - 1));
    } else if (e.key === 'Enter' && highlightIndex >= 0 && highlightIndex < allItems.length) {
      e.preventDefault();
      handleSelect(allItems[highlightIndex].handle);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setHighlightIndex(-1);
    }
  };

  // Reset highlight when results change
  const prevItemCount = useRef(allItems.length);
  if (allItems.length !== prevItemCount.current) {
    prevItemCount.current = allItems.length;
    if (highlightIndex >= allItems.length) setHighlightIndex(-1);
  }

  let itemIndex = 0;

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      {label && (
        <label>
          {label}
          {optional && (
            <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}> (optional)</span>
          )}
        </label>
      )}
      <input
        className="handle-input"
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setHighlightIndex(-1);
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        style={{ width: '100%' }}
      />

      {dropdownOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 2,
            background: '#fff',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            zIndex: 200,
            overflow: 'hidden',
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {/* Recent section */}
          {showRecent && (
            <>
              <SectionHeader label="Recent" />
              {filteredRecent.map((h) => {
                const idx = itemIndex++;
                return (
                  <RecentItem
                    key={`recent-${h}`}
                    handle={h}
                    highlighted={highlightIndex === idx}
                    onSelect={handleSelect}
                  />
                );
              })}
            </>
          )}

          {/* Directory section */}
          {showDirectory && (
            <>
              <SectionHeader label="Directory" />
              {filteredDirectory.map((entry) => {
                const idx = itemIndex++;
                return (
                  <DirectoryItem
                    key={`dir-${entry.did}`}
                    entry={entry}
                    highlighted={highlightIndex === idx}
                    onSelect={handleSelect}
                  />
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        color: 'var(--color-text-faint)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        padding: '6px 10px 4px',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {label}
    </div>
  );
}

function RecentItem({
  handle,
  highlighted,
  onSelect,
}: {
  handle: string;
  highlighted: boolean;
  onSelect: (h: string) => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect(handle);
      }}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '7px 10px',
        background: highlighted ? '#F4F8FC' : 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        color: 'var(--color-navy)',
        borderBottom: '1px solid var(--color-border)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = '#F4F8FC';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = highlighted ? '#F4F8FC' : '#fff';
      }}
    >
      {handle}
    </button>
  );
}

function DirectoryItem({
  entry,
  highlighted,
  onSelect,
}: {
  entry: JournalistEntry;
  highlighted: boolean;
  onSelect: (h: string) => void;
}) {
  const initial = (entry.displayName || entry.handle).charAt(0).toUpperCase();
  const [imgError, setImgError] = useState(false);

  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect(entry.handle);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        padding: '8px 10px',
        background: highlighted ? '#F4F8FC' : 'none',
        border: 'none',
        cursor: 'pointer',
        borderBottom: '1px solid var(--color-border)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = '#F4F8FC';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = highlighted ? '#F4F8FC' : '#fff';
      }}
    >
      {/* Avatar (Bluesky profile picture with letter-initial fallback) */}
      {entry.avatar && !imgError ? (
        <img
          src={entry.avatar}
          alt=""
          width={28}
          height={28}
          onError={() => setImgError(true)}
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            objectFit: 'cover',
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'var(--color-bg-light)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--color-navy)',
            flexShrink: 0,
          }}
        >
          {initial}
        </div>
      )}

      {/* Name + handle */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-navy)',
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.displayName || entry.handle}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          @{entry.handle}
        </div>
      </div>

      {/* Outlet */}
      {entry.outlet && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-faint)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {entry.outlet}
        </div>
      )}
    </button>
  );
}
