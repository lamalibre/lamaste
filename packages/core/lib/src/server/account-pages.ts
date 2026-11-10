/**
 * A person's own account pages on a domain's sign-in host
 * (packages/core/docs/mail-design.md §6):
 *
 * - **`/reset`** — forgot password. Without a token it asks for a username
 *   or an address (`POST /api/account/reset/start`, always answered alike);
 *   opened from the mailed link `https://auth.<domain>/reset#<token>`, it
 *   reads the token from the fragment, takes it out of the address bar,
 *   shows whose account it is (`POST /api/account/reset/lookup`) and sets
 *   the new password with a current authenticator code
 *   (`POST /api/account/reset/finish`).
 * - **`/account/password`** — change password while signed in (behind
 *   Authelia's forward auth): `POST /api/account/password`.
 *
 * As the invitation pages: one rendering per domain with a brand or a
 * language and a stock one, the script and style one text for every brand
 * and language, the words in the data block, a refusal worded by its
 * `code` or status — never the server's own text — so each page's CSP
 * names its script and the shared style by hash.
 */

import { AUTH_BRANDING_THEMES } from '../auth-branding.js';
import {
  ACCOUNT_PASSWORD_API_PATH,
  ACCOUNT_PASSWORD_MAX_LENGTH,
  ACCOUNT_PASSWORD_MIN_LENGTH,
  AUTH_RESET_PATH,
  PASSWORD_RESET_API,
  PASSWORD_RESET_TTL_MINUTES,
} from '../account.js';
import {
  ACCOUNT_PASSWORD_PAGE_KEYS,
  RESET_PAGE_KEYS,
  pageMessage,
  pageMessagesFor,
} from '../page-messages.js';
import type { PageLanguage, PageMessageKey } from '../page-messages.js';
import { AUTH_PAGE_SCRIPT_WORDS, authPageHeaders, authPageShell } from './auth-pages.js';
import type { InviteBrand } from './auth-pages.js';

/**
 * What both account scripts share after the page's words: a form field,
 * an error box, posting JSON to the page's own host and turning a refusal
 * into the page's words, and the password rules. Part of each script's
 * hashed text.
 */
const ACCOUNT_SCRIPT_HELPERS = String.raw`
      function failure(words) {
        var err = new Error(words);
        err.lamaste = true;
        return err;
      }
      function shown(err) { return err && err.lamaste ? err.message : msg('error.generic'); }

      function post(path, body, statusKeys) {
        return fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body)
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (res.ok) return data;
            var err = failure(refusal(res.status, data, statusKeys));
            err.status = res.status;
            throw err;
          });
        }, function () { throw failure(msg('error.generic')); });
      }

      function field(id, label, type, hint, autocomplete) {
        return '<div class="field"><label for="' + id + '">' + text(label) + '</label>' +
          '<input type="' + type + '" id="' + id + '" autocomplete="' + autocomplete + '">' +
          (hint ? '<div class="hint">' + text(hint) + '</div>' : '') + '</div>';
      }

      function newPasswordFields() {
        return field('password', msg('account.password'), 'password', msg('account.passwordHint'), 'new-password') +
          field('confirm-password', msg('account.confirmPassword'), 'password', '', 'new-password');
      }

      function checkNewPassword(password, confirm) {
        if (password.length < ${ACCOUNT_PASSWORD_MIN_LENGTH}) throw failure(msg('account.passwordShort'));
        if (password.length > ${ACCOUNT_PASSWORD_MAX_LENGTH}) throw failure(msg('account.passwordLong'));
        if (password !== confirm) throw failure(msg('account.passwordMismatch'));
      }

      function showError(errorDiv, err) {
        errorDiv.innerHTML = '<div class="error-msg">' + text(shown(err)) + '</div>';
      }

      function showMessage(icon, titleKey, body, signIn) {
        app.className = signIn ? 'success-card' : '';
        app.innerHTML =
          '<div class="icon">' + icon + '</div>' +
          '<h1>' + text(msg(titleKey)) + '</h1>' +
          '<p class="subtitle">' + text(body) + '</p>' +
          (signIn ? '<a href="/" class="btn btn-link">' + text(msg('account.goToSignIn')) + '</a>' : '');
      }

      function busy(button, key) {
        var label = button.textContent;
        button.disabled = true;
        button.textContent = msg(key);
        return function () { button.disabled = false; button.textContent = label; };
      }
`;

