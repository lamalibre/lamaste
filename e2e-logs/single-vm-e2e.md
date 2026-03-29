# Single-VM E2E Test Results

> Run at `2026-03-29 09:07:46 UTC`


============================================================================
  Portlama End-to-End Test Suite
============================================================================

  BASE_URL:       https://127.0.0.1:9292
  SKIP_DNS_TESTS: 1
  Date:           2026-03-29 09:07:47 UTC

  Running: 01-fresh-install.sh

============================================================================
 Portlama E2E: 01 — Fresh Install
============================================================================


--- Node.js installation ---
  [PASS] Node.js installed: v20.20.0

--- Panel server service ---
  [PASS] portlama-panel service is active

--- Health endpoint ---
  [PASS] Health endpoint returns status: ok
  [PASS] Health endpoint returns a version

--- Panel client static files ---
  [PASS] Panel client served at / (HTTP 200)
  [PASS] Response contains HTML content
  [PASS] Response contains React root element

--- nginx service ---
  [PASS] nginx service is active
  [PASS] nginx configuration syntax is valid

============================================================================
  Results: 9 passed, 0 failed, 0 skipped (9 total)
============================================================================

  Running: 02-mtls-enforcement.sh

============================================================================
 Portlama E2E: 02 — mTLS Enforcement
============================================================================


--- Request without client certificate ---
  [PASS] Request without cert rejected (HTTP 400)

--- Request with valid client certificate ---
  [PASS] Request with valid cert returns HTTP 200
  [PASS] Health endpoint returns ok with valid cert

--- Request with invalid certificate ---
  [PASS] Request with untrusted cert rejected (HTTP 400)

--- Certificate validity check ---
  [PASS] Client certificate has valid expiry: notAfter=Mar 28 09:06:15 2028 GMT
  [PASS] Client certificate is signed by the CA

============================================================================
  Results: 6 passed, 0 failed, 0 skipped (6 total)
============================================================================

  Running: 03-onboarding-flow.sh

============================================================================
 Portlama E2E: 03 — Onboarding Flow
============================================================================


--- Initial onboarding status ---
  [INFO] Current onboarding status: COMPLETED
  [INFO] Onboarding already completed — testing post-completion behavior
  [PASS] POST /onboarding/domain returns 410 after completion
  [PASS] POST /onboarding/verify-dns returns 410 after completion
  [PASS] POST /onboarding/provision returns 410 after completion
  [PASS] GET /onboarding/status still returns 200

============================================================================
  Results: 4 passed, 0 failed, 0 skipped (4 total)
============================================================================

  Running: 04-tunnel-lifecycle.sh

============================================================================
 Portlama E2E: 04 — Tunnel Lifecycle
============================================================================


--- Pre-flight: check onboarding is complete ---

--- Create tunnel ---
  [PASS] Tunnel creation returned ok: true
  [PASS] Tunnel subdomain matches
  [PASS] Tunnel port matches
  [PASS] Tunnel has an ID
  [PASS] Tunnel has an FQDN
  [PASS] Tunnel has a createdAt timestamp
  [INFO] Created tunnel ID: bbfe0dbd-f971-4f17-a37c-c67c344dfa4c

--- Verify tunnel in list ---
  [PASS] Tunnel appears in GET /api/tunnels

--- Verify nginx configuration ---
  [PASS] Nginx vhost exists at /etc/nginx/sites-enabled/portlama-app-e2etest-1774775267
  [PASS] nginx -t passes after tunnel creation

--- Validation: reserved subdomain ---
  [PASS] Reserved subdomain 'panel' rejected (HTTP 400)

--- Validation: duplicate subdomain ---
  [PASS] Duplicate subdomain rejected (HTTP 400)

--- Validation: duplicate port ---
  [PASS] Duplicate port rejected (HTTP 400)

--- Validation: invalid port ---
  [PASS] Port below 1024 rejected (HTTP 400)

--- Mac plist endpoint ---
  [PASS] Mac plist endpoint returns plist content

