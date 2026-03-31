import db from '../db/db.js';

/**
 * Returns all opportunities ordered by discovered_at DESC.
 * LEFT JOINs signals to get top_signal_classification (reason_classification).
 * Handles missing signals gracefully (LEFT JOIN, not INNER JOIN).
 *
 * @returns {Array} Array of opportunity rows with top_signal_classification
 */
export function listOpportunities() {
  return db.prepare(`
    SELECT o.id, o.company_name, o.signal_type, o.status,
           o.discovered_at, o.spinoff_target,
           s.classification AS top_signal_classification
    FROM opportunities o
    LEFT JOIN signals s
      ON s.filing_id = o.filing_id
     AND s.signal_name = 'reason_classification'
    ORDER BY o.discovered_at DESC
  `).all();
}

/**
 * Returns full opportunity detail with all signals, or null if not found.
 *
 * @param {number} id - Opportunity ID
 * @returns {Object|null} Opportunity with signals array, or null
 */
export function getOpportunityDetail(id) {
  const opp = db.prepare(`
    SELECT o.*, f.company_name AS parent_company, f.filed_at, f.accession_number
    FROM opportunities o
    JOIN filings f ON f.id = o.filing_id
    WHERE o.id = ?
  `).get(id);

  if (!opp) return null;

  const signals = db.prepare(`
    SELECT signal_name, classification, confidence, raw_excerpt
    FROM signals
    WHERE filing_id = (SELECT filing_id FROM opportunities WHERE id = ?)
    ORDER BY signal_name
  `).all(id);

  return { ...opp, signals };
}
