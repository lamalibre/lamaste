import { execa } from 'execa';
import { writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const INVITE_DIR = '/var/www/lamaste/invite';

/**
 * Generate and write the invitation acceptance HTML page.
 * Creates the directory and writes index.html via sudo.
 */
export async function writeInvitePage() {
  const html = generateInvitePageHtml();

  await execa('sudo', ['mkdir', '-p', INVITE_DIR]);

  const tmpFile = path.join(tmpdir(), `invite-page-${crypto.randomBytes(4).toString('hex')}`);
  await fsWriteFile(tmpFile, html, 'utf-8');

  await execa('sudo', ['mv', tmpFile, path.join(INVITE_DIR, 'index.html')]);
  await execa('sudo', ['chmod', '644', path.join(INVITE_DIR, 'index.html')]);
}

function generateInvitePageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lamaste — Accept Invitation</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: #09090b; color: #a1a1aa;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: #18181b; border: 1px solid #27272a; border-radius: 0.75rem;
      max-width: 480px; width: 100%; padding: 2.5rem;
    }
    .icon { text-align: center; font-size: 3rem; margin-bottom: 1rem; }
    h1 { color: #f4f4f5; font-size: 1.25rem; text-align: center; margin-bottom: 0.5rem; }
    .subtitle { text-align: center; margin-bottom: 2rem; font-size: 0.875rem; }
    .field { margin-bottom: 1.25rem; }
    .field label {
      display: block; font-size: 0.8125rem; color: #a1a1aa;
      margin-bottom: 0.375rem; font-weight: 600;
    }
    .field input {
      width: 100%; padding: 0.625rem 0.875rem;
      background: #09090b; border: 1px solid #27272a; border-radius: 0.5rem;
      color: #f4f4f5; font-family: inherit; font-size: 0.875rem;
      outline: none; transition: border-color 0.15s;
    }
    .field input:focus { border-color: #22d3ee; }
    .field input:disabled { color: #71717a; cursor: not-allowed; }
    .field .hint { font-size: 0.75rem; color: #52525b; margin-top: 0.25rem; }
    .error-msg {
      background: #1c0f0f; border: 1px solid #7f1d1d; border-radius: 0.5rem;
      padding: 0.75rem 1rem; margin-bottom: 1.25rem;
      font-size: 0.8125rem; color: #fca5a5;
    }
    .success-card { text-align: center; }
    .success-card h1 { color: #4ade80; margin-bottom: 1rem; }
    .success-card p { margin-bottom: 1.5rem; font-size: 0.875rem; line-height: 1.6; }
    .btn {
      display: block; width: 100%;
      background: #22d3ee; color: #09090b; font-weight: 700;
      border: none; border-radius: 0.5rem; padding: 0.75rem;
      font-size: 0.875rem; cursor: pointer; font-family: inherit;
      transition: background-color 0.15s;
    }
    .btn:hover { background: #06b6d4; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-outline {
      background: transparent; border: 1px solid #27272a; color: #a1a1aa;
    }
    .btn-outline:hover { border-color: #22d3ee; color: #f4f4f5; }
    .loading {
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      padding: 3rem 0; font-size: 0.875rem;
    }
    .spinner {
      width: 1.25rem; height: 1.25rem;
      border: 2px solid #27272a; border-top-color: #22d3ee;
      border-radius: 50%; animation: spin 0.6s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .detail-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.5rem 0; border-bottom: 1px solid #27272a;
      font-size: 0.8125rem;
    }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #71717a; }
    .detail-value { color: #e4e4e7; font-weight: 500; }
    .details-box {
      background: #09090b; border: 1px solid #27272a; border-radius: 0.5rem;
      padding: 0.75rem 1rem; margin-bottom: 1.5rem;
    }
  </style>
</head>
<body>
  <div class="card" id="app">
    <div class="loading">
      <div class="spinner"></div>
      Loading invitation...
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
        app.className = 'card success-card';
        var loginBtn = result.loginUrl
          ? '<a href="' + escapeHtml(result.loginUrl) + '" class="btn" style="text-decoration:none;text-align:center;display:block;margin-top:1rem">Go to Login</a>'
          : '';

        if (result.totpUri) {
          app.innerHTML =
            '<div class="icon">\\u2705</div>' +
            '<h1>Account Created</h1>' +
            '<p>Your account <strong style="color:#22d3ee">' + escapeHtml(result.username) + '</strong> has been created.</p>' +
            '<p style="margin-bottom:1.5rem">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.) to set up two-factor authentication.</p>' +
            '<div id="qr-container" style="display:flex;justify-content:center;margin-bottom:1.5rem;background:#fff;border-radius:0.5rem;padding:1rem;max-width:220px;margin-left:auto;margin-right:auto"></div>' +
            '<p style="font-size:0.75rem;color:#52525b;margin-bottom:1rem;word-break:break-all"><strong style="color:#a1a1aa">Manual entry:</strong> ' + escapeHtml(result.totpUri.match(/secret=([^&]+)/)?.[1] || '') + '</p>' +
            '<div class="error-msg" style="background:#0f1c1c;border-color:#134e4a;color:#5eead4;text-align:center">\\u26A0\\uFE0F Save this before navigating away — it cannot be shown again.</div>' +
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
            '<p>Your account <strong style="color:#22d3ee">' + escapeHtml(result.username) + '</strong> has been created successfully.</p>' +
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
</html>`;
}