--- Disable tunnel ---
  [PASS] Tunnel disable returned ok: true
  [PASS] Tunnel shows as disabled in list
  [PASS] Nginx sites-enabled symlink removed for disabled tunnel
  [PASS] nginx -t passes after tunnel disable
  [PASS] Disabled tunnel excluded from plist

--- Re-enable tunnel ---
  [PASS] Tunnel re-enable returned ok: true
  [PASS] Tunnel shows as enabled in list
  [PASS] Nginx vhost restored for re-enabled tunnel
  [PASS] nginx -t passes after tunnel re-enable
  [PASS] Re-enabled tunnel included in plist

--- Toggle nonexistent tunnel ---
  [PASS] Toggle nonexistent tunnel returns 404

--- Delete tunnel ---
  [PASS] Tunnel deletion returned ok: true
  [PASS] Tunnel no longer in list after deletion
  [PASS] Nginx vhost removed after tunnel deletion
  [PASS] nginx -t passes after tunnel deletion

--- Delete nonexistent tunnel ---
  [PASS] Delete nonexistent tunnel returns 404

============================================================================
  Results: 30 passed, 0 failed, 0 skipped (30 total)
============================================================================

  Running: 05-user-lifecycle.sh

============================================================================
 Portlama E2E: 05 — User Lifecycle
============================================================================


--- Pre-flight: check onboarding is complete ---

--- Create user ---
  [PASS] User creation returned ok: true
  [PASS] Username matches
  [PASS] Display name matches
  [PASS] Email matches

--- Verify user in list ---
  [PASS] User appears in GET /api/users
  [PASS] No password field in user list response
  [PASS] No bcrypt hash in user list response

--- Validation: duplicate username ---
  [PASS] Duplicate username rejected (HTTP 409)

--- Validation: invalid input ---
  [PASS] Incomplete user data rejected (HTTP 400)
  [PASS] Short password rejected (HTTP 400)

--- Reset TOTP ---
  [PASS] TOTP reset returned ok: true
  [PASS] TOTP URI is a valid otpauth:// URI

--- TOTP for nonexistent user ---
  [PASS] TOTP reset for nonexistent user returns 404

--- Update user ---
  [PASS] User update returned ok: true
  [PASS] Display name updated
  [PASS] Display name persisted after update

--- Update nonexistent user ---
  [PASS] Update nonexistent user returns 404

--- Delete user ---
  [PASS] User deletion returned ok: true
  [PASS] User no longer in list after deletion

--- Cannot delete last user ---
  [INFO] Cannot test last-user protection — 2 users exist (need exactly 1)
  [INFO] This scenario is tested when only the admin user remains

--- Delete nonexistent user ---
  [PASS] Delete nonexistent user returns 404

============================================================================
  Results: 20 passed, 0 failed, 0 skipped (20 total)
============================================================================

  Running: 06-service-control.sh

============================================================================
 Portlama E2E: 06 — Service Control
============================================================================


--- Pre-flight: check onboarding is complete ---

--- List services ---
  [PASS] GET /api/services returns 4 services
  [PASS] Service 'nginx' is in the service list
  [PASS] Service 'chisel' is in the service list
  [PASS] Service 'authelia' is in the service list
  [PASS] Service 'portlama-panel' is in the service list
  [PASS] nginx status is 'active'

--- Restart nginx ---
  [PASS] nginx restart request accepted
  [PASS] nginx is active after restart

--- Reload nginx ---
  [PASS] nginx reload returned ok: true

--- Cannot stop portlama-panel ---
  [PASS] Cannot stop portlama-panel (HTTP 400)
  [PASS] Error message explains why panel cannot be stopped

--- Restart portlama-panel is allowed ---
  [PASS] portlama-panel restart request accepted
  [PASS] Panel is responsive after restart

--- Invalid service name ---
  [PASS] Unknown service rejected (HTTP 400)

--- Invalid action ---
  [PASS] Invalid action 'destroy' rejected (HTTP 400)

============================================================================
  Results: 15 passed, 0 failed, 0 skipped (15 total)
============================================================================

  Running: 07-cert-renewal.sh

