const { escapeHtml } = require('./_mailer');

/**
 * The small standalone pages the API serves from links in emails
 * (unsubscribe, set password). `bodyHtml` is trusted markup; escape anything
 * user-supplied before it goes in.
 */
function simplePage({ title, bodyHtml, script = '' }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)} · ForestTrace</title>
<style>
:root{--bg:#f1f5f9;--card:#fff;--line:#e2e8f0;--text:#1e293b;--muted:#64748b;--accent:#2f8f5b;--err:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#0f172a;--card:#1e293b;--line:#334155;--text:#e2e8f0;--muted:#94a3b8;--accent:#4ade80;--err:#f87171}}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text)}
main{max-width:440px;margin:12vh auto;padding:28px 24px;background:var(--card);border:1px solid var(--line);border-radius:12px}
@media (max-width:480px){main{margin:16px;}}
h1{font-size:18px;margin:0 0 10px}p{font-size:14px;line-height:1.6;margin:0 0 16px}.muted{color:var(--muted);font-size:13px}
label{display:block;font-size:13px;font-weight:600;margin:0 0 6px}
input{width:100%;padding:9px 10px;margin:0 0 14px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit}
button,.button{display:inline-block;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none}
button:disabled{opacity:.6;cursor:default}.error{color:var(--err);font-size:13px;min-height:1em}
</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${bodyHtml}</main>${script ? `<script>${script}</script>` : ''}</body></html>`;
}

function sendPage(res, status, page) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).send(page);
}

module.exports = { simplePage, sendPage };
