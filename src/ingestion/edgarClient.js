/**
 * EDGAR HTTP client.
 *
 * RULES:
 *   1. All EDGAR requests go through edgarGet / edgarGetJson / edgarGetText.
 *   2. Never call fetch() directly for data.sec.gov or efts.sec.gov URLs.
 *   3. Do NOT use Promise.all() over EDGAR endpoints — it blows past the rate cap.
 */
import pLimit from 'p-limit';

// 8 concurrent requests max — EDGAR cap is 10; leave 2 headroom
const limit = pLimit(8);

/**
 * @param {string} url
 * @param {number} attempt - internal retry counter (1-indexed)
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, attempt = 1) {
  // Read env var per-call so tests can override it between module import and fetch
  const userAgent = process.env.SEC_USER_AGENT ?? 'SpinoffScreener contact@example.com';

  const res = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
      'Accept-Encoding': 'gzip, deflate',
    },
  });

  if (res.status === 429 || res.status === 503) {
    if (attempt >= 4) {
      throw new Error(`EDGAR rate limited after ${attempt} attempts: ${url}`);
    }
    // Exponential backoff with full jitter: delay = random(0, min(1000 * 2^attempt, 30000))
    const cap = Math.min(1000 * 2 ** attempt, 30_000);
    const delay = Math.random() * cap;
    await new Promise(r => setTimeout(r, delay));
    return fetchWithRetry(url, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`EDGAR ${res.status} for ${url}`);
  }

  return res;
}

/** Fetch an EDGAR URL; returns the raw Response object. */
export function edgarGet(url) {
  return limit(() => fetchWithRetry(url));
}

/** Fetch an EDGAR URL and parse the response as JSON. */
export function edgarGetJson(url) {
  return limit(() => fetchWithRetry(url).then(r => r.json()));
}

/** Fetch an EDGAR URL and return the response body as text. */
export function edgarGetText(url) {
  return limit(() => fetchWithRetry(url).then(r => r.text()));
}