============================================================================
 Portlama E2E: 07 — Certificate Renewal
============================================================================


--- Pre-flight: check onboarding is complete ---

--- List certificates ---
  [PASS] GET /api/certs returns 6 certificates
  [PASS] Certificate has a type field
  [PASS] Certificate has a domain field
  [PASS] Certificate has an expiresAt field
  [PASS] Certificate has numeric daysUntilExpiry: 89

--- Force renew certificate ---
  [SKIP] Certificate renewal requires real Let's Encrypt — skipping

--- Renew nonexistent certificate ---
  [SKIP] Certbot test requires real infrastructure — skipping

--- Auto-renew timer status ---
  [PASS] Certbot auto-renew timer is active
  [PASS] Auto-renew has a next run time

============================================================================
  Results: 7 passed, 0 failed, 2 skipped (9 total)
============================================================================

  Running: 08-mtls-rotation.sh

============================================================================
 Portlama E2E: 08 — mTLS Rotation
============================================================================


--- Pre-flight: check onboarding is complete ---

--- Current cert fingerprint (before rotation) ---
  [INFO] Current cert fingerprint: sha256 Fingerprint=14:C1:AC:66:8E:9B:9B:1F:F7:0A:C4:DF:42:B5:03:7B:0D:F6:6D:BF:EA:F0:79:BE:AB:B1:7F:4A:F3:97:7D:AA

--- Rotate mTLS certificate ---
  [PASS] Rotation response contains p12 password
  [PASS] Rotation response contains expiry: 2028-03-28T09:08:17.000Z
  [INFO] Rotation warning: Your current browser certificate is now invalid. Download and import the new certificate before closing this page.

--- Download rotated certificate ---
  [PASS] Downloaded client.p12 (HTTP 200)
  [PASS] Downloaded file is a valid PKCS12
  [INFO] New cert fingerprint: sha256 Fingerprint=A4:B8:4B:79:9F:68:75:E7:65:F8:0A:1E:10:E5:3A:3C:62:E6:41:F7:C4:49:5C:B3:52:8F:3A:71:C4:62:62:E9
  [PASS] New cert has different fingerprint than old cert

--- Verify API access with current credentials ---
  [PASS] API still accessible after rotation

============================================================================
  Results: 6 passed, 0 failed, 0 skipped (6 total)
============================================================================

  Running: 09-ip-fallback.sh

============================================================================
 Portlama E2E: 09 — IP Fallback
============================================================================


--- Determine server IP ---
  [INFO] Server IP: 192.168.2.15

--- Health endpoint via IP ---
  [PASS] Health endpoint accessible via IP:9292

--- Static files via IP ---
  [PASS] Panel client served via IP (HTTP 200)

--- Onboarding status via IP ---
  [INFO] Onboarding status via IP: COMPLETED
  [PASS] Onboarding status endpoint works via IP

--- Management API via IP (if onboarding complete) ---
  [PASS] Services endpoint works via IP (4 services)
  [PASS] Tunnels endpoint works via IP
  [PASS] Users endpoint works via IP
  [PASS] System stats endpoint works via IP

--- IP access independence from domain nginx ---
  [PASS] IP fallback is reliable (second check)

============================================================================
  Results: 8 passed, 0 failed, 0 skipped (8 total)
============================================================================

  Running: 10-resilience.sh

============================================================================
 Portlama E2E: 10 — Resilience
============================================================================


--- Pre-flight: check onboarding is complete ---
  [INFO] Service nginx status before tests: active
  [INFO] Service chisel status before tests: active
  [INFO] Service authelia status before tests: active
  [INFO] Service portlama-panel status before tests: active

--- nginx failure and recovery ---
  [INFO] Stopping nginx...
  [PASS] API shows nginx as 'inactive' after stop
  [PASS] nginx restart via API returned ok: true
  [PASS] nginx is active after API restart
  [PASS] API shows nginx as active after restart

--- chisel failure and recovery ---
  [INFO] Stopping chisel...
  [PASS] API shows chisel as 'inactive' after stop
  [PASS] chisel restart via API returned ok: true
  [PASS] chisel is active after API restart

