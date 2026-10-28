/**
 * The invitation acceptance page — `https://auth.<domain>/invite#<token>`,
 * a static HTML file whose script reads the token from the link's fragment,
 * shows the invitation (`POST /api/invite/lookup { token }`) and creates the
 * account (`POST /api/invite/accept { token, … }`). The token never travels
 * in a URL path a log keeps; a 4.8 link (`/invite/<token>`) still opens the
 * page, which reads it from its path the same way. Either way the token is
 * taken out of the address bar at once.
 *
 * Two kinds of invitation (packages/core/docs/delegated-invitations-design.md):
 * an administrator's names the username, and the page asks for a password;
 * a delegated one (a plugin user with an inviting role invited them) names
 * the plugin, the role and who invited, and the page asks for a username
 * (suggested from the address), the person's name and a password.
 *
 * One rendering for the relay, the **stock page** (`renderInvitePage(null)`,
 * written by serverd to `/var/www/lamaste/invite/index.html`), and one per
 * branded domain (`renderInvitePage(brand)`, `invite/index.html` of the
 * domain's rendering, which the domain's auth vhost serves first —
 * packages/core/docs/auth-branding-design.md). They differ only in markup —
 * the title, a header with the brand's name, tagline and logo, and a link to
 * `/brand.css`, which carries the brand's colours: the inline script and
 * style are the same text for every brand, so the headers nginx sends with
 * the page ({@link INVITE_PAGE_HEADERS}) name them by hash. Nothing loads
 * from another host: the two-factor QR code is an SVG the panel renders
 * into the accept answer.
 */

import { AUTH_PAGE_DEFAULT_ACCENT, AUTH_PAGE_DEFAULT_ACCENT_LIGHT } from '../auth-branding.js';
import { AUTH_BRANDING_THEMES } from '../auth-branding.js';
import { authPageHeaders, authPageShell } from './auth-pages.js';
import type { InviteBrand } from './auth-pages.js';

export type { InviteBrand } from './auth-pages.js';
export { INVITE_PAGE_LOGO_PATH } from './auth-pages.js';

/** The accent of the stock page (cyan-400) on the dark palette … */
export const INVITE_PAGE_DEFAULT_ACCENT = AUTH_PAGE_DEFAULT_ACCENT;
/** … and on the light one (cyan-600: readable on white). */
export const INVITE_PAGE_DEFAULT_ACCENT_LIGHT = AUTH_PAGE_DEFAULT_ACCENT_LIGHT;

