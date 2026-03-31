/**
 * HTML escape utility.
 * Returns empty string for null/undefined; otherwise escapes the 5 HTML entities.
 *
 * @param {*} str
 * @returns {string}
 */
export function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Mapping of DB classification values to human-readable labels and Tailwind color classes.
 */
export const SIGNAL_LABELS = {
  // reason_classification
  strategic_focus:           { label: 'Strategic Focus',            color: 'text-green-700' },
  weak_unit_disposal:        { label: 'Weak Unit Disposal',         color: 'text-red-700'   },
  mixed:                     { label: 'Mixed',                      color: 'text-yellow-700' },
  // equity_grants
  equity_grants_confirmed:   { label: 'Equity Grants',              color: 'text-green-700' },
  no_equity_grants:          { label: 'No Equity Grants',           color: 'text-red-700'   },
  // debt_loading
  no_debt_concern:           { label: 'No Debt Concern',            color: 'text-green-700' },
  moderate_debt:             { label: 'Moderate Debt',              color: 'text-yellow-700' },
  excessive_debt:            { label: 'Excessive Debt',             color: 'text-red-700'   },
  // management_continuity
  strong_leaders_moving:     { label: 'Leaders Moving to SpinCo',   color: 'text-green-700' },
  leaders_staying_at_parent: { label: 'Leaders Staying at Parent',  color: 'text-red-700'   },
};

/**
 * Returns a full HTML document wrapping the given body content.
 * Includes HTMX 2.0.8 and Tailwind CSS browser@4 CDN script tags.
 *
 * @param {string} bodyContent
 * @returns {string}
 */
export function renderLayout(bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Spinoff Screener</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script src="https://cdn.jsdelivr.net/npm/htmx.org@2.0.8/dist/htmx.min.js"></script>
</head>
<body class="bg-gray-50 text-gray-900 p-6">
${bodyContent}
</body>
</html>`;
}

/**
 * Renders the feed page HTML with an opportunity table and empty detail panel.
 *
 * @param {Array} opportunities - Array of opportunity rows from listOpportunities()
 * @returns {string} HTML string
 */
export function renderFeedPage(opportunities) {
  const rows = opportunities.map(opp => {
    const sigInfo = SIGNAL_LABELS[opp.top_signal_classification];
    const sigLabel = sigInfo ? sigInfo.label : 'Pending';
    const sigColor = sigInfo ? sigInfo.color : 'text-gray-500';

    return `  <tr
    hx-get="/opportunities/${opp.id}"
    hx-target="#detail-panel"
    hx-swap="innerHTML"
    hx-push-url="true"
    class="cursor-pointer hover:bg-slate-100 border-b"
  >
    <td class="py-2 px-4">${esc(opp.company_name)}</td>
    <td class="py-2 px-4">${esc(opp.signal_type)}</td>
    <td class="py-2 px-4">${esc(opp.status)}</td>
    <td class="py-2 px-4 ${sigColor}">${esc(sigLabel)}</td>
  </tr>`;
  }).join('\n');

  return `<h1 class="text-2xl font-bold mb-4">Spinoff Screener</h1>
<table class="w-full border-collapse">
  <thead>
    <tr class="border-b-2 text-left">
      <th class="py-2 px-4">Company</th>
      <th class="py-2 px-4">Type</th>
      <th class="py-2 px-4">Status</th>
      <th class="py-2 px-4">Top Signal</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>
<div id="detail-panel" class="mt-6">
  <p class="text-gray-400">Select a spinoff to view details.</p>
</div>`;
}

/**
 * Renders the detail fragment for a single opportunity.
 *
 * @param {Object} opp - Opportunity object from getOpportunityDetail()
 * @returns {string} HTML fragment string (no full document wrapper)
 */
export function renderDetail(opp) {
  // Signals table
  let signalsHtml;
  if (!opp.signals || opp.signals.length === 0) {
    signalsHtml = '<p class="text-gray-500">No signals extracted yet.</p>';
  } else {
    const signalRows = opp.signals.map(s => {
      const info = SIGNAL_LABELS[s.classification];
      const label = info ? info.label : esc(s.classification);
      const color = info ? info.color : '';
      return `    <tr class="border-b">
      <td class="py-1 px-3">${esc(s.signal_name)}</td>
      <td class="py-1 px-3 ${color}">${label}</td>
      <td class="py-1 px-3">${esc(s.confidence)}</td>
    </tr>`;
    }).join('\n');

    signalsHtml = `<table class="w-full border-collapse text-sm mt-2">
  <thead>
    <tr class="border-b-2 text-left">
      <th class="py-1 px-3">Signal</th>
      <th class="py-1 px-3">Classification</th>
      <th class="py-1 px-3">Confidence</th>
    </tr>
  </thead>
  <tbody>
${signalRows}
  </tbody>
</table>`;
  }

  // AI analysis section — handle null gracefully and render Red Flags distinctly
  let analysisHtml;
  if (opp.claude_analysis == null) {
    analysisHtml = '<p class="text-gray-500">Analysis pending — check back after the next pipeline run.</p>';
  } else {
    const parts = opp.claude_analysis.split('Red Flags:');
    const summary = parts[0];
    analysisHtml = `<p class="mb-2">${esc(summary.trim())}</p>`;

    if (parts.length > 1) {
      const flagLines = parts[1]
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('-'));
      const flagItems = flagLines
        .map(line => `    <li>${esc(line.slice(1).trim())}</li>`)
        .join('\n');
      analysisHtml += `<p class="text-red-700 font-semibold">Red Flags:</p>
<ul class="list-disc list-inside text-red-700 mt-1">
${flagItems}
</ul>`;
    }
  }

  return `<h2 class="text-xl font-bold mb-2">${esc(opp.company_name)}</h2>
<dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-4">
  <dt class="font-semibold">Status</dt>
  <dd>${esc(opp.status)}</dd>
  <dt class="font-semibold">Type</dt>
  <dd>${esc(opp.signal_type)}</dd>
  <dt class="font-semibold">Discovered</dt>
  <dd>${esc(opp.discovered_at)}</dd>
  <dt class="font-semibold">Filed</dt>
  <dd>${esc(opp.filed_at)}</dd>
  <dt class="font-semibold">Accession</dt>
  <dd>${esc(opp.accession_number)}</dd>
</dl>
<h3 class="text-lg font-semibold mt-4 mb-2">Signal Breakdown</h3>
${signalsHtml}
<h3 class="text-lg font-semibold mt-4 mb-2">AI Analysis</h3>
${analysisHtml}`;
}