--- authelia failure and recovery ---
  [INFO] Stopping authelia...
  [PASS] API shows authelia as 'inactive' after stop
  [PASS] authelia restart via API returned ok: true
  [PASS] authelia is active after API restart

--- Panel survives all service disruptions ---
  [PASS] Panel health is ok after all disruptions
  [PASS] Service nginx is active at end of resilience test
  [PASS] Service chisel is active at end of resilience test
  [PASS] Service authelia is active at end of resilience test
  [PASS] Service portlama-panel is active at end of resilience test

============================================================================
  Results: 15 passed, 0 failed, 0 skipped (15 total)
============================================================================

  Running: 11-input-validation.sh

============================================================================
 Portlama E2E: 11 — Input Validation & Security Hardening
============================================================================


--- Pre-flight: check onboarding is complete ---

--- Invalid UUID for tunnel operations ---
  [PASS] PATCH /api/tunnels/not-a-uuid returns 400
  [PASS] DELETE /api/tunnels/not-a-uuid returns 400
  [PASS] PATCH /api/tunnels/../etc/passwd rejected (HTTP 404)

--- Invalid UUID for site operations ---
  [PASS] DELETE /api/sites/not-a-uuid returns 400

--- Invalid invite token format ---
  [PASS] GET /api/invite/not-a-valid-token returns 400
  [PASS] POST /api/invite/not-a-valid-token/accept returns 400
  [PASS] Path traversal does not expose /etc/passwd

--- Invalid domain format in certs endpoint ---
  [PASS] POST /api/certs/a..b/renew returns 400
  [PASS] POST /api/certs/.../renew returns 400
  [PASS] POST /api/certs/evil.com;inject/renew returns 400

--- Subdomain injection attempts ---
  [PASS] Subdomain with semicolon rejected (HTTP 400)
  [PASS] Subdomain with newline rejected (HTTP 400)
  [PASS] Subdomain with path traversal rejected (HTTP 400)
  [PASS] Subdomain with uppercase rejected (HTTP 400)
  [PASS] Subdomain with 64 chars rejected (HTTP 400)

--- Port boundary validation ---
  [PASS] Port 0 rejected (HTTP 400)
  [PASS] Port 1023 rejected (HTTP 400)
  [PASS] Port 65536 rejected (HTTP 400)
  [PASS] Port -1 rejected (HTTP 400)
  [PASS] Port 'abc' (string) rejected (HTTP 400)

--- Malformed JSON bodies ---
  [PASS] Invalid JSON body to /api/tunnels returns 400
  [PASS] Empty body to /api/users rejected (HTTP 400)

--- File permissions ---
  [PASS] /etc/portlama/tunnels.json has correct permissions (600)
  [SKIP] /etc/portlama/sites.json not found
  [PASS] panel.json has correct permissions (640)

============================================================================
  Results: 24 passed, 0 failed, 1 skipped (25 total)
============================================================================

  Running: 12-user-invitations.sh

============================================================================
 Portlama E2E: 12 — User Invitations
============================================================================


--- Pre-flight: check onboarding is complete ---

--- Create invitation ---
  [PASS] Invitation creation returned ok: true
  [PASS] Invitation username matches
  [PASS] Invitation email matches
  [PASS] Invitation token is valid 64-char hex
  [PASS] Invitation ID is present
  [PASS] Invitation createdAt is present
  [PASS] Invitation expiresAt is present

--- List invitations ---
  [PASS] Invitation appears in GET /api/invitations
  [PASS] Token is not exposed in invitation list
  [PASS] Invitation status is pending

--- Duplicate invitation ---
  [PASS] Duplicate invitation for same username rejected (HTTP 409)

--- Validation: invalid input ---
  [PASS] Incomplete invitation data rejected (HTTP 400)
  [PASS] Invalid email rejected (HTTP 400)

--- Get invitation details (public endpoint) ---
  [PASS] Public invite details show username
  [PASS] Public invite details show email
  [PASS] Public invite details show expiresAt