/** The forgot-password page's script — one text for every brand and language. */
export const RESET_PAGE_SCRIPT = String.raw`
    (function () {
      'use strict';
      var app = document.getElementById('app');
      var TOKEN_RE = /^[a-f0-9]{64}$/;
      var TOTP_RE = /^[0-9]{6}$/;
      var STATUS_KEYS = { 404: 'error.reset_unavailable', 410: 'error.reset_invalid', 429: 'error.tooManyRequests' };
${AUTH_PAGE_SCRIPT_WORDS}${ACCOUNT_SCRIPT_HELPERS}
      // The token: the link's fragment, nothing else of the URL. Then it
      // leaves the address bar and the history: the link is a secret.
      var fragment = window.location.hash.slice(1);
      var token = TOKEN_RE.test(fragment) ? fragment : null;
      try { window.history.replaceState(null, '', '${AUTH_RESET_PATH}'); } catch (e) { /* not fatal */ }

      if (token) {
        post('${PASSWORD_RESET_API.lookup}', { token: token }, STATUS_KEYS)
          .then(showSetForm)
          .catch(function (err) { showInvalid(shown(err)); });
      } else {
        showRequestForm();
      }

      function showInvalid(words) {
        app.innerHTML =
          '<div class="icon">⚠️</div>' +
          '<h1>' + text(msg('reset.unavailableTitle')) + '</h1>' +
          '<p class="subtitle">' + text(words) + '</p>' +
          '<a href="${AUTH_RESET_PATH}" class="btn btn-link btn-outline">' + text(msg('reset.requestAgain')) + '</a>';
      }

      function showRequestForm() {
        app.innerHTML =
          '<div class="icon">🔑</div>' +
          '<h1>' + text(msg('reset.requestTitle')) + '</h1>' +
          '<p class="subtitle">' + text(msg('reset.requestText')) + '</p>' +
          '<div id="form-error"></div>' +
          '<form id="reset-form" novalidate>' +
            field('identifier', msg('reset.identifier'), 'text', '', 'username') +
            '<button type="submit" class="btn" id="submit-btn">' + text(msg('reset.send')) + '</button>' +
          '</form>';
        var input = document.getElementById('identifier');
        input.setAttribute('maxlength', '254');
        var errorDiv = document.getElementById('form-error');
        var button = document.getElementById('submit-btn');
        document.getElementById('reset-form').addEventListener('submit', function (e) {
          e.preventDefault();
          errorDiv.innerHTML = '';
          var identifier = input.value.trim();
          if (identifier.length === 0) { showError(errorDiv, failure(msg('reset.identifierRequired'))); return; }
          var done = busy(button, 'reset.sending');
          post('${PASSWORD_RESET_API.start}', { identifier: identifier }, STATUS_KEYS)
            .then(function () {
              showMessage('✉️', 'reset.sentTitle', format(plural('reset.sent', ${PASSWORD_RESET_TTL_MINUTES}), { minutes: ${PASSWORD_RESET_TTL_MINUTES} }), false);
            })
            .catch(function (err) { done(); showError(errorDiv, err); });
        });
      }

      function showSetForm(data) {
        app.innerHTML =
          '<div class="icon">🔑</div>' +
          '<h1>' + text(msg('reset.setTitle')) + '</h1>' +
          '<p class="subtitle">' + html('reset.setFor', { username: [data.username, 'strong', 'accent'] }) + '</p>' +
          '<div id="form-error"></div>' +
          '<form id="reset-form" novalidate>' +
            newPasswordFields() +
            field('totp', msg('reset.totp'), 'text', msg('reset.totpHint'), 'one-time-code') +
            '<button type="submit" class="btn" id="submit-btn">' + text(msg('reset.save')) + '</button>' +
          '</form>';
        var totp = document.getElementById('totp');
        totp.setAttribute('inputmode', 'numeric');
        totp.setAttribute('maxlength', '6');
        var errorDiv = document.getElementById('form-error');
        var button = document.getElementById('submit-btn');
        document.getElementById('reset-form').addEventListener('submit', function (e) {
          e.preventDefault();
          errorDiv.innerHTML = '';
          var password = document.getElementById('password').value;
          var code = totp.value.replace(/\s+/g, '');
          try {
            checkNewPassword(password, document.getElementById('confirm-password').value);
            if (!TOTP_RE.test(code)) throw failure(msg('reset.totpRule'));
          } catch (err) { showError(errorDiv, err); return; }
          var done = busy(button, 'reset.saving');
          post('${PASSWORD_RESET_API.finish}', { token: token, password: password, totp: code }, STATUS_KEYS)
            .then(function () { showMessage('✅', 'reset.doneTitle', msg('reset.done'), true); })
            .catch(function (err) {
              done();
              // A void token cannot be retried: offer a new link.
              if (err && err.status === 410) showInvalid(err.message);
              else showError(errorDiv, err);
            });
        });
      }
    })();
  `;

