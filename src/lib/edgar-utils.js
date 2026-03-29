/**
 * EDGAR URL and identifier helpers.
 * Import from here — never duplicate these in other modules.
 */

/**
 * Zero-pad a CIK to 10 digits.
 * The EDGAR submissions endpoint requires 10-digit CIKs: CIK0000320193.json
 * @param {string|number} cik
 * @returns {string} 10-digit zero-padded CIK string
 */
export function normalizeCIK(cik) {
  return String(cik).padStart(10, '0');
}

/**
 * Strip dashes from an accession number for use in file path URLs.
 * Display format: 0001234567-24-000001
 * URL path format: 000123456724000001
 * @param {string} accession
 * @returns {string}
 */
export function accessionToPath(accession) {
  return accession.replace(/-/g, '');
}

/**
 * Build the EDGAR submissions API URL for a given CIK.
 * @param {string|number} cik
 * @returns {string}
 */
export function submissionsUrl(cik) {
  return `https://data.sec.gov/submissions/CIK${normalizeCIK(cik)}.json`;
}

/**
 * Build an EDGAR filing index URL from CIK and accession number.
 * @param {string|number} cik
 * @param {string} accessionNumber - with or without dashes
 * @returns {string}
 */
export function filingIndexUrl(cik, accessionNumber) {
  const paddedCIK = normalizeCIK(cik);
  const pathAccession = accessionToPath(accessionNumber);
  return `https://www.sec.gov/Archives/edgar/data/${paddedCIK}/${pathAccession}/${pathAccession}-index.htm`;
}