--- Invalid token ---
  [PASS] Accept with invalid token returns 404
  [PASS] Malformed token rejected (HTTP 400)

--- Accept invitation (public endpoint) ---
  [PASS] Invitation acceptance returned ok: true
  [PASS] Accepted username matches

--- Verify invited user exists ---
  [PASS] Invited user appears in GET /api/users
  [PASS] Invited user email matches

--- Invitation marked as accepted ---
  [PASS] Invitation status changed to accepted

--- Used token rejection ---
  [PASS] Reusing accepted token returns 410 Gone
  [PASS] GET on used token returns 410 Gone

--- Accept with short password ---
  [PASS] Short password rejected on invite accept (HTTP 400)

--- Cleanup: delete invited user ---
  [PASS] Invited user deletion returned ok: true
  [PASS] Invited user no longer in list after deletion

============================================================================
  Results: 28 passed, 0 failed, 0 skipped (28 total)
============================================================================

  Running: 13-site-lifecycle.sh

============================================================================
 Portlama E2E: 13 — Site Lifecycle
============================================================================


--- Pre-flight: check onboarding is complete ---
  [PASS] Onboarding is complete

--- Create managed static site ---
  [PASS] Site creation returned ok: true
  [PASS] Site has an ID
  [PASS] Site name matches
  [PASS] Site type is managed
  [INFO] Created site: e2esite.test.portlama.local (ID: 707b180c-1ac0-43e2-9001-f877ff6b9846)

--- Verify site in listing ---
  [PASS] Site appears in listing

--- List files — default content ---
  [PASS] Site has default files (count: 1)
  [PASS] Default index.html exists

--- Upload test file ---
  [PASS] File upload returned ok: true

--- Verify uploaded file in listing ---
  [PASS] Uploaded file appears in listing

--- Delete uploaded file ---
  [PASS] File deletion returned ok: true

--- Verify file removed ---
  [PASS] Deleted file no longer in listing

--- Update site settings ---
  [PASS] Settings update returned ok: true
  [PASS] SPA mode is now enabled
  [PASS] SPA mode persisted in listing

--- File extension validation ---
  [PASS] Upload of .php file rejected with 400
  [PASS] Upload of .exe file rejected with 400
  [PASS] Upload of file with no extension rejected with 400
  [PASS] Upload of .css file succeeds

--- Input validation ---
  [PASS] Duplicate site name rejected with 400
  [PASS] Reserved name 'panel' rejected with 400
  [PASS] Reserved name 'auth' rejected with 400
  [PASS] Invalid UUID rejected with 400

--- Delete site ---
  [PASS] Site deletion returned ok: true

--- Verify site removed ---
  [PASS] Deleted site no longer in listing
  [PASS] Deleted site returns 404

============================================================================
  Results: 26 passed, 0 failed, 0 skipped (26 total)
============================================================================

  Running: 15-plugin-lifecycle.sh

============================================================================
 Portlama E2E: 15 — Plugin Lifecycle
============================================================================


--- Pre-flight: check onboarding is complete ---
  [PASS] Onboarding is complete

--- Empty initial plugin list ---
  [PASS] Initial plugin list is empty

--- Plugin install validation ---
  [PASS] Non-@lamalibre package rejected (HTTP 400)
  [PASS] Empty package name rejected (HTTP 400)

--- Plugin detail for non-existent plugin ---
  [PASS] GET non-existent plugin returns 404

--- Enable/disable non-existent plugin ---
  [PASS] Enable non-existent plugin returns 404
  [PASS] Disable non-existent plugin returns 404

--- Uninstall non-existent plugin ---
  [PASS] Uninstall non-existent plugin returns 404

--- Push install config defaults ---
  [PASS] Push install is disabled by default
  [PASS] Default policy ID is 'default'
  [PASS] At least one push install policy exists (count: 1)

--- Push install config update ---
  [PASS] PATCH push-install config returned ok: true
  [PASS] Push install is now enabled

--- Create a push install policy ---
  [PASS] Policy creation returned ok: true
  [PASS] Policy ID matches

