/**
 * Generates the static HTML page shown when a browser visits without a client certificate.
 * nginx serves this via error_page 495/496 so the user sees helpful instructions
 * instead of a raw "400 Bad Request".
 *
 * @param {{ ip: string, pkiDir: string }} ctx - Installer context with IP and PKI path.
 * @returns {string} Complete HTML document.
 */
export function generateCertHelpPage(ctx) {
  const ip = ctx.ip;
  const scpCmd = `scp root@${ip}:${ctx.pkiDir}/client.p12 .`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Portlama — Certificate Required</title>
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
      max-width: 640px; width: 100%; padding: 2.5rem;
    }
    .icon { text-align: center; font-size: 3rem; margin-bottom: 1rem; }
    h1 { color: #f4f4f5; font-size: 1.25rem; text-align: center; margin-bottom: 0.5rem; }
    .subtitle { text-align: center; margin-bottom: 2rem; font-size: 0.875rem; }
    .step { margin-bottom: 1.75rem; }
    .step-header {
      display: flex; align-items: center; gap: 0.625rem;
      margin-bottom: 0.625rem;
    }
    .step-num {
      background: #22d3ee; color: #09090b; font-weight: 700;
      width: 1.5rem; height: 1.5rem; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.75rem; flex-shrink: 0;
    }
    .step-title { color: #e4e4e7; font-size: 0.9375rem; font-weight: 600; }
    .step-body { margin-left: 2.125rem; font-size: 0.8125rem; line-height: 1.6; }
    code {
      background: #09090b; border: 1px solid #27272a; border-radius: 0.375rem;
      padding: 0.625rem 0.875rem; display: block; margin: 0.5rem 0;
      color: #22d3ee; font-size: 0.8125rem; word-break: break-all;
      cursor: pointer; position: relative;
    }
    code:hover { border-color: #22d3ee; }
    code::after {
      content: 'click to copy'; position: absolute; right: 0.625rem; top: 50%;
      transform: translateY(-50%); color: #52525b; font-size: 0.6875rem;
    }
    code.copied::after { content: 'copied!'; color: #22d3ee; }
    .platform { margin-bottom: 0.375rem; }
    .platform strong { color: #e4e4e7; }
    .note {
      background: #1c1917; border: 1px solid #422006; border-radius: 0.5rem;
      padding: 0.875rem 1rem; margin-top: 1.5rem; font-size: 0.8125rem;
      line-height: 1.5;
    }
    .note strong { color: #fbbf24; }
    .refresh {
      display: block; width: 100%; margin-top: 1.5rem;
      background: #22d3ee; color: #09090b; font-weight: 700;
      border: none; border-radius: 0.5rem; padding: 0.75rem;
      font-size: 0.875rem; cursor: pointer; font-family: inherit;
    }
    .refresh:hover { background: #06b6d4; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">\u{1f510}</div>
    <h1>Client Certificate Required</h1>
    <p class="subtitle">
      This Portlama panel is protected by mTLS.<br>
      Import your client certificate to continue.
    </p>

    <div class="step">
      <div class="step-header">
        <span class="step-num">1</span>
        <span class="step-title">Download your certificate</span>
      </div>
      <div class="step-body">
        Run this on your local machine:
        <code id="scp-cmd">${escapeHtml(scpCmd)}</code>
      </div>
    </div>

    <div class="step">
      <div class="step-header">
        <span class="step-num">2</span>
        <span class="step-title">Import into your browser</span>
      </div>
      <div class="step-body">
        <div class="platform">
          <strong>macOS:</strong> Double-click <code style="display:inline;padding:0.125rem 0.375rem;cursor:default" class="no-copy">client.p12</code>
          &rarr; Keychain Access opens &rarr; <strong style="color:#e4e4e7">select &ldquo;System&rdquo; keychain</strong> (not &ldquo;login&rdquo;)
          &rarr; enter the password from the installer output &rarr; authenticate with your Mac password.
          If you see an &ldquo;Unable to import&rdquo; error for Local Items, ignore it &mdash; the System import succeeds.
          Then find the certificate in the <strong style="color:#e4e4e7">System</strong> keychain &rarr;
          double-click it &rarr; expand <strong style="color:#e4e4e7">Trust</strong> &rarr; set to <strong style="color:#e4e4e7">Always Trust</strong> &rarr; close and authenticate.
        </div>
        <div class="platform">
          <strong>Linux (Chrome):</strong> Settings &rarr; Privacy &amp; Security &rarr; Security &rarr; Manage certificates &rarr; Import
        </div>
        <div class="platform">
          <strong>Windows:</strong> Double-click the file &rarr; Certificate Import Wizard &rarr; enter the password
        </div>
      </div>
    </div>

    <div class="step">
      <div class="step-header">
        <span class="step-num">3</span>
        <span class="step-title">Reload this page</span>
      </div>
      <div class="step-body">
        After importing, your browser will present the certificate automatically.
        You may need to restart your browser first.
      </div>
    </div>

    <div class="note">
      <strong>Where is the password?</strong> The certificate password was printed
      in your terminal when the installer finished. It is also stored on the server
      at <code style="display:inline;padding:0.125rem 0.375rem;color:#fbbf24;cursor:default" class="no-copy">${escapeHtml(ctx.pkiDir)}/.p12-password</code>
    </div>

    <button class="refresh" onclick="location.reload()">
      Reload Page
    </button>
  </div>

  <script>
    document.querySelectorAll('code:not(.no-copy)').forEach(function(el) {
      el.addEventListener('click', function() {
        navigator.clipboard.writeText(el.textContent.trim());
        el.classList.add('copied');
        setTimeout(function() { el.classList.remove('copied'); }, 2000);
      });
    });
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
