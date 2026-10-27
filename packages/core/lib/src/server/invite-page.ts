/**
 * The invitation acceptance page — `https://auth.<domain>/invite/<token>`,
 * a static HTML file whose script reads the token from the URL, shows the
 * invitation (`GET /api/invite/<token>`) and creates the account
 * (`POST /api/invite/<token>/accept`). One rendering for the relay, the
 * **stock page** (`renderInvitePage(null)`, written by serverd to
 * `/var/www/lamaste/invite/index.html`), and one per branded domain
 * (`renderInvitePage(brand)`, `invite/index.html` of the domain's rendering
 * under `/var/www/lamaste/auth/<domain>/`, which the domain's auth vhost
 * serves first — packages/core/docs/auth-branding-design.md).
 *
 * The two differ only in what a brand puts on the page: its name in the
 * title and in a header above the form, the tagline under it when set,
 * the logo (`/static/media/logo.png`, the same origin — the auth vhost
 * serves it) only when the brand has one, the accent for the primary
 * button and the focus ring, and the light palette when the theme is
 * `light` (every other theme keeps the stock page's dark look). The
 * script, the API calls and the wording are the same.
 *
 * Nothing operator-controlled but those validated fields enters the page,
 * and each is checked again here: the name and the tagline are HTML-escaped
 * (validation already refuses `<`, `>`, `{`, `}`), the accent must match
 * {@link AUTH_BRANDING_ACCENT_RE} or the default colour is used. No
 * external URL: the QR code library the success view loads is the page's
 * own, as before.
 */

import {
  AUTH_BRANDING_ACCENT_RE,
  AUTH_BRANDING_THEMES,
  accentForeground,
} from '../auth-branding.js';
import type { BrandTheme } from '../auth-branding.js';

/** What the invitation page takes from a domain's brand. */
export interface InviteBrand {
  readonly name: string;
  readonly tagline: string | null;
  readonly theme: BrandTheme;
  /** `#rrggbb`, or null for the default accent. */
  readonly accent: string | null;
  /** Whether the domain serves `/static/media/logo.png`. */
  readonly logo: boolean;
}

/** The accent of the stock page (cyan-400) on the dark palette … */
export const INVITE_PAGE_DEFAULT_ACCENT = '#22d3ee';
/** … and on the light one (cyan-600: readable on white). */
export const INVITE_PAGE_DEFAULT_ACCENT_LIGHT = '#0891b2';

/** The page's own path to the domain's logo (served by the auth vhost from the rendering). */
export const INVITE_PAGE_LOGO_PATH = '/static/media/logo.png';

interface Palette {
  readonly background: string;
  readonly card: string;
  readonly border: string;
  readonly text: string;
  readonly heading: string;
  readonly muted: string;
  readonly hint: string;
  readonly input: string;
  readonly disabled: string;
  readonly errorBackground: string;
  readonly errorBorder: string;
  readonly errorText: string;
  readonly noteBackground: string;
  readonly noteBorder: string;
  readonly noteText: string;
  readonly success: string;
}

/** The stock page's dark terminal palette (zinc-950 background, zinc-900 card). */
const DARK: Palette = {
  background: '#09090b',
  card: '#18181b',
  border: '#27272a',
  text: '#a1a1aa',
  heading: '#f4f4f5',
  muted: '#71717a',
  hint: '#52525b',
  input: '#09090b',
  disabled: '#71717a',
  errorBackground: '#1c0f0f',
  errorBorder: '#7f1d1d',
  errorText: '#fca5a5',
  noteBackground: '#0f1c1c',
  noteBorder: '#134e4a',
  noteText: '#5eead4',
  success: '#4ade80',
};