--- Verify policy in listing ---
  [PASS] Created policy appears in listing

--- Update the push install policy ---
  [PASS] Policy update returned ok: true
  [PASS] Description updated

--- Cannot delete the default push install policy ---
  [PASS] Cannot delete the default policy (HTTP 400)

--- Delete the e2e-pi-test policy ---
  [PASS] Policy deletion returned ok: true
  [PASS] Deleted policy no longer in listing

--- Push install policy validation ---
  [PASS] POST policy with empty name rejected (HTTP 400)
  [PASS] POST policy with duplicate ID rejected (HTTP 409)
  [PASS] PATCH non-existent policy returns 404
  [PASS] DELETE non-existent policy returns 404

--- Push install enable/disable for agent ---
  [INFO] Found agent: test-agent
  [PASS] Push install enable for agent returned ok: true
  [PASS] pushInstallEnabledUntil is set
  [PASS] Push install disable for agent returned ok: true

--- Push install without global toggle ---
  [PASS] Cannot enable push install when globally disabled (HTTP 400)

--- Push install sessions audit log ---
  [PASS] GET push-install sessions returns a sessions array

--- Push install input validation ---
  [PASS] POST enable with durationMinutes: 0 rejected (HTTP 400)
  [PASS] POST enable with durationMinutes: 9999 rejected (HTTP 400)
  [PASS] PATCH config with non-existent defaultPolicy rejected (HTTP 400)
  [PASS] POST enable for non-existent agent returns 404
  [PASS] DELETE enable for non-existent agent returns 404
  [PASS] POST enable with invalid label format rejected (HTTP 400)
  [PASS] GET plugin with invalid name rejected (HTTP 400)

--- Cleanup ---
  [PASS] Push install disabled globally for cleanup
  [PASS] Push install is disabled after cleanup
  [PASS] Cleanup complete — plugin state restored

============================================================================
  Results: 40 passed, 0 failed, 0 skipped (40 total)
============================================================================

  Running: 16-enrollment-tokens.sh

============================================================================
 Portlama E2E: 16 — Hardware-Bound Certificate Enrollment
============================================================================


--- Pre-flight: check onboarding is complete ---

--- Admin auth mode defaults to p12 ---
  [PASS] Admin auth mode is p12 by default

--- Create enrollment token ---
  [PASS] Token creation returns ok: true
  [PASS] Token is not empty
  [PASS] Token has expiresAt
  [PASS] Token response contains correct label

--- Duplicate token for same label rejected ---
  [PASS] Duplicate token for active label returns 409

--- Public enrollment endpoint reachable without mTLS ---
  [PASS] Enrollment endpoint reachable without mTLS (HTTP 400)

--- Enrollment with invalid token rejected ---
  [PASS] Invalid token rejected with correct message

--- Enroll agent with valid token + CSR ---
  [PASS] Enrollment returns ok: true
  [PASS] Enrolled label matches
  [PASS] Enrollment returns signed certificate
  [PASS] Enrollment returns CA certificate
  [PASS] Enrollment returns serial number
  [PASS] Signed cert has correct CN

--- Token replay rejected (single-use) ---
  [PASS] Token replay returns 401

--- Enrolled agent visible in agent list with hardware-bound method ---
  [PASS] Agent shows enrollmentMethod: hardware-bound

--- P12 download hidden for hardware-bound agent ---
  [PASS] P12 download returns 404 for hardware-bound agent (no P12 on disk)

--- Clean up: revoke test agent ---
  [PASS] Revoked enrollment test agent

--- Admin upgrade to hardware-bound ---
  [PASS] Admin upgrade returns ok: true
  [PASS] Admin upgrade returns signed certificate

--- P12 lockdown after admin upgrade ---
  [PASS] P12 rotation blocked after admin upgrade (HTTP 000000)

--- Revert admin to P12 mode (for other tests) ---
  [PASS] Reverted admin to P12 mode with fresh cert
  [PASS] Admin auth mode reverted to p12

