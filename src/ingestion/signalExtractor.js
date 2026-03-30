/**
 * Signal extractor — section locator, four signal classifiers, storeSignal,
 * and extractSignalsForFiling orchestrator.
 *
 * All classifier functions are pure (no side effects, no I/O).
 * storeSignal uses INSERT OR REPLACE for idempotency.
 */
import db from '../db/db.js';
import logger from '../logger.js';
import { fetchForm10Document } from './form10Fetcher.js';

// ---------------------------------------------------------------------------
// Section patterns
// ---------------------------------------------------------------------------

const SECTION_PATTERNS = {
  reasons_for_distribution: /reasons?\s+for(\s+the)?\s+(distribution|separation|spin.?off)/i,
  executive_compensation:   /executive\s+compensation|equity\s+compensation|treatment\s+of\s+outstanding\s+equity|long.term\s+incentive/i,
  capitalization:           /capitali[sz]ation|pro\s+forma\s+capitali[sz]ation|indebtedness/i,
  management:               /(directors?\s+and\s+)?(executive\s+officers?|senior\s+management)|management\s+of\s+\w+/i,
};

// ---------------------------------------------------------------------------
// SIG-01 keywords
// ---------------------------------------------------------------------------

const STRATEGIC_FOCUS_KEYWORDS = [
  /\bfocus\b.*\bcore\b/i,
  /\bcore business\b/i,
  /\benhance.*focus\b/i,
  /\benable.*management.*focus\b/i,
  /\bindependent.*operational\b/i,
  /\bpositio[n].*compet/i,
  /\bunlock.*value\b/i,
  /\bstrategic.*flexibility\b/i,
  /\bpursue.*growth\b/i,
  /\baccelerate.*strategy\b/i,
];

const WEAK_UNIT_KEYWORDS = [
  /\bnon.?core\b/i,
  /\bunderperform/i,
  /\bslow.*growth\b/i,
  /\bdifferent.*risk\s+profile\b/i,
  /\bdivest/i,
  /\bdissimilar.*business\b/i,
  /\blow.*margin\b/i,
  /\bmatured?\b.*business\b/i,
  /\bnot.*consistent\b.*strateg/i,
  /\bimped[ei]/i,
];

// ---------------------------------------------------------------------------
// SIG-02 keywords
// ---------------------------------------------------------------------------

const EQUITY_GRANT_KEYWORDS = [
  /\bstock\s+option/i,
  /\brestricted\s+stock\s+unit/i,
  /\bRSU\b/,
  /\bequity\s+(award|grant|incentive|compensation)/i,
  /\blong.term\s+incentive/i,
  /\bperformance\s+(share|unit|award)/i,
  /\bstock\s+award/i,
  /\bequity\s+plan/i,
  /\binitiall?y\s+grant/i,
  /\bnew\s+(equity|stock)\s+award/i,
];

// ---------------------------------------------------------------------------
// SIG-03 keywords
// ---------------------------------------------------------------------------

const EXCESSIVE_DEBT_KEYWORDS = [
  /\bhighly\s+lever/i,
  /\bsubstantial\s+(debt|indebtedness)\b/i,
  /\bsignificant\s+(debt|indebtedness)\b/i,
  /\bconsiderable\s+(debt|indebtedness)\b/i,
  /\btransfer.*debt\b/i,
  /\bassume.*debt\b/i,
  /\bdebt.to.equity\b/i,
  /\blever[a-z]+\s+ratio\b/i,
  /\bterm\s+loan\b/i,
  /\bcredit\s+facilit/i,
];

// ---------------------------------------------------------------------------
// SIG-04 keywords
// ---------------------------------------------------------------------------

const SPINCO_LEADERSHIP_KEYWORDS = [
  /\bwill\s+(serve|join|become|lead|head)\b/i,
  /\b(president|chief\s+executive|ceo|cfo|coo|chairman)\b/i,
  /\btransfer.*management\b/i,
  /\b(previously|formerly)\s+(served|held)/i,
  /\bfound(?:er|ed)/i,
  /\bentrepreneur\b/i,
];

const PARENT_RETENTION_KEYWORDS = [
  /\bremain.*parent\b/i,
  /\bcontinue.*employ.*parent\b/i,
  /\bnot\s+(transition|move|transfer)\b/i,
  /\bretain.*executive\b/i,
  /\bno\s+dedicated\s+management\b/i,
];

// ---------------------------------------------------------------------------
// Prepared statement for upsert (module-level, created once)
// ---------------------------------------------------------------------------

