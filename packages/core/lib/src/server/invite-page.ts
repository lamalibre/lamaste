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
 * English, written by serverd to `/var/www/lamaste/invite/index.html`), and
 * one per domain with a brand or a language (`renderInvitePage(brand,
 * language)`, `invite/index.html` of the domain's rendering, which the
 * domain's auth vhost serves first — packages/core/docs/auth-branding-design.md,
 * page-language-design.md). They differ only in markup — `lang`, the title,
 * a header with the brand's name, tagline and logo, a link to `/brand.css`,
 * which carries the brand's colours, and the data block of the page's
 * words: the inline script and style are the same text for every brand and
 * language, so the headers nginx sends with the page
 * ({@link INVITE_PAGE_HEADERS}) name them by hash. The script never shows
 * the text of a refusal the server sent: a refusal's `code`, else its
 * status, picks the page's own words. Nothing loads
 * from another host: the two-factor QR code is an SVG the panel renders
 * into the accept answer.
 */

import { AUTH_PAGE_DEFAULT_ACCENT, AUTH_PAGE_DEFAULT_ACCENT_LIGHT } from '../auth-branding.js';
import { AUTH_BRANDING_THEMES } from '../auth-branding.js';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from '../constants.js';
import { DISPLAY_NAME_LINK_PATTERN } from '../text-rules.js';
import { INVITE_PAGE_KEYS, pageMessage, pageMessagesFor } from '../page-messages.js';
import type { PageLanguage } from '../page-messages.js';
import { AUTH_PAGE_SCRIPT_WORDS, authPageHeaders, authPageShell } from './auth-pages.js';
import type { InviteBrand } from './auth-pages.js';

export type { InviteBrand } from './auth-pages.js';
export { INVITE_PAGE_LOGO_PATH } from './auth-pages.js';

/** The accent of the stock page (cyan-400) on the dark palette … */
export const INVITE_PAGE_DEFAULT_ACCENT = AUTH_PAGE_DEFAULT_ACCENT;
/** … and on the light one (cyan-600: readable on white). */
export const INVITE_PAGE_DEFAULT_ACCENT_LIGHT = AUTH_PAGE_DEFAULT_ACCENT_LIGHT;