/** The light palette (zinc-50 background, white card) a brand with theme `light` gets. */
const LIGHT: Palette = {
  background: '#fafafa',
  card: '#ffffff',
  border: '#e4e4e7',
  text: '#52525b',
  heading: '#18181b',
  muted: '#71717a',
  hint: '#a1a1aa',
  input: '#fafafa',
  disabled: '#a1a1aa',
  errorBackground: '#fef2f2',
  errorBorder: '#fecaca',
  errorText: '#b91c1c',
  noteBackground: '#f0fdfa',
  noteBorder: '#99f6e4',
  noteText: '#0f766e',
  success: '#15803d',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** The accent the page uses: the brand's when it is a colour, else the palette's default. */
function pageAccent(brand: InviteBrand | null, light: boolean): string {
  const accent = brand?.accent ?? null;
  if (accent !== null && AUTH_BRANDING_ACCENT_RE.test(accent)) return accent;
  return light ? INVITE_PAGE_DEFAULT_ACCENT_LIGHT : INVITE_PAGE_DEFAULT_ACCENT;
}

/**
 * The invitation page: the stock one for `null`, a domain's for its brand.
 * Throws on a brand whose theme is none of Authelia's (the rendering is
 * made from a validated record; anything else is a programming error).
 */
export function renderInvitePage(brand: InviteBrand | null): string {
  if (brand !== null && !(AUTH_BRANDING_THEMES as readonly string[]).includes(brand.theme)) {
    throw new Error('An invitation page is rendered for one of Authelia’s themes');
  }
  const light = brand?.theme === 'light';
  const palette = light ? LIGHT : DARK;
  const accent = pageAccent(brand, light);
  const title =
    brand === null
      ? 'Lamaste — Accept Invitation'
      : `${escapeHtml(brand.name)} — Accept Invitation`;
  const header =
    brand === null
      ? ''
      : `
    <header class="brand">${
      brand.logo
        ? `
      <img class="brand-logo" src="${INVITE_PAGE_LOGO_PATH}" alt="">`
        : ''
    }
      <div class="brand-name">${escapeHtml(brand.name)}</div>${
        brand.tagline === null
          ? ''
          : `
      <div class="brand-tagline">${escapeHtml(brand.tagline)}</div>`
      }
    </header>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root {
      --accent: ${accent};
      --accent-foreground: ${accentForeground(accent)};
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: ${palette.background}; color: ${palette.text};
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: ${palette.card}; border: 1px solid ${palette.border}; border-radius: 0.75rem;
      max-width: 480px; width: 100%; padding: 2.5rem;
    }
    .brand { text-align: center; margin-bottom: 2rem; }
    .brand-logo { max-width: 160px; max-height: 80px; margin-bottom: 0.75rem; }
    .brand-name { color: ${palette.heading}; font-size: 1rem; font-weight: 700; }
    .brand-tagline { font-size: 0.8125rem; margin-top: 0.25rem; }
    .icon { text-align: center; font-size: 3rem; margin-bottom: 1rem; }
    h1 { color: ${palette.heading}; font-size: 1.25rem; text-align: center; margin-bottom: 0.5rem; }
    .subtitle { text-align: center; margin-bottom: 2rem; font-size: 0.875rem; }
    .field { margin-bottom: 1.25rem; }
    .field label {
      display: block; font-size: 0.8125rem; color: ${palette.text};
      margin-bottom: 0.375rem; font-weight: 600;
    }
    .field input {
      width: 100%; padding: 0.625rem 0.875rem;
      background: ${palette.input}; border: 1px solid ${palette.border}; border-radius: 0.5rem;
      color: ${palette.heading}; font-family: inherit; font-size: 0.875rem;
      outline: none; transition: border-color 0.15s;
    }
    .field input:focus { border-color: var(--accent); }
    .field input:disabled { color: ${palette.disabled}; cursor: not-allowed; }
    .field .hint { font-size: 0.75rem; color: ${palette.hint}; margin-top: 0.25rem; }
    .error-msg {
      background: ${palette.errorBackground}; border: 1px solid ${palette.errorBorder}; border-radius: 0.5rem;
      padding: 0.75rem 1rem; margin-bottom: 1.25rem;
      font-size: 0.8125rem; color: ${palette.errorText};
    }
    .note-msg {
      background: ${palette.noteBackground}; border-color: ${palette.noteBorder}; color: ${palette.noteText};
      text-align: center;
    }
    .success-card { text-align: center; }
    .success-card h1 { color: ${palette.success}; margin-bottom: 1rem; }
    .success-card p { margin-bottom: 1.5rem; font-size: 0.875rem; line-height: 1.6; }
    .accent { color: var(--accent); }
    .btn {
      display: block; width: 100%;
      background: var(--accent); color: var(--accent-foreground); font-weight: 700;
      border: none; border-radius: 0.5rem; padding: 0.75rem;
      font-size: 0.875rem; cursor: pointer; font-family: inherit;
      transition: filter 0.15s;
    }
    .btn:hover { filter: brightness(0.92); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-link { text-decoration: none; text-align: center; margin-top: 1rem; }
    .btn-outline {
      background: transparent; border: 1px solid ${palette.border}; color: ${palette.text};
    }
    .btn-outline:hover { border-color: var(--accent); color: ${palette.heading}; }
    .loading {
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      padding: 3rem 0; font-size: 0.875rem;
    }
    .spinner {
      width: 1.25rem; height: 1.25rem;
      border: 2px solid ${palette.border}; border-top-color: var(--accent);
      border-radius: 50%; animation: spin 0.6s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .detail-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.5rem 0; border-bottom: 1px solid ${palette.border};
      font-size: 0.8125rem;
    }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: ${palette.muted}; }
    .detail-value { color: ${palette.heading}; font-weight: 500; }
    .details-box {
      background: ${palette.input}; border: 1px solid ${palette.border}; border-radius: 0.5rem;
      padding: 0.75rem 1rem; margin-bottom: 1.5rem;
    }
    .qr {
      display: flex; justify-content: center; margin: 0 auto 1.5rem;
      background: #fff; border-radius: 0.5rem; padding: 1rem; max-width: 220px;
    }
    .manual { font-size: 0.75rem; color: ${palette.hint}; margin-bottom: 1rem; word-break: break-all; }
    .manual strong { color: ${palette.text}; }
  </style>
</head>
<body>
  <div class="card">${header}
    <div id="app">
      <div class="loading">
        <div class="spinner"></div>
        Loading invitation...
      </div>
    </div>
  </div>

  <script>
    (function() {
      var app = document.getElementById('app');
      var pathParts = window.location.pathname.split('/');
      var token = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

      if (!token || token === 'invite') {
        showError('Invalid invitation link.');
        return;
      }

      // Fetch invitation details
      fetch('/api/invite/' + encodeURIComponent(token))
        .then(function(res) {
          if (res.ok) return res.json();
          return res.json().then(function(data) { throw new Error(data.error || 'Invalid invitation'); });
        })
        .then(function(data) {
          showForm(data);
        })
        .catch(function(err) {
          showError(err.message);
        });

      function showError(message) {
        app.innerHTML =
          '<div class="icon">\\u26A0\\uFE0F</div>' +
          '<h1>Invitation Unavailable</h1>' +
          '<p class="subtitle">' + escapeHtml(message) + '</p>';
      }

      function showForm(data) {
        var expiresDate = new Date(data.expiresAt);
        var expiresStr = expiresDate.toLocaleDateString(undefined, {
          year: 'numeric', month: 'long', day: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });

        app.innerHTML =
          '<div class="icon">\\u2709\\uFE0F</div>' +
          '<h1>You\\u2019ve Been Invited</h1>' +
          '<p class="subtitle">Set your password to create your account.</p>' +
          '<div class="details-box">' +
            '<div class="detail-row">' +
              '<span class="detail-label">Username</span>' +
              '<span class="detail-value">' + escapeHtml(data.username) + '</span>' +
            '</div>' +
            '<div class="detail-row">' +
              '<span class="detail-label">Email</span>' +
              '<span class="detail-value">' + escapeHtml(data.email) + '</span>' +
            '</div>' +
            '<div class="detail-row">' +
              '<span class="detail-label">Expires</span>' +
              '<span class="detail-value">' + escapeHtml(expiresStr) + '</span>' +
            '</div>' +
          '</div>' +
          '<div id="form-error"></div>' +
          '<form id="accept-form">' +
            '<div class="field">' +
              '<label for="password">Password</label>' +
              '<input type="password" id="password" placeholder="Minimum 8 characters" required minlength="8" maxlength="128">' +
            '</div>' +
            '<div class="field">' +
              '<label for="confirm-password">Confirm Password</label>' +
              '<input type="password" id="confirm-password" placeholder="Re-enter your password" required>' +
            '</div>' +
            '<button type="submit" class="btn" id="submit-btn">Create Account</button>' +
          '</form>';

        document.getElementById('accept-form').addEventListener('submit', function(e) {
          e.preventDefault();
          var password = document.getElementById('password').value;
          var confirm = document.getElementById('confirm-password').value;
          var errorDiv = document.getElementById('form-error');
          var submitBtn = document.getElementById('submit-btn');

          errorDiv.innerHTML = '';

          if (password.length < 8) {
            errorDiv.innerHTML = '<div class="error-msg">Password must be at least 8 characters.</div>';
            return;
          }
          if (password !== confirm) {
            errorDiv.innerHTML = '<div class="error-msg">Passwords do not match.</div>';
            return;
          }

          submitBtn.disabled = true;
          submitBtn.textContent = 'Creating account...';

          fetch('/api/invite/' + encodeURIComponent(token) + '/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password })
          })
            .then(function(res) {
              if (res.ok) return res.json();
              return res.json().then(function(d) { throw new Error(d.error || 'Failed to create account'); });
            })
            .then(function(result) {
              showSuccess(result);
            })
            .catch(function(err) {
              errorDiv.innerHTML = '<div class="error-msg">' + escapeHtml(err.message) + '</div>';
              submitBtn.disabled = false;
              submitBtn.textContent = 'Create Account';
            });
        });
      }

      function showSuccess(result) {
        app.className = 'success-card';
        var loginBtn = result.loginUrl
          ? '<a href="' + escapeHtml(result.loginUrl) + '" class="btn btn-link">Go to Login</a>'
          : '';

        if (result.totpUri) {
          app.innerHTML =
            '<div class="icon">\\u2705</div>' +
            '<h1>Account Created</h1>' +
            '<p>Your account <strong class="accent">' + escapeHtml(result.username) + '</strong> has been created.</p>' +
            '<p>Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.) to set up two-factor authentication.</p>' +
            '<div id="qr-container" class="qr"></div>' +
            '<p class="manual"><strong>Manual entry:</strong> ' + escapeHtml(result.totpUri.match(/secret=([^&]+)/)?.[1] || '') + '</p>' +
            '<div class="error-msg note-msg">\\u26A0\\uFE0F Save this before navigating away — it cannot be shown again.</div>' +
            loginBtn;

          // Load QR code library and render
          var script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
          script.onload = function() {
            var qr = qrcode(0, 'M');
            qr.addData(result.totpUri);
            qr.make();
            var container = document.getElementById('qr-container');
            if (container) container.innerHTML = qr.createSvgTag(4, 0);
          };
          document.head.appendChild(script);
        } else {
          app.innerHTML =
            '<div class="icon">\\u2705</div>' +
            '<h1>Account Created</h1>' +
            '<p>Your account <strong class="accent">' + escapeHtml(result.username) + '</strong> has been created successfully.</p>' +
            '<p>Contact your administrator to set up two-factor authentication.</p>' +
            loginBtn;
        }
      }

      function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
      }
    })();
  </script>
</body>
</html>
`;
}
