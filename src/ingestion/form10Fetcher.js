/**
 * Form 10 document fetcher.
 *
 * Resolves the correct HTML document from an EDGAR filing index and
 * returns a parsed node-html-parser DOM root.
 *
 * RULES:
 *   1. Never call fetch() directly — use edgarGetJson and edgarGetText from edgarClient.js
 *   2. Never use Promise.all() — sequential fetches only (EDGAR rate cap)
 *   3. primary_doc_url already ends with '/' (set by edgarIngester.js)
 */
import { edgarGetJson, edgarGetText } from './edgarClient.js';
import { parse } from 'node-html-parser';
import logger from '../logger.js';

/**
 * Resolve which HTML document URL to fetch from the filing index directory items.
 *
 * Priority order:
 *   1. EX-99.1 type — picks highest sequence number if multiple (handles amendments)
 *   2. 10-12B or 10-12B/A type
 *   3. First item whose name ends with .htm
 *   4. null if nothing found
 *
 * @param {Array|object} indexItems - directory items from EDGAR index JSON
 * @param {string} baseUrl - filing directory URL (ends with '/')
 * @returns {string|null} full URL to the document, or null
 */
export function resolveDocumentUrl(indexItems, baseUrl) {
  // Handle edge case: single item returned as object, not array
  const items = Array.isArray(indexItems) ? indexItems : [indexItems];

  // Priority 1: EX-99.1 — pick the one with the highest sequence number
  const exhibit99Items = items.filter(item => item.type === 'EX-99.1');
  if (exhibit99Items.length > 0) {
    // Sort descending by sequence, pick highest
    const best = exhibit99Items.reduce((prev, curr) => {
      const prevSeq = parseInt(prev.sequence, 10) || 0;
      const currSeq = parseInt(curr.sequence, 10) || 0;
      return currSeq > prevSeq ? curr : prev;
    });
    return `${baseUrl}${best.name}`;
  }

  // Priority 2: 10-12B or 10-12B/A type
  const form10Item = items.find(
    item => item.type === '10-12B' || item.type === '10-12B/A'
  );
  if (form10Item) {
    return `${baseUrl}${form10Item.name}`;
  }

  // Priority 3: first item whose name ends with .htm
  const htmItem = items.find(item => item.name && item.name.endsWith('.htm'));
  if (htmItem) {
    return `${baseUrl}${htmItem.name}`;
  }

  return null;
}

/**
 * Fetch and parse a Form 10 HTML document for a filing.
 *
 * Steps:
 *   1. Build the index JSON URL from accession number + primary_doc_url
 *   2. Fetch the index JSON to get directory items
 *   3. Resolve the correct document URL from items
 *   4. Fetch the HTML text
 *   5. Parse and return the DOM root
 *
 * Returns null on any failure (network error, missing document, etc.)
 *
 * @param {{ accession_number: string, primary_doc_url: string, cik: string }} filing
 * @returns {Promise<import('node-html-parser').HTMLElement|null>}
 */
export async function fetchForm10Document(filing) {
  const accessionNoDashes = filing.accession_number.replace(/-/g, '');
  const indexUrl = `${filing.primary_doc_url}${accessionNoDashes}-index.json`;

  let indexData;
  try {
    indexData = await edgarGetJson(indexUrl);
  } catch (err) {
    logger.warn({ err, indexUrl, accession: filing.accession_number },
      'form10Fetcher: failed to fetch filing index JSON');
    return null;
  }

  const items = indexData?.directory?.item ?? [];
  const docUrl = resolveDocumentUrl(items, filing.primary_doc_url);

  if (!docUrl) {
    logger.warn({ accession: filing.accession_number, primary_doc_url: filing.primary_doc_url },
      'form10Fetcher: no suitable HTML document found in filing index');
    return null;
  }

  let html;
  try {
    html = await edgarGetText(docUrl);
  } catch (err) {
    logger.warn({ err, docUrl, accession: filing.accession_number },
      'form10Fetcher: failed to fetch filing HTML document');
    return null;
  }

  return parse(html);
}
