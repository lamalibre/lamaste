import type { AccessRequestTemplates, TemplateOptions } from './types.js';

/** The look every page Gatekeeper serves shares: the panel's dark terminal style. */
const BASE_CSS = `    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
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
    .fqdn { color: #22d3ee; }`;

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
    slack: `Hi, could I get access to \`${resourceName}\`? My username is \`${username}\`.`,
    teams: `Hi, could I get access to **${resourceName}**? My username is **${username}**.`,
    whatsapp: `Hi, I need access to ${resourceName} (username: ${username}). Thanks!`,
    generic: `Access request for ${resourceName}\n` + `Username: ${username}${contactLine}`,
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
${BASE_CSS}
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

/**
 * The page a signed-in user is answered with on a host of a domain they
 * are not a member of (the multi-domain relay): no access request — the
 * whole domain is closed to them — but who to ask, and a way to sign in as
 * someone else. It names no user (Authelia's refusal carries none). Shares
 * the access-request page's look. With `site`, the page of a static site
 * that refused a signed-in user — for its domain or its own user list
 * (Authelia's 403 does not say which).
 *
 * @param domain - The base domain the requested host is under; null when it
 *   is under none (the page then links to no sign-in: there is none to trust)
 * @param options - Optional admin contact info
 * @param host - The requested hostname; `site` when the refusal is a static
 *   site's (for its domain or its own user list)
 * @returns Full HTML page string
 */
export function buildDomainRefusalPage(
  domain: string | null,
  options: TemplateOptions | undefined,
  { host, site = false }: { host: string; site?: boolean },
): string {
  const adminContact = options?.adminContact ?? '';
  const adminName = options?.adminName ?? 'your administrator';
  const heading =
    domain === null || site
      ? `Not allowed on <span class="fqdn">${escapeHtml(host)}</span>`
      : `Not a member of <span class="fqdn">${escapeHtml(domain)}</span>`;
  const explanation =
    domain === null
      ? `Your account is signed in, but this host is under none of this relay's domains,
      so nobody may open it.`
      : site
        ? `Your account is signed in, but it may not open this site: it is not a member of
      ${escapeHtml(domain)}, or not one of the site's users.`
        : `Your account is signed in, but it is not a member of this domain, so none of its
      applications are open to it.`;
  // Only a domain of this relay has a sign-in to send the user to; a host
  // under none could name a stranger's.
  const signOut =
    domain === null
      ? ''
      : `<p class="subtitle">
      <a href="https://auth.${escapeAttr(domain)}/logout">Sign out</a> to sign in with another account.
    </p>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Not allowed — ${escapeHtml(domain ?? host)}</title>
  <style>
${BASE_CSS}
    .subtitle { color: #a1a1aa; font-size: 0.875rem; margin-bottom: 1rem; }
    .contact { color: #a1a1aa; font-size: 0.8125rem; margin-top: 1.5rem; }
    a { color: #22d3ee; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#128683;</div>
    <h1>${heading}</h1>
    <p class="subtitle">
      ${explanation} Ask ${escapeHtml(adminName)} to add you if you should have access.
    </p>
    ${signOut}
    ${adminContact ? `<p class="contact">Admin: <a href="mailto:${escapeAttr(adminContact)}">${escapeHtml(adminContact)}</a></p>` : ''}
  </div>
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