const upsertSignal = db.prepare(`
  INSERT OR REPLACE INTO signals
    (filing_id, signal_name, classification, confidence, raw_excerpt, extracted_at)
  VALUES
    (@filing_id, @signal_name, @classification, @confidence, @raw_excerpt, datetime('now'))
`);

// ---------------------------------------------------------------------------
// Section locator helpers
// ---------------------------------------------------------------------------

/**
 * Walk nextElementSibling collecting text until hitting h1-h5 or exceeding maxChars.
 * If collected text < 100 chars, also collect from sibling <table> elements
 * (handles capitalization tables that appear in some filings).
 *
 * @param {import('node-html-parser').HTMLElement} headingEl
 * @param {number} maxChars
 * @returns {string}
 */
function extractAfterHeading(headingEl, maxChars = 5000) {
  const STOP_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5']);
  let collected = '';
  let sibling = headingEl.nextElementSibling;

  while (sibling) {
    const tag = sibling.tagName?.toUpperCase();
    if (STOP_TAGS.has(tag)) break;
    collected += sibling.text;
    if (collected.length >= maxChars) break;
    sibling = sibling.nextElementSibling;
  }

  // Pitfall 5: if very little text collected, also check sibling tables
  if (collected.length < 100) {
    let tableSibling = headingEl.nextElementSibling;
    while (tableSibling) {
      const tag = tableSibling.tagName?.toUpperCase();
      if (tag === 'TABLE') {
        collected += tableSibling.text;
      }
      tableSibling = tableSibling.nextElementSibling;
      if (collected.length >= maxChars) break;
    }
  }

  return collected.trim().slice(0, maxChars);
}

/**
 * Locate a named section within an EDGAR HTML document using three strategies:
 *   1. Heading element search (h1-h5, b, strong)
 *   2. Bold paragraph fallback (p > b/strong/font)
 *   3. Full-text search fallback
 *
 * @param {import('node-html-parser').HTMLElement} root - parsed DOM root
 * @param {string} patternKey - key of SECTION_PATTERNS
 * @returns {string|null} section text (up to 5000 chars), or null if not found
 */
export function locateSection(root, patternKey) {
  const pattern = SECTION_PATTERNS[patternKey];
  if (!pattern) return null;

  // Strategy 1 — heading element search
  const headings = root.querySelectorAll('h1,h2,h3,h4,h5,b,strong');
  const heading = headings.find(el => pattern.test(el.text));
  if (heading) return extractAfterHeading(heading);

  // Strategy 2 — bold paragraph fallback
  const boldParas = root.querySelectorAll('p');
  const match = boldParas.find(p => {
    const inner = p.querySelector('b,strong,font');
    return inner && pattern.test(inner.text);
  });
  if (match) return extractAfterHeading(match);

  // Strategy 3 — full-text search fallback
  const fullText = root.text;
  const idx = fullText.search(pattern);
  if (idx !== -1) return fullText.slice(idx, idx + 5000);

  return null;
}

// ---------------------------------------------------------------------------
// Signal classifiers (pure functions)
// ---------------------------------------------------------------------------

/**
 * Classify the reasons for distribution section.
 *
 * @param {string|null|undefined} sectionText
 * @returns {{ classification: string, confidence: string }}
 */
export function classifyReasons(sectionText) {
  if (!sectionText) return { classification: 'unknown', confidence: 'not_found' };

  const strategicHits = STRATEGIC_FOCUS_KEYWORDS.filter(r => r.test(sectionText)).length;
  const weakHits = WEAK_UNIT_KEYWORDS.filter(r => r.test(sectionText)).length;

  let classification;
  if (strategicHits >= 2 && strategicHits > weakHits) {
    classification = 'strategic_focus';
  } else if (weakHits >= 1 && weakHits > strategicHits) {
    classification = 'weak_unit_disposal';
  } else if (strategicHits >= 1 && weakHits >= 1) {
    classification = 'mixed';
  } else {
    classification = 'unknown';
  }

  const total = strategicHits + weakHits;
  const confidence = total >= 3 ? 'high' : total >= 1 ? 'medium' : 'low';

  return { classification, confidence };
}

/**
 * Classify the executive compensation / equity grants section.
 *
 * @param {string|null|undefined} sectionText
 * @returns {{ classification: string, confidence: string }}
 */
export function classifyEquityGrants(sectionText) {
  if (!sectionText) return { classification: 'unknown', confidence: 'not_found' };

  const matches = EQUITY_GRANT_KEYWORDS.filter(r => r.test(sectionText)).length;

  if (matches >= 2) {
    const confidence = matches >= 3 ? 'high' : 'medium';
    return { classification: 'equity_grants_confirmed', confidence };
  }

  // matches === 0 or 1 — threshold is 2 to avoid false positives
  return { classification: 'no_equity_grants', confidence: 'low' };
}