/** The change-password page's script — one text for every brand and language. */
export const ACCOUNT_PASSWORD_PAGE_SCRIPT = String.raw`
    (function () {
      'use strict';
      var app = document.getElementById('app');
      var STATUS_KEYS = { 429: 'error.tooManyRequests' };
${AUTH_PAGE_SCRIPT_WORDS}${ACCOUNT_SCRIPT_HELPERS}
      app.innerHTML =
        '<div class="icon">🔑</div>' +
        '<h1>' + text(msg('password.title')) + '</h1>' +
        '<p class="subtitle">' + text(msg('password.text')) + '</p>' +
        '<div id="form-error"></div>' +
        '<form id="password-form" novalidate>' +
          field('current-password', msg('password.current'), 'password', '', 'current-password') +
          newPasswordFields() +
          '<button type="submit" class="btn" id="submit-btn">' + text(msg('password.save')) + '</button>' +
        '</form>';
      var errorDiv = document.getElementById('form-error');
      var button = document.getElementById('submit-btn');
      document.getElementById('password-form').addEventListener('submit', function (e) {
        e.preventDefault();
        errorDiv.innerHTML = '';
        var current = document.getElementById('current-password').value;
        var password = document.getElementById('password').value;
        try {
          if (current.length === 0) throw failure(msg('password.currentRequired'));
          checkNewPassword(password, document.getElementById('confirm-password').value);
        } catch (err) { showError(errorDiv, err); return; }
        var done = busy(button, 'password.saving');
        post('${ACCOUNT_PASSWORD_API_PATH}', { currentPassword: current, newPassword: password }, STATUS_KEYS)
          .then(function () { showMessage('✅', 'password.doneTitle', msg('password.done'), true); })
          .catch(function (err) { done(); showError(errorDiv, err); });
      });
    })();
  `;

/** The headers nginx sends with the forgot-password page. */
export const RESET_PAGE_HEADERS = authPageHeaders(RESET_PAGE_SCRIPT);

/** The headers nginx sends with the change-password page. */
export const ACCOUNT_PASSWORD_PAGE_HEADERS = authPageHeaders(ACCOUNT_PASSWORD_PAGE_SCRIPT);

function assertBrand(brand: InviteBrand | null): void {
  if (brand !== null && !(AUTH_BRANDING_THEMES as readonly string[]).includes(brand.theme)) {
    throw new Error('An account page is rendered for one of Authelia’s themes');
  }
}

function renderAccountPage(
  brand: InviteBrand | null,
  language: PageLanguage,
  page: {
    titleKey: PageMessageKey;
    loadingKey: PageMessageKey;
    keys: readonly PageMessageKey[];
    script: string;
  },
): string {
  assertBrand(brand);
  return authPageShell({
    brand,
    language,
    title: pageMessage(language, page.titleKey),
    loading: pageMessage(language, page.loadingKey),
    messages: pageMessagesFor(language, page.keys),
    script: page.script,
  });
}

/** The forgot-password page in `language`: the stock one for a `null` brand, a domain's for its brand. */
export function renderResetPage(brand: InviteBrand | null, language: PageLanguage = 'en'): string {
  return renderAccountPage(brand, language, {
    titleKey: 'reset.title',
    loadingKey: 'reset.loading',
    keys: RESET_PAGE_KEYS,
    script: RESET_PAGE_SCRIPT,
  });
}

/** The change-password page in `language`: the stock one for a `null` brand, a domain's for its brand. */
export function renderAccountPasswordPage(
  brand: InviteBrand | null,
  language: PageLanguage = 'en',
): string {
  return renderAccountPage(brand, language, {
    titleKey: 'password.title',
    loadingKey: 'password.loading',
    keys: ACCOUNT_PASSWORD_PAGE_KEYS,
    script: ACCOUNT_PASSWORD_PAGE_SCRIPT,
  });
}