/** The page's script — one text for every brand and language (its hash is in {@link INVITE_PAGE_HEADERS}). */
export const INVITE_PAGE_SCRIPT = String.raw`
    (function () {
      'use strict';
      var app = document.getElementById('app');
      var TOKEN_RE = /^[a-f0-9]{64}$/;
      var USERNAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
      var NAME_LINK_RE = new RegExp(${JSON.stringify(DISPLAY_NAME_LINK_PATTERN)}, 'iu');
      var QR_PREFIX = 'data:image/svg+xml;base64,';
      var STATUS_KEYS = { 404: 'error.invitation_not_found', 410: 'error.invitation_closed', 429: 'error.tooManyRequests' };
${AUTH_PAGE_SCRIPT_WORDS}
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
        showError(msg('invite.invalidLink'));
        return;
      }

      post('/api/invite/lookup', { token: token })
        .then(function (data) {
          if (data.kind === 'delegated') showDelegatedForm(data);
          else showAdminForm(data);
        })
        .catch(function (err) { showError(shown(err)); });

      // An error this page raised carries words of its own; anything else
      // (a script error) is shown as the generic text.
      function failure(words) {
        var err = new Error(words);
        err.lamaste = true;
        return err;
      }
      function shown(err) { return err && err.lamaste ? err.message : msg('error.generic'); }

      // action: the form that sent it — a refusal's words for that form
      // come first (an administrator's invitation has no username to change).
      function post(path, body, action) {
        return fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body)
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (res.ok) return data;
            throw failure(refusal(res.status, data, STATUS_KEYS, action));
          });
        }, function () { throw failure(msg('error.generic')); });
      }

      function formatDate(iso) {
        var date = new Date(iso);
        return isNaN(date.getTime()) ? '' : date.toLocaleString(LANG, {
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
          '<h1>' + text(msg('invite.unavailableTitle')) + '</h1>' +
          '<p class="subtitle">' + text(message) + '</p>';
      }

      function passwordFields() {
        return field('password', msg('invite.password'), 'password', msg('invite.passwordHint')) +
          field('confirm-password', msg('invite.confirmPassword'), 'password', '');
      }

      function submitButton() {
        return '<button type="submit" class="btn" id="submit-btn">' + text(msg('invite.create')) + '</button>';
      }

      function showAdminForm(data) {
        app.innerHTML =
          '<div class="icon">✉️</div>' +
          '<h1>' + text(msg('invite.invitedTitle')) + '</h1>' +
          '<p class="subtitle">' + text(msg('invite.adminSubtitle')) + '</p>' +
          '<div class="details-box">' +
            row(msg('invite.username'), data.username) + row(msg('invite.email'), data.email) +
            row(msg('invite.expires'), formatDate(data.expiresAt)) +
          '</div>' +
          '<div id="form-error"></div>' +
          '<form id="accept-form" novalidate>' + passwordFields() + submitButton() + '</form>';
        bindForm(function () { return {}; }, 'admin');
      }

      function showDelegatedForm(data) {
        var plugin = [data.plugin, 'strong', 'accent'];
        var role = [data.role, 'strong'];
        app.innerHTML =
          '<div class="icon">✉️</div>' +
          '<h1>' + text(msg('invite.invitedTitle')) + '</h1>' +
          '<p class="subtitle">' + (data.invitedBy
            ? html('invite.delegatedBy', { inviter: data.invitedBy, plugin: plugin, role: role })
            : html('invite.delegated', { plugin: plugin, role: role })) + '</p>' +
          '<div class="details-box">' +
            row(msg('invite.email'), data.email) + row(msg('invite.expires'), formatDate(data.expiresAt)) +
          '</div>' +
          '<div id="form-error"></div>' +
          '<form id="accept-form" novalidate>' +
            field('username', msg('invite.username'), 'text', msg('invite.usernameHint')) +
            field('display-name', msg('invite.yourName'), 'text', '') +
            passwordFields() + submitButton() + '</form>';
        var username = document.getElementById('username');
        username.value = data.suggestedUsername || '';
        username.setAttribute('autocomplete', 'username');
        username.setAttribute('maxlength', '${USERNAME_MAX_LENGTH}');
        var name = document.getElementById('display-name');
        name.value = data.displayName || '';
        name.setAttribute('maxlength', '100');
        bindForm(function () {
          var chosen = username.value.trim();
          var shownName = name.value.trim();
          if (!USERNAME_RE.test(chosen) || chosen.length < ${USERNAME_MIN_LENGTH} || chosen.length > ${USERNAME_MAX_LENGTH}) {
            throw failure(format('invite.usernameRule', { min: ${USERNAME_MIN_LENGTH}, max: ${USERNAME_MAX_LENGTH} }));
          }
          if (shownName.length === 0) throw failure(msg('invite.nameRequired'));
          if (NAME_LINK_RE.test(shownName.replace(/[\u3002\uff0e\uff61]/g, '.'))) {
            throw failure(msg('invite.nameLooksLikeLink'));
          }
          return { username: chosen, displayName: shownName };
        });
      }

      function bindForm(extra, action) {
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
            if (password.length < 8) throw failure(msg('invite.passwordShort'));
            if (password.length > 128) throw failure(msg('invite.passwordLong'));
            if (password !== confirm) throw failure(msg('invite.passwordMismatch'));
          } catch (err) {
            errorDiv.innerHTML = '<div class="error-msg">' + text(shown(err)) + '</div>';
            return;
          }
          body.token = token;
          body.password = password;
          submitBtn.disabled = true;
          submitBtn.textContent = msg('invite.creating');
          post('/api/invite/accept', body, action)
            .then(showSuccess)
            .catch(function (err) {
              errorDiv.innerHTML = '<div class="error-msg">' + text(shown(err)) + '</div>';
              submitBtn.disabled = false;
              submitBtn.textContent = msg('invite.create');
            });
        });
      }

      function showSuccess(result) {
        app.className = 'success-card';
        var login = typeof result.loginUrl === 'string' && result.loginUrl.indexOf('https://') === 0
          ? '<a id="login" class="btn btn-link">' + text(msg('invite.goToSignIn')) + '</a>' : '';
        var pending = result.accessPending
          ? '<div class="error-msg note-msg">' + text(msg('invite.accessPending')) + '</div>'
          : '';
        var created = '<p>' + html('invite.created', { username: [result.username, 'strong', 'accent'] }) + '</p>';
        var secret = typeof result.totpUri === 'string' ? (result.totpUri.match(/secret=([A-Z2-7]+)/) || [])[1] : null;
        if (secret) {
          app.innerHTML =
            '<div class="icon">✅</div>' +
            '<h1>' + text(msg('invite.createdTitle')) + '</h1>' + created +
            '<p>' + text(msg('invite.scanQr')) + '</p>' +
            '<div id="qr" class="qr"></div>' +
            '<p class="manual"><strong>' + text(msg('invite.manualEntry')) + '</strong> ' + text(secret) + '</p>' +
            '<div class="error-msg note-msg">⚠️ ' + text(msg('invite.saveNow')) + '</div>' +
            pending + login;
          if (typeof result.totpQr === 'string' && result.totpQr.indexOf(QR_PREFIX) === 0) {
            var img = document.createElement('img');
            img.alt = msg('invite.qrAlt');
            img.src = result.totpQr;
            document.getElementById('qr').appendChild(img);
          }
        } else {
          app.innerHTML =
            '<div class="icon">✅</div>' +
            '<h1>' + text(msg('invite.createdTitle')) + '</h1>' + created +
            '<p>' + text(msg('invite.askAdminTotp')) + '</p>' +
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
 * The invitation page in `language` (English by default): the stock one for
 * a `null` brand, a domain's for its brand. Throws on a brand whose theme is
 * none of Authelia's (the rendering is made from a validated record;
 * anything else is a programming error).
 */
export function renderInvitePage(brand: InviteBrand | null, language: PageLanguage = 'en'): string {
  if (brand !== null && !(AUTH_BRANDING_THEMES as readonly string[]).includes(brand.theme)) {
    throw new Error('An invitation page is rendered for one of Authelia’s themes');
  }
  return authPageShell({
    brand,
    language,
    title: pageMessage(language, 'invite.title'),
    loading: pageMessage(language, 'invite.loading'),
    messages: pageMessagesFor(language, INVITE_PAGE_KEYS),
    script: INVITE_PAGE_SCRIPT,
  });
}
