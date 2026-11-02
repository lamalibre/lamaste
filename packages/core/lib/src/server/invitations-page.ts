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
 * Rendered like the invitation page (`invite-page.ts`): the stock page and
 * one per branded domain, one script and one style for every brand, named
 * by hash in {@link INVITATIONS_PAGE_HEADERS}.
 */

import { AUTH_BRANDING_THEMES } from '../auth-branding.js';
import { authPageHeaders, authPageShell } from './auth-pages.js';
import type { InviteBrand } from './auth-pages.js';

/** The page's script — one text for every brand (its hash is in {@link INVITATIONS_PAGE_HEADERS}). */
export const INVITATIONS_PAGE_SCRIPT = String.raw`
    (function () {
      'use strict';
      var app = document.getElementById('app');
      var ROUTE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
      var ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      var STATUS = {
        pending: 'Pending', expired: 'Expired', accepting: 'Being accepted',
        accepted: 'Accepted', revoked: 'Revoked'
      };

      // The route, from the path alone.
      var segments = window.location.pathname.split('/').filter(function (s) { return s !== ''; });
      var route = segments.length === 2 && segments[0] === 'invitations' &&
        segments[1].length <= 64 && ROUTE_RE.test(segments[1]) ? segments[1] : null;
      if (!route) {
        showMessage('Not Found', 'There is no invitations page here.');
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

      function errorOf(answer) {
        return typeof answer.data.error === 'string' ? answer.data.error : 'The request failed.';
      }

      function text(value) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(String(value)));
        return div.innerHTML;
      }

      function formatDate(iso) {
        var date = new Date(iso);
        return isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, {
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
          '<h1>Sign In to Continue</h1>' +
          '<p class="subtitle">Sign in to invite people.</p>' +
          '<a id="sign-in" class="btn btn-link">Sign in</a>' +
          '<p class="muted">If signing in brings you back here again and again, clear this ' +
          'site’s cookies in your browser and sign in once more.</p>';
        document.getElementById('sign-in').href = signIn;
      }

      function load() {
        request('GET', api)
          .then(function (answer) {
            if (answer.status === 401) return showSignIn();
            if (answer.status === 403 || answer.status === 404) {
              return showMessage('Not Available',
                'You cannot invite people into this application, or invitations are turned off for it.');
            }
            if (answer.status !== 200) return showMessage('Something Went Wrong', errorOf(answer));
            render(answer.data);
          })
          .catch(function () { showMessage('Something Went Wrong', 'The relay could not be reached.'); });
      }

      function render(data) {
        var roles = data.policy.grantableRoles;
        var back = typeof data.plugin.siteUrl === 'string' && data.plugin.siteUrl.indexOf('https://') === 0;
        app.innerHTML =
          '<h1>Invite People</h1>' +
          '<p class="subtitle">to <strong class="accent">' + text(data.plugin.displayName) + '</strong></p>' +
          (roles.length === 0
            ? '<div class="error-msg">You may not invite anyone with your role.</div>'
            : '<div id="form-error"></div>' +
              '<form id="invite-form">' +
                '<div class="field"><label for="email">E-mail address</label><input type="email" id="email" required>' +
                  '<div class="hint">Under ' + text(data.policy.emailDomains.join(', ')) + '</div></div>' +
                '<div class="field"><label for="display-name">Their name (optional)</label><input type="text" id="display-name"></div>' +
                '<div class="field"><label for="role">Role</label><select id="role"></select></div>' +
                '<p class="muted" id="bounds"></p>' +
                '<button type="submit" class="btn" id="submit-btn">Create Invitation</button>' +
              '</form>') +
          '<div id="result"></div>' +
          '<h2>Your invitations</h2>' +
          '<div id="list"></div>' +
          (back ? '<a id="back" class="back">← Back to ' + text(data.plugin.displayName) + '</a>' : '');
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
        bounds.textContent = 'A link works once and expires after ' + policy.lifetimeDays +
          (policy.lifetimeDays === 1 ? ' day' : ' days') + '. You have ' + policy.open + ' of ' +
          policy.maxOpen + ' open invitations.';
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
        button.disabled = true;
        request('POST', api, body)
          .then(function (answer) {
            button.disabled = false;
            if (answer.status === 401) return showSignIn();
            if (answer.status !== 201) {
              errorDiv.innerHTML = '<div class="error-msg">' + text(errorOf(answer)) + '</div>';
              return;
            }
            link = typeof answer.data.inviteUrl === 'string' && answer.data.inviteUrl.indexOf('https://') === 0
              ? answer.data.inviteUrl : null;
            linkId = answer.data.invitation && answer.data.invitation.id;
            document.getElementById('invite-form').reset();
            refresh();
          })
          .catch(function () {
            button.disabled = false;
            errorDiv.innerHTML = '<div class="error-msg">The relay could not be reached.</div>';
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
            '<p>The invitation is ready. Send this link yourself — it is shown only now, and ' +
            'whoever opens it first can accept it.</p>' +
          '</div>' +
          '<div class="field"><div class="row"><input type="text" id="link" readonly>' +
            '<button type="button" class="btn btn-small" id="copy">Copy</button></div></div>';
        var input = document.getElementById('link');
        input.value = link;
        document.getElementById('copy').addEventListener('click', function () {
          var button = this;
          input.select();
          var done = function () { button.textContent = 'Copied'; };
          // Where the browser refuses the clipboard, the link stays selected.
          var fallback = function () {
            if (document.execCommand && document.execCommand('copy')) done();
            else button.textContent = 'Selected';
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).then(done, fallback);
          } else {
            fallback();
          }
        });
      }

      function refresh() {
        request('GET', api).then(function (answer) {
          if (answer.status === 200) render(answer.data);
          else load();
        });
      }

      function showList(invitations) {
        var list = document.getElementById('list');
        if (invitations.length === 0) {
          list.innerHTML = '<p class="muted">None yet.</p>';
          return;
        }
        list.innerHTML = '<div class="details-box" id="rows"></div>';
        var rows = document.getElementById('rows');
        invitations.forEach(function (inv) {
          var line = document.createElement('div');
          line.className = 'detail-row';
          var who = inv.email || inv.displayName || '—';
          var when = inv.status === 'accepted' ? formatDate(inv.acceptedAt) : formatDate(inv.expiresAt);
          line.innerHTML =
            '<span class="detail-label">' + text(who) + '<br>' + text(inv.roleLabel) + '</span>' +
            '<span class="detail-value">' + text(STATUS[inv.status] || inv.status) +
              '<br><span class="muted">' + text(when) + '</span></span>';
          if (inv.status === 'pending' && ID_RE.test(inv.id)) {
            var revoke = document.createElement('button');
            revoke.type = 'button';
            revoke.className = 'btn btn-outline btn-small';
            revoke.textContent = 'Revoke';
            // Two clicks: a revoked invitation cannot be taken back.
            revoke.addEventListener('click', function () {
              if (revoke.textContent === 'Revoke') {
                revoke.textContent = 'Really revoke?';
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
                  refresh();
                })
                .catch(function () {
                  revoke.disabled = false;
                  revoke.textContent = 'Revoke';
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
 * The inviter's page: the stock one for `null`, a domain's for its brand.
 * Throws on a brand whose theme is none of Authelia's.
 */
export function renderInvitationsPage(brand: InviteBrand | null): string {
  if (brand !== null && !(AUTH_BRANDING_THEMES as readonly string[]).includes(brand.theme)) {
    throw new Error('An invitations page is rendered for one of Authelia’s themes');
  }
  return authPageShell({
    brand,
    title: 'Invite People',
    loading: 'Loading…',
    script: INVITATIONS_PAGE_SCRIPT,
  });
}