/** The page's script — one text for every brand (its hash is in {@link INVITE_PAGE_HEADERS}). */
export const INVITE_PAGE_SCRIPT = String.raw`
    (function () {
      'use strict';
      var app = document.getElementById('app');
      var TOKEN_RE = /^[a-f0-9]{64}$/;
      var USERNAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
      var QR_PREFIX = 'data:image/svg+xml;base64,';

      // The token: the link's fragment, or — a 4.8 link — the last segment
      // of /invite/<token>. Nothing else of the URL is read. Then it leaves
      // the address bar and the history: the link is a secret.
      var token = null;
      var fragment = window.location.hash.slice(1);
      var segments = window.location.pathname.split('/').filter(function (s) { return s !== ''; });
      if (TOKEN_RE.test(fragment)) {
        token = fragment;
      } else if (segments.length === 2 && segments[0] === 'invite' && TOKEN_RE.test(segments[1])) {
        token = segments[1];
      }
      try { window.history.replaceState(null, '', '/invite/'); } catch (e) { /* not fatal */ }
      if (!token) {
        showError('This invitation link is not valid.');
        return;
      }

      post('/api/invite/lookup', { token: token })
        .then(function (data) {
          if (data.kind === 'delegated') showDelegatedForm(data);
          else showAdminForm(data);
        })
        .catch(function (err) { showError(err.message); });

      function post(path, body) {
        return fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body)
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (res.ok) return data;
            throw new Error(typeof data.error === 'string' ? data.error : 'The request failed.');
          });
        });
      }

      function text(value) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(String(value)));
        return div.innerHTML;
      }

      function formatDate(iso) {
        var date = new Date(iso);
        return isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, {
          year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
      }

      function row(label, value) {
        return '<div class="detail-row"><span class="detail-label">' + text(label) +
          '</span><span class="detail-value">' + text(value) + '</span></div>';
      }

      function field(id, label, type, hint) {
        return '<div class="field"><label for="' + id + '">' + text(label) + '</label>' +
          '<input type="' + type + '" id="' + id + '">' +
          (hint ? '<div class="hint">' + text(hint) + '</div>' : '') + '</div>';
      }

      function showError(message) {
        app.innerHTML =
          '<div class="icon">⚠️</div>' +
          '<h1>Invitation Unavailable</h1>' +
          '<p class="subtitle">' + text(message) + '</p>';
      }

      function passwordFields() {
        return field('password', 'Password', 'password', 'At least 8 characters') +
          field('confirm-password', 'Confirm password', 'password', '');
      }

      function showAdminForm(data) {
        app.innerHTML =
          '<div class="icon">✉️</div>' +
          '<h1>You’ve Been Invited</h1>' +
          '<p class="subtitle">Set your password to create your account.</p>' +
          '<div class="details-box">' +
            row('Username', data.username) + row('Email', data.email) +
            row('Expires', formatDate(data.expiresAt)) +
          '</div>' +
          '<div id="form-error"></div>' +
          '<form id="accept-form">' + passwordFields() +
          '<button type="submit" class="btn" id="submit-btn">Create Account</button></form>';
        bindForm(function () { return {}; });
      }

      function showDelegatedForm(data) {
        var who = data.invitedBy ? text(data.invitedBy) + ' invited you' : 'You are invited';
        app.innerHTML =
          '<div class="icon">✉️</div>' +
          '<h1>You’ve Been Invited</h1>' +
          '<p class="subtitle">' + who + ' to <strong class="accent">' + text(data.plugin) +
            '</strong> as <strong>' + text(data.role) + '</strong>.</p>' +
          '<div class="details-box">' +
            row('Email', data.email) + row('Expires', formatDate(data.expiresAt)) +
          '</div>' +
          '<div id="form-error"></div>' +
          '<form id="accept-form">' +
            field('username', 'Username', 'text',
              'You sign in with it. Lower-case letters, digits, - and _; it cannot be changed later.') +
            field('display-name', 'Your name', 'text', '') +
            passwordFields() +
          '<button type="submit" class="btn" id="submit-btn">Create Account</button></form>';
        var username = document.getElementById('username');
        username.value = data.suggestedUsername || '';
        username.setAttribute('autocomplete', 'username');
        username.setAttribute('maxlength', '64');
        var name = document.getElementById('display-name');
        name.value = data.displayName || '';
        name.setAttribute('maxlength', '100');
        bindForm(function () {
          var chosen = username.value.trim();
          var shown = name.value.trim();
          if (!USERNAME_RE.test(chosen) || chosen.length < 2 || chosen.length > 64) {
            throw new Error('A username has 2 to 64 lower-case letters, digits, - and _, and starts with a letter or digit.');
          }
          if (shown.length === 0) throw new Error('Enter your name.');
          return { username: chosen, displayName: shown };
        });
      }

      function bindForm(extra) {
        var form = document.getElementById('accept-form');
        var errorDiv = document.getElementById('form-error');
        var submitBtn = document.getElementById('submit-btn');
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var password = document.getElementById('password').value;
          var confirm = document.getElementById('confirm-password').value;
          errorDiv.innerHTML = '';
          var body;
          try {
            body = extra();
            if (password.length < 8) throw new Error('A password has at least 8 characters.');
            if (password.length > 128) throw new Error('A password has at most 128 characters.');
            if (password !== confirm) throw new Error('The passwords do not match.');
          } catch (err) {
            errorDiv.innerHTML = '<div class="error-msg">' + text(err.message) + '</div>';
            return;
          }
          body.token = token;
          body.password = password;
          submitBtn.disabled = true;
          submitBtn.textContent = 'Creating account…';
          post('/api/invite/accept', body)
            .then(showSuccess)
            .catch(function (err) {
              errorDiv.innerHTML = '<div class="error-msg">' + text(err.message) + '</div>';
              submitBtn.disabled = false;
              submitBtn.textContent = 'Create Account';
            });
        });
      }

      function showSuccess(result) {
        app.className = 'success-card';
        var login = typeof result.loginUrl === 'string' && result.loginUrl.indexOf('https://') === 0
          ? '<a id="login" class="btn btn-link">Go to sign-in</a>' : '';
        var pending = result.accessPending
          ? '<div class="error-msg note-msg">Your access is still being set up — if signing in shows nothing yet, try again in a minute.</div>'
          : '';
        var secret = typeof result.totpUri === 'string' ? (result.totpUri.match(/secret=([A-Z2-7]+)/) || [])[1] : null;
        if (secret) {
          app.innerHTML =
            '<div class="icon">✅</div>' +
            '<h1>Account Created</h1>' +
            '<p>Your account <strong class="accent">' + text(result.username) + '</strong> has been created.</p>' +
            '<p>Scan this QR code with your authenticator app to set up two-factor authentication.</p>' +
            '<div id="qr" class="qr"></div>' +
            '<p class="manual"><strong>Manual entry:</strong> ' + text(secret) + '</p>' +
            '<div class="error-msg note-msg">⚠️ Save this before you leave the page — it is not shown again.</div>' +
            pending + login;
          if (typeof result.totpQr === 'string' && result.totpQr.indexOf(QR_PREFIX) === 0) {
            var img = document.createElement('img');
            img.alt = 'Two-factor QR code';
            img.src = result.totpQr;
            document.getElementById('qr').appendChild(img);
          }
        } else {
          app.innerHTML =
            '<div class="icon">✅</div>' +
            '<h1>Account Created</h1>' +
            '<p>Your account <strong class="accent">' + text(result.username) + '</strong> has been created.</p>' +
            '<p>Ask your administrator to set up two-factor authentication.</p>' +
            pending + login;
        }
        var link = document.getElementById('login');
        if (link) link.href = result.loginUrl;
      }
    })();
  `;

/** The headers nginx sends with the invitation page (Content-Security-Policy by hash, framing, caching). */
export const INVITE_PAGE_HEADERS = authPageHeaders(INVITE_PAGE_SCRIPT);

/**
 * The invitation page: the stock one for `null`, a domain's for its brand.
 * Throws on a brand whose theme is none of Authelia's (the rendering is
 * made from a validated record; anything else is a programming error).
 */
export function renderInvitePage(brand: InviteBrand | null): string {
  if (brand !== null && !(AUTH_BRANDING_THEMES as readonly string[]).includes(brand.theme)) {
    throw new Error('An invitation page is rendered for one of Authelia’s themes');
  }
  return authPageShell({
    brand,
    title: 'Accept Invitation',
    loading: 'Loading invitation…',
    script: INVITE_PAGE_SCRIPT,
  });
}
