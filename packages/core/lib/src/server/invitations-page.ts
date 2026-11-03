/**
 * The inviter's page — `https://auth.<the plugin's domain>/invitations/<route>`
 * (packages/core/docs/delegated-invitations-design.md §5): where a person
 * holding an inviting role of an agent-hosted plugin invites colleagues into
 * it. It is Lamaste's, on the sign-in host — another origin than the
 * plugin's site, so nothing the plugin serves can script it, read its
 * answers or frame it; the plugin's own pages only link here.
 *
 * A static file with no data of its own: its script takes the route from
 * its path — and nothing else from its URL, so a plugin cannot prefill it —
 * and talks to `/api/delegated-invitations/<route>` on its own host
 * (`GET` the roles the person may give and their own invitations, `POST` a
 * new one, `DELETE` a pending one), with `fetch`'s default mode, which
 * sends the `Origin` the panel checks. A new invitation's link is shown
 * once, with a copy button: the person sends it through their own mail.
 * Without a session the page links to the domain's sign-in, coming back to
 * itself (built from `location.origin` and the checked route, never from the
 * query).
 *
 * Rendered like the invitation page (`invite-page.ts`): the stock page
 * (English) and one per domain with a brand or a language, one script and
 * one style for every brand and language, named by hash in
 * {@link INVITATIONS_PAGE_HEADERS}; the words come from the page's data
 * block, and a refusal is shown in them — by its `code`, else its status —
 * never in the text the server sent.
 */

import { AUTH_BRANDING_THEMES } from '../auth-branding.js';
import { INVITATIONS_PAGE_KEYS, pageMessage, pageMessagesFor } from '../page-messages.js';
import type { PageLanguage } from '../page-messages.js';
import { AUTH_PAGE_SCRIPT_WORDS, authPageHeaders, authPageShell } from './auth-pages.js';
import type { InviteBrand } from './auth-pages.js';