============================================================================
  Results: 23 passed, 0 failed, 0 skipped (23 total)
============================================================================

  Running: 17-panel-2fa.sh

============================================================================
 Portlama E2E: 17 — Panel Built-in TOTP 2FA
============================================================================


--- Pre-flight: check onboarding is complete ---

--- Default state: 2FA disabled ---
  [PASS] 2FA is disabled by default
  [PASS] setupComplete is false by default

--- Setup: generate TOTP secret ---
  [PASS] Setup returns otpauth URI
  [PASS] Setup returns manual key
  [PASS] URI is valid otpauth format

--- Confirm 2FA with valid code ---
  [PASS] Generated TOTP code
  [INFO] Generated TOTP code: 142792
  [PASS] 2FA is now enabled
  [PASS] Session cookie received on confirm
  [PASS] Status shows enabled after confirm

--- IP vhost disabled after enabling 2FA ---
  [PASS] IP:9292 vhost is disabled (HTTP 000)

--- Request without session returns 401 2fa_required ---
  [PASS] Request without session cookie returns 401

--- Authenticated request with session cookie ---
  [PASS] Authenticated request with session cookie returns system stats

--- Disable 2FA ---
  [INFO] Waiting 17s for next TOTP window...
  [PASS] 2FA disabled successfully

--- IP vhost re-enabled after disabling 2FA ---
  [PASS] IP:9292 vhost is re-enabled after disabling 2FA
  [PASS] 2FA status is disabled

--- Reset admin clears 2FA ---
  [PASS] 2FA re-enabled for reset test

  Download the P12 from the panel or copy it
  manually from the server.
  ============================================

  [PASS] 2FA disabled after reset-admin
  [PASS] IP vhost restored after reset-admin

--- Rate limiting on wrong codes ---
  [PASS] Rate limiting kicks in after 6 wrong attempts (HTTP 429)

============================================================================
  Results: 19 passed, 0 failed, 0 skipped (19 total)
============================================================================

  Running: 18-json-installer.sh

============================================================================
 Portlama E2E: 18 — JSON Installer Output
============================================================================


--- create-portlama --json (redeploy mode) ---

--- NDJSON line validation ---
  [PASS] All 5 lines are valid JSON
  [PASS] Step events emitted: 4

--- Complete event validation ---
  [PASS] Exactly one complete event emitted
  [PASS] Server IP present: 192.168.2.15
  [PASS] Panel URL present and uses HTTPS: https://192.168.2.15:9292
  [PASS] P12 path within expected directory: /etc/portlama/pki/client.p12
  [PASS] P12 password path within expected directory: /etc/portlama/pki/.p12-password

--- Step status validation ---
  [PASS] check_environment step present
  [PASS] All step events have valid status values

--- Panel health after redeploy ---
  [PASS] Panel healthy after --json redeploy

============================================================================
  Results: 10 passed, 0 failed, 0 skipped (10 total)
============================================================================

  Running: 19-panel-expose.sh

============================================================================
 Portlama E2E: 19 — Panel Expose Lifecycle
============================================================================


--- Pre-flight: check onboarding is complete ---

--- Verify panel:expose is a valid capability ---
  [PASS] Agent cert with panel:expose created successfully
  [PASS] Agent cert has a p12 password
  [INFO] Created agent cert: panel-e2e-1774775360
  [PASS] Extracted PEM cert and key from .p12

--- Expose panel: check agent-panel-status before expose ---
  [PASS] Panel not exposed initially
  [PASS] No FQDN before expose

--- Expose panel: POST /api/tunnels/expose-panel ---
  [PASS] Expose panel returned ok: true
  [PASS] Panel tunnel has an ID
  [PASS] Panel tunnel type is 'panel'
  [PASS] Panel subdomain matches agent-<label>
  [PASS] Panel tunnel port matches
  [PASS] Panel tunnel has an FQDN
  [PASS] Panel tunnel has a createdAt timestamp
  [PASS] Panel tunnel agentLabel matches
  [INFO] Exposed panel tunnel: agent-panel-e2e-1774775360.test.portlama.local (ID: 26f852a6-010a-476e-a9e7-d2af1f71855d)

