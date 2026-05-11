import type { AccessRequestTemplates, TemplateOptions } from './types.js';

/**
 * Generate pre-filled message templates for requesting access to a resource.
 *
 * @param username - The authenticated user's username
 * @param resourceName - Human-readable resource name (e.g., FQDN or plugin name)
 * @param options - Optional admin contact info and domain
 * @returns Templates for email, Slack, Teams, WhatsApp, and generic
 */
export function getAccessRequestTemplates(
  username: string,
  resourceName: string,
  options?: TemplateOptions,
): AccessRequestTemplates {
  const adminName = options?.adminName ?? 'Administrator';
  const adminContact = options?.adminContact ?? '';
  const contactLine = adminContact ? `\nAdmin contact: ${adminContact}` : '';

  return {
    email: {
      subject: `Access request for ${resourceName}`,
      body:
        `Hi ${adminName},\n\n` +
        `I'd like to request access to ${resourceName}.\n` +
        `My username is: ${username}\n\n` +
        `Thank you.`,
    },
    slack:
      `Hi, could I get access to \`${resourceName}\`? My username is \`${username}\`.`,
    teams:
      `Hi, could I get access to **${resourceName}**? My username is **${username}**.`,
    whatsapp:
      `Hi, I need access to ${resourceName} (username: ${username}). Thanks!`,
    generic:
      `Access request for ${resourceName}\n` +
      `Username: ${username}${contactLine}`,
  };
}

/**
 * Build an HTML page for the access-request denial page.
 * Server-rendered with inline CSS, no external dependencies.
 *
 * @param username - The authenticated user's username
 * @param resourceFqdn - The tunnel FQDN the user tried to access
 * @param options - Optional admin contact info
 * @returns Full HTML page string
 */
export function buildAccessRequestPage(
  username: string,
  resourceFqdn: string,
  options?: TemplateOptions,
): string {
  const templates = getAccessRequestTemplates(username, resourceFqdn, options);
  const adminContact = options?.adminContact ?? '';
  const adminName = options?.adminName ?? 'your administrator';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Access Required — ${escapeHtml(resourceFqdn)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
      background: #09090b; color: #e4e4e7;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 1rem;
    }
    .card {
      background: #18181b; border: 1px solid #27272a; border-radius: 0.75rem;
      max-width: 560px; width: 100%; padding: 2rem;
    }
    .icon { font-size: 2.5rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; color: #f4f4f5; margin-bottom: 0.5rem; }
    .fqdn { color: #22d3ee; }
    .subtitle { color: #a1a1aa; font-size: 0.875rem; margin-bottom: 1.5rem; }
    .section-label {
      color: #71717a; font-size: 0.75rem; text-transform: uppercase;
      letter-spacing: 0.05em; margin-bottom: 0.5rem; margin-top: 1.25rem;
    }
    .template-box {
      background: #0f0f12; border: 1px solid #27272a; border-radius: 0.5rem;
      padding: 0.75rem 1rem; margin-bottom: 0.5rem; position: relative;
      font-size: 0.8125rem; line-height: 1.5; white-space: pre-wrap;
      word-break: break-word; color: #d4d4d8;
    }
    .copy-btn {
      position: absolute; top: 0.5rem; right: 0.5rem;
      background: #27272a; border: 1px solid #3f3f46; border-radius: 0.375rem;
      color: #a1a1aa; font-size: 0.6875rem; padding: 0.25rem 0.5rem;
      cursor: pointer; font-family: inherit;
      transition: background 0.15s, color 0.15s;
    }
    .copy-btn:hover { background: #3f3f46; color: #e4e4e7; }
    .copy-btn.copied { background: #065f46; color: #6ee7b7; border-color: #065f46; }
    .contact { color: #a1a1aa; font-size: 0.8125rem; margin-top: 1.5rem; }
    .contact a { color: #22d3ee; text-decoration: none; }
    .contact a:hover { text-decoration: underline; }
    .user-badge {
      display: inline-block; background: #27272a; border-radius: 0.25rem;
      padding: 0.125rem 0.375rem; font-size: 0.75rem; color: #22d3ee;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#128274;</div>
    <h1>Access Required</h1>
    <p class="subtitle">
      You don't have access to <span class="fqdn">${escapeHtml(resourceFqdn)}</span>
    </p>
    <p class="subtitle">
      Signed in as <span class="user-badge">${escapeHtml(username)}</span>
    </p>
    <p class="subtitle">
      Contact ${escapeHtml(adminName)} to request access. Copy a message template below:
    </p>

    <div class="section-label">Email</div>
    <div class="template-box" id="tpl-email">Subject: ${escapeHtml(templates.email.subject)}

${escapeHtml(templates.email.body)}<button class="copy-btn" onclick="copyTemplate('tpl-email', this)">Copy</button></div>

    <div class="section-label">Slack / Teams</div>
    <div class="template-box" id="tpl-slack">${escapeHtml(templates.slack)}<button class="copy-btn" onclick="copyTemplate('tpl-slack', this)">Copy</button></div>

    <div class="section-label">WhatsApp</div>
    <div class="template-box" id="tpl-whatsapp">${escapeHtml(templates.whatsapp)}<button class="copy-btn" onclick="copyTemplate('tpl-whatsapp', this)">Copy</button></div>

    ${adminContact ? `<p class="contact">Admin: <a href="mailto:${escapeAttr(adminContact)}">${escapeHtml(adminContact)}</a></p>` : ''}
  </div>
  <script>
    function copyTemplate(id, btn) {
      var el = document.getElementById(id);
      if (!el) return;
      var text = el.textContent.replace(/Copy$/, '').trim();
      navigator.clipboard.writeText(text).then(function() {
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(function() {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      });
    }
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