/** The page's script — one text for every brand and language (its hash is in {@link INVITATIONS_PAGE_HEADERS}). */
export const INVITATIONS_PAGE_SCRIPT = String.raw`
    (function () {
      'use strict';
      var app = document.getElementById('app');
      var ROUTE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
      var ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      var STATUS_KEYS = { 404: 'error.not_found', 429: 'error.tooManyRequests' };
${AUTH_PAGE_SCRIPT_WORDS}
      // The route, from the path alone.
      var segments = window.location.pathname.split('/').filter(function (s) { return s !== ''; });
      var route = segments.length === 2 && segments[0] === 'invitations' &&
        segments[1].length <= 64 && ROUTE_RE.test(segments[1]) ? segments[1] : null;
      if (!route) {
        showMessage(msg('invitations.notFoundTitle'), msg('invitations.notFound'));
        return;
      }
      var api = '/api/delegated-invitations/' + route;
      var signIn = window.location.origin + '/?rd=' +
        encodeURIComponent(window.location.origin + '/invitations/' + route);
      // The link of the invitation just made, shown until it is revoked.
      var link = null;
      var linkId = null;

      load();

      function request(method, path, body) {
        var init = { method: method, headers: { Accept: 'application/json' } };
        if (body !== undefined) {
          init.headers['Content-Type'] = 'application/json';
          init.body = JSON.stringify(body);
        }
        return fetch(path, init).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            return { status: res.status, data: data };
          });
        });
      }

      function formatDate(iso) {
        var date = new Date(iso);
        return isNaN(date.getTime()) ? '' : date.toLocaleString(LANG, {
          year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
      }

      function showMessage(title, message) {
        app.innerHTML =
          '<div class="icon">⚠️</div>' +
          '<h1>' + text(title) + '</h1>' +
          '<p class="subtitle">' + text(message) + '</p>';
      }

      function showSignIn() {
        app.innerHTML =
          '<div class="icon">🔒</div>' +
          '<h1>' + text(msg('invitations.signInTitle')) + '</h1>' +
          '<p class="subtitle">' + text(msg('invitations.signInText')) + '</p>' +
          '<a id="sign-in" class="btn btn-link">' + text(msg('invitations.signIn')) + '</a>' +
          '<p class="muted">' + text(msg('invitations.signInLoop')) + '</p>';
        document.getElementById('sign-in').href = signIn;
      }

      function load() {
        request('GET', api)
          .then(function (answer) {
            if (answer.status === 401) return showSignIn();
            if (answer.status === 403 || answer.status === 404) {
              return showMessage(msg('invitations.unavailableTitle'), msg('invitations.unavailable'));
            }
            if (answer.status !== 200) return showMessage(msg('invitations.errorTitle'), refusal(answer.status, answer.data, STATUS_KEYS));
            render(answer.data);
          })
          .catch(function () { showMessage(msg('invitations.errorTitle'), msg('invitations.unreachable')); });
      }

      function render(data) {
        var roles = data.policy.grantableRoles;
        var back = typeof data.plugin.siteUrl === 'string' && data.plugin.siteUrl.indexOf('https://') === 0;
        app.innerHTML =
          '<h1>' + text(msg('invitations.title')) + '</h1>' +
          '<p class="subtitle">' + html('invitations.to', { plugin: [data.plugin.displayName, 'strong', 'accent'] }) + '</p>' +
          (roles.length === 0
            ? '<div class="error-msg">' + text(msg('invitations.noRole')) + '</div>'
            : '<div id="form-error"></div>' +
              '<form id="invite-form" novalidate>' +
                '<div class="field"><label for="email">' + text(msg('invitations.email')) + '</label><input type="email" id="email" required>' +
                  '<div class="hint">' + text(format('invitations.emailDomains', { domains: data.policy.emailDomains.join(', ') })) + '</div></div>' +
                '<div class="field"><label for="display-name">' + text(msg('invitations.theirName')) + '</label><input type="text" id="display-name"></div>' +
                '<div class="field"><label for="role">' + text(msg('invitations.role')) + '</label><select id="role"></select></div>' +
                '<p class="muted" id="bounds"></p>' +
                '<button type="submit" class="btn" id="submit-btn">' + text(msg('invitations.create')) + '</button>' +
              '</form>') +
          '<div id="result"></div>' +
          '<h2>' + text(msg('invitations.yours')) + '</h2>' +
          '<div id="list-error"></div>' +
          '<div id="list"></div>' +
          (back ? '<a id="back" class="back">' + text(format('invitations.back', { plugin: data.plugin.displayName })) + '</a>' : '');
        if (back) document.getElementById('back').href = data.plugin.siteUrl;
        if (roles.length > 0) {
          var select = document.getElementById('role');
          roles.forEach(function (role) {
            var option = document.createElement('option');
            option.value = role.id;
            option.textContent = role.label;
            select.appendChild(option);
          });
          document.getElementById('email').setAttribute('maxlength', '254');
          document.getElementById('display-name').setAttribute('maxlength', '100');
          document.getElementById('invite-form').addEventListener('submit', submit);
        }
        showBounds(data.policy);
        showResult();
        showList(data.invitations);
      }

      function showBounds(policy) {
        var bounds = document.getElementById('bounds');
        if (!bounds) return;
        bounds.textContent = format(plural('invitations.bounds', policy.lifetimeDays), {
          days: policy.lifetimeDays, open: policy.open, max: policy.maxOpen
        });
      }

      function submit(e) {
        e.preventDefault();
        var errorDiv = document.getElementById('form-error');
        var button = document.getElementById('submit-btn');
        var body = {
          email: document.getElementById('email').value.trim(),
          role: document.getElementById('role').value
        };
        var name = document.getElementById('display-name').value.trim();
        if (name !== '') body.displayName = name;
        errorDiv.innerHTML = '';
        var invalid = body.email === '' ? msg('invitations.emailRequired')
          : !EMAIL_RE.test(body.email) ? msg('invitations.emailInvalid') : null;
        if (invalid !== null) {
          errorDiv.innerHTML = '<div class="error-msg">' + text(invalid) + '</div>';
          return;
        }
        button.disabled = true;
        request('POST', api, body)
          .then(function (answer) {
            button.disabled = false;
            if (answer.status === 401) return showSignIn();
            if (answer.status !== 201) {
              errorDiv.innerHTML = '<div class="error-msg">' + text(refusal(answer.status, answer.data, STATUS_KEYS)) + '</div>';
              return;
            }
            link = typeof answer.data.inviteUrl === 'string' && answer.data.inviteUrl.indexOf('https://') === 0
              ? answer.data.inviteUrl : null;
            linkId = answer.data.invitation && answer.data.invitation.id;
            document.getElementById('invite-form').reset();
            refresh(null);
          })
          .catch(function () {
            button.disabled = false;
            errorDiv.innerHTML = '<div class="error-msg">' + text(msg('invitations.unreachable')) + '</div>';
          });
      }

      function showResult() {
        var result = document.getElementById('result');
        if (!result) return;
        if (link === null) {
          result.innerHTML = '';
          return;
        }
        result.innerHTML =
          '<div class="error-msg note-msg">' +
            '<p>' + text(msg('invitations.ready')) + '</p>' +
          '</div>' +
          '<div class="field"><div class="row"><input type="text" id="link" readonly>' +
            '<button type="button" class="btn btn-small" id="copy">' + text(msg('invitations.copy')) + '</button></div></div>';
        var input = document.getElementById('link');
        input.value = link;
        document.getElementById('copy').addEventListener('click', function () {
          var button = this;
          input.select();
          var done = function () { button.textContent = msg('invitations.copied'); };
          // Where the browser refuses the clipboard, the link stays selected.
          var fallback = function () {
            if (document.execCommand && document.execCommand('copy')) done();
            else button.textContent = msg('invitations.selected');
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).then(done, fallback);
          } else {
            fallback();
          }
        });
      }

      // Render again; a refusal of the last action, if any, above the list.
      function refresh(notice) {
        request('GET', api).then(function (answer) {
          if (answer.status !== 200) return load();
          render(answer.data);
          if (notice) {
            document.getElementById('list-error').innerHTML = '<div class="error-msg">' + text(notice) + '</div>';
          }
        });
      }

      function showList(invitations) {
        var list = document.getElementById('list');
        if (invitations.length === 0) {
          list.innerHTML = '<p class="muted">' + text(msg('invitations.none')) + '</p>';
          return;
        }
        list.innerHTML = '<div class="details-box" id="rows"></div>';
        var rows = document.getElementById('rows');
        invitations.forEach(function (inv) {
          var line = document.createElement('div');
          line.className = 'detail-row';
          var who = inv.email || inv.displayName || '—';
          var when = inv.status === 'accepted' ? formatDate(inv.acceptedAt) : formatDate(inv.expiresAt);
          var status = has('status.' + inv.status) ? msg('status.' + inv.status) : inv.status;
          line.innerHTML =
            '<span class="detail-label">' + text(who) + '<br>' + text(inv.roleLabel) + '</span>' +
            '<span class="detail-value">' + text(status) +
              '<br><span class="muted">' + text(when) + '</span></span>';
          if (inv.status === 'pending' && ID_RE.test(inv.id)) {
            var revoke = document.createElement('button');
            revoke.type = 'button';
            revoke.className = 'btn btn-outline btn-small';
            revoke.textContent = msg('invitations.revoke');
            // Two clicks: a revoked invitation cannot be taken back. The
            // first click sets a flag on the button, never read from its label.
            revoke.addEventListener('click', function () {
              if (revoke.getAttribute('data-confirm') !== 'yes') {
                revoke.setAttribute('data-confirm', 'yes');
                revoke.textContent = msg('invitations.reallyRevoke');
                return;
              }
              revoke.disabled = true;
              request('DELETE', api + '/' + inv.id)
                .then(function (answer) {
                  if (answer.status === 401) return showSignIn();
                  if (inv.id === linkId && answer.status === 200) {
                    link = null;
                    linkId = null;
                  }
                  refresh(answer.status === 200 ? null : refusal(answer.status, answer.data, STATUS_KEYS));
                })
                .catch(function () {
                  revoke.disabled = false;
                  revoke.removeAttribute('data-confirm');
                  revoke.textContent = msg('invitations.revoke');
                });
            });
            line.appendChild(revoke);
          }
          rows.appendChild(line);
        });
      }
    })();
  `;

/** The headers nginx sends with the inviter's page. */
export const INVITATIONS_PAGE_HEADERS = authPageHeaders(INVITATIONS_PAGE_SCRIPT);

/**
 * The inviter's page in `language` (English by default): the stock one for
 * a `null` brand, a domain's for its brand. Throws on a brand whose theme
 * is none of Authelia's.
 */
export function renderInvitationsPage(
  brand: InviteBrand | null,
  language: PageLanguage = 'en',
): string {
  if (brand !== null && !(AUTH_BRANDING_THEMES as readonly string[]).includes(brand.theme)) {
    throw new Error('An invitations page is rendered for one of Authelia’s themes');
  }
  return authPageShell({
    brand,
    language,
    title: pageMessage(language, 'invitations.title'),
    loading: pageMessage(language, 'invitations.loading'),
    messages: pageMessagesFor(language, INVITATIONS_PAGE_KEYS),
    script: INVITATIONS_PAGE_SCRIPT,
  });
}