--- Verify panel tunnel in tunnel listing ---
  [PASS] Panel tunnel shows type 'panel' in listing
  [PASS] Panel tunnel shows correct agentLabel in listing

--- Verify nginx mTLS vhost created (not app vhost) ---
  [PASS] mTLS panel vhost exists at /etc/nginx/sites-enabled/portlama-agent-panel-agent-panel-e2e-1774775360
  [PASS] No app vhost created (correct — panel uses mTLS vhost)
  [PASS] nginx -t passes after panel expose

--- Verify agent-panel-status after expose ---
  [PASS] Panel shows as enabled after expose
  [PASS] Panel status FQDN matches
  [PASS] Panel status port matches

--- Duplicate expose returns 409 ---
  [PASS] Duplicate panel expose returns 409 Conflict

--- Validation: agent- prefix reserved for non-panel tunnels ---
  [PASS] agent- prefix rejected for non-panel tunnel (HTTP 400)

--- Capability check: agent without panel:expose gets 403 ---
  [PASS] Agent cert without panel:expose created
  [PASS] Expose panel returns 403 without panel:expose capability
  [PASS] Agent panel status returns 403 without panel:expose capability
  [PASS] Retract panel returns 403 without panel:expose capability

--- Capability check: PATCH panel tunnel requires panel:expose ---
  [PASS] PATCH panel tunnel returns 403 without panel:expose

--- Capability check: DELETE panel tunnel requires panel:expose ---
  [PASS] DELETE panel tunnel returns 403 without panel:expose

--- Cross-agent spoofing: generic POST /api/tunnels with type=panel ---
  [PASS] Cross-agent panel tunnel spoofing rejected (HTTP 403)

--- Retract panel: DELETE /api/tunnels/retract-panel ---
  [PASS] Retract panel returned ok: true
  [PASS] Panel tunnel no longer in list after retract
  [PASS] mTLS panel vhost removed after retract
  [PASS] nginx -t passes after panel retract

--- Verify agent-panel-status after retract ---
  [PASS] Panel shows as disabled after retract

--- Retract nonexistent panel returns 404 ---
  [PASS] Retract nonexistent panel returns 404

--- Validation: expose-panel with invalid port ---
  [PASS] Port below 1024 rejected (HTTP 400)

============================================================================
  Results: 37 passed, 0 failed, 0 skipped (37 total)
============================================================================

  [INFO] Cleaning up test resources...
{"error":"No panel tunnel found for this agent"}{"ok":true,"label":"panel-e2e-1774775360"}{"ok":true,"label":"nopanel-e2e"}  Running: 20-agent-json-setup.sh

============================================================================
 Portlama E2E: 20 — Agent JSON Setup Output
============================================================================


--- Pre-flight: check onboarding is complete ---
  [SKIP] portlama-agent not found in PATH

============================================================================
  Results: 0 passed, 0 failed, 1 skipped (1 total)
============================================================================


============================================================================
  Test Suite Summary
============================================================================

  [PASS] 01-fresh-install.sh
  [PASS] 02-mtls-enforcement.sh
  [PASS] 03-onboarding-flow.sh
  [PASS] 04-tunnel-lifecycle.sh
  [PASS] 05-user-lifecycle.sh
  [PASS] 06-service-control.sh
  [PASS] 07-cert-renewal.sh
  [PASS] 08-mtls-rotation.sh
  [PASS] 09-ip-fallback.sh
  [PASS] 10-resilience.sh
  [PASS] 11-input-validation.sh
  [PASS] 12-user-invitations.sh
  [PASS] 13-site-lifecycle.sh
  [PASS] 15-plugin-lifecycle.sh
  [PASS] 16-enrollment-tokens.sh
  [PASS] 17-panel-2fa.sh
  [PASS] 18-json-installer.sh
  [PASS] 19-panel-expose.sh
  [PASS] 20-agent-json-setup.sh

  Total: 19 tests — 19 passed, 0 failed

  SUITE PASSED