/**
 * Classify the capitalization / debt loading section.
 *
 * @param {string|null|undefined} sectionText
 * @returns {{ classification: string, confidence: string }}
 */
export function classifyDebtLoading(sectionText) {
  if (!sectionText) return { classification: 'unknown', confidence: 'not_found' };

  const matches = EXCESSIVE_DEBT_KEYWORDS.filter(r => r.test(sectionText)).length;

  if (matches >= 2) {
    const confidence = matches >= 3 ? 'high' : 'medium';
    return { classification: 'excessive_debt', confidence };
  }
  if (matches === 1) {
    return { classification: 'moderate_debt', confidence: 'medium' };
  }
  return { classification: 'no_debt_concern', confidence: 'low' };
}

/**
 * Classify the management continuity section.
 *
 * @param {string|null|undefined} sectionText
 * @returns {{ classification: string, confidence: string }}
 */
export function classifyManagement(sectionText) {
  if (!sectionText) return { classification: 'unknown', confidence: 'not_found' };

  const leadershipHits = SPINCO_LEADERSHIP_KEYWORDS.filter(r => r.test(sectionText)).length;
  const retentionHits = PARENT_RETENTION_KEYWORDS.filter(r => r.test(sectionText)).length;

  let classification;
  if (leadershipHits > retentionHits) {
    classification = 'strong_leaders_moving';
  } else if (retentionHits > leadershipHits) {
    classification = 'leaders_staying_at_parent';
  } else if (leadershipHits > 0 && retentionHits > 0) {
    classification = 'mixed';
  } else {
    classification = 'unknown';
  }

  const total = leadershipHits + retentionHits;
  const confidence = total >= 3 ? 'high' : total >= 1 ? 'medium' : 'low';

  return { classification, confidence };
}

// ---------------------------------------------------------------------------
// Signal storage
// ---------------------------------------------------------------------------

/**
 * Persist a signal row using INSERT OR REPLACE for idempotency.
 *
 * @param {number} filingId
 * @param {string} signalName - one of: reason_classification | equity_grants | debt_loading | management_continuity
 * @param {string} classification
 * @param {string} confidence
 * @param {string|null} rawExcerpt
 */
export function storeSignal(filingId, signalName, classification, confidence, rawExcerpt) {
  upsertSignal.run({
    filing_id:      filingId,
    signal_name:    signalName,
    classification,
    confidence,
    raw_excerpt:    rawExcerpt ? rawExcerpt.slice(0, 5000) : null,
  });
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Signal name + pattern key + classifier mapping for the four signals.
 */
const SIGNAL_DEFINITIONS = [
  {
    patternKey:  'reasons_for_distribution',
    signalName:  'reason_classification',
    classifier:  classifyReasons,
  },
  {
    patternKey:  'executive_compensation',
    signalName:  'equity_grants',
    classifier:  classifyEquityGrants,
  },
  {
    patternKey:  'capitalization',
    signalName:  'debt_loading',
    classifier:  classifyDebtLoading,
  },
  {
    patternKey:  'management',
    signalName:  'management_continuity',
    classifier:  classifyManagement,
  },
];

/**
 * Extract and store all four signals for a single filing.
 *
 * @param {{ id: number, accession_number: string, primary_doc_url: string, cik: string }} filing
 * @returns {Promise<Array<{ signal_name: string, classification: string, confidence: string }>>}
 */
export async function extractSignalsForFiling(filing) {
  const root = await fetchForm10Document(filing);

  if (!root) {
    // Document not available — store not_found for all four signals
    logger.warn({ filingId: filing.id, accession: filing.accession_number },
      'signalExtractor: no document found, storing not_found signals');
    const results = [];
    for (const def of SIGNAL_DEFINITIONS) {
      storeSignal(filing.id, def.signalName, 'unknown', 'not_found', null);
      results.push({ signal_name: def.signalName, classification: 'unknown', confidence: 'not_found' });
    }
    return results;
  }

  const results = [];
  for (const def of SIGNAL_DEFINITIONS) {
    const sectionText = locateSection(root, def.patternKey);
    const { classification, confidence } = def.classifier(sectionText);
    storeSignal(filing.id, def.signalName, classification, confidence, sectionText);
    results.push({ signal_name: def.signalName, classification, confidence });
    logger.debug({ filingId: filing.id, signalName: def.signalName, classification, confidence },
      'signalExtractor: stored signal');
  }

  return results;
}
