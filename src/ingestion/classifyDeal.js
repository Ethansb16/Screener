/**
 * Classify a discovered EFTS filing hit into a deal type.
 *
 * Returns:
 *   'spinoff'                — 10-12B/10-12B/A, no exchange offer language
 *   'split-off'              — 10-12B/10-12B/A with exchange offer language
 *   'pending_classification' — 8-K (text classification deferred to Phase 3)
 *   'divestiture'            — anything else (excluded from pipeline)
 *
 * NOTE: 10-12B filings are NEVER 'carve_out' — carve-outs use S-1, not Form 10.
 */
export function classifyDeal(hit) {
  const form = hit._source?.form ?? '';

  if (form === '10-12B' || form === '10-12B/A') {
    // Check for exchange offer / split-off language in display_names
    const names = (hit._source?.display_names ?? []).join(' ').toLowerCase();
    if (names.includes('exchange offer') || names.includes('split-off') || names.includes('split off')) {
      return 'split-off';
    }
    return 'spinoff';
  }

  if (form === '8-K') {
    return 'pending_classification';
  }

  // carve-outs (S-1) and all other unknown forms fall through as divestiture
  return 'divestiture';
}
