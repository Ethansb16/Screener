import { edgarGetJson } from './edgarClient.js';
import { normalizeCIK } from '../lib/edgar-utils.js';
import logger from '../logger.js';

/**
 * Check the lifecycle state of a SpinCo by querying its EDGAR submissions.
 *
 * Returns 'confirmed' if EFFECT form found, 'withdrawn' if RW found, null if neither.
 *
 * CRITICAL: submissions.filings.recent is columnar arrays, not an array of objects.
 * Always use the map(form, i) reconstruction pattern.
 *
 * @param {string|number} cik
 * @returns {Promise<'confirmed'|'withdrawn'|null>}
 */
export async function checkLifecycle(cik) {
  const paddedCIK = normalizeCIK(cik);
  const url = `https://data.sec.gov/submissions/CIK${paddedCIK}.json`;

  let submissions;
  try {
    submissions = await edgarGetJson(url);
  } catch (err) {
    logger.warn({ cik, err: err.message }, 'lifecycle check failed — submissions fetch error');
    return null;
  }

  const recent = submissions?.filings?.recent;
  if (!recent?.form) {
    logger.warn({ cik }, 'lifecycle check — no filings.recent.form in submissions response');
    return null;
  }

  // CRITICAL: filings.recent is parallel columnar arrays, not array of objects
  const forms = recent.form.map((formType, i) => ({
    form:            formType,
    filingDate:      recent.filingDate?.[i],
    accessionNumber: recent.accessionNumber?.[i],
  }));

  // RW takes priority — a withdrawn deal that somehow got an EFFECT should be treated as withdrawn
  const rwRow = forms.find(f => f.form === 'RW');
  if (rwRow) {
    logger.info({ cik, filingDate: rwRow.filingDate }, 'lifecycle: RW detected — marking withdrawn');
    return 'withdrawn';
  }

  const effectRow = forms.find(f => f.form === 'EFFECT');
  if (effectRow) {
    logger.info({ cik, filingDate: effectRow.filingDate }, 'lifecycle: EFFECT detected — marking confirmed');
    return 'confirmed';
  }

  return null;
}
