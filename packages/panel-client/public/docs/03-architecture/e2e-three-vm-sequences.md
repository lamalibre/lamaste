# Three-VM E2E Test — Sequence Diagrams

## Orchestration Flow

```mermaid
sequenceDiagram
    participant Mac as macOS (Developer)
    participant H as Host VM
    participant A as Agent VM
    participant V as Visitor VM

    rect rgb(40, 40, 60)
    note over Mac: Phase 1 — Create VMs
    Mac->>H: multipass launch 24.04
    Mac->>A: multipass launch 24.04
    Mac->>V: multipass launch 24.04
    end

    rect rgb(40, 60, 40)
    note over Mac,H: Phase 2 — Setup
    Mac->>Mac: npm pack create-portlama
    Mac->>H: transfer tarball
    Mac->>H: npm install -g + create-portlama --dev
    Mac->>H: transfer test scripts
    Mac->>A: transfer test scripts
    Mac->>V: transfer test scripts
    Mac->>H: setup-host.sh (dnsmasq, certbot shim, onboarding, test user, agent cert)
    H-->>Mac: credentials JSON
    Mac->>H: extract agent P12
    H-->>Mac: client.p12
    Mac->>A: transfer agent P12
    Mac->>A: setup-agent.sh (/etc/hosts, chisel, extract PEM certs)
    Mac->>V: setup-visitor.sh (curl, jq, oathtool, /etc/hosts)
    end

    rect rgb(60, 40, 40)
    note over Mac,H: Phase 3 — Single-VM E2E
    Mac->>H: run-all.sh (inside host)
    H-->>Mac: test results + logs
    end

    rect rgb(60, 60, 40)
    note over Mac,V: Phase 4 — Three-VM E2E
    Mac->>Mac: run-all.sh (from macOS, multipass exec into VMs)
    Mac->>H: tests 01–08 (via multipass exec)
    Mac->>A: tests 02–06 (via multipass exec)
    Mac->>V: tests 04, 06–08 (via multipass exec)
    end

    rect rgb(40, 40, 40)
    note over Mac: Phase 5 — Summary + Cleanup
    Mac->>Mac: collect logs, print results
    Mac-->>H: multipass delete (if --cleanup)
    Mac-->>A: multipass delete (if --cleanup)
    Mac-->>V: multipass delete (if --cleanup)
    end
```

## Test 01 — Onboarding Complete Verification

```mermaid
sequenceDiagram
    participant Mac as macOS (Test Runner)
    participant H as Host VM
    participant A as Agent VM
    participant V as Visitor VM

    Mac->>H: GET /api/onboarding/status (mTLS)
    H-->>Mac: { status: COMPLETED }

    Mac->>H: systemctl is-active nginx, chisel, authelia, portlama-panel
    H-->>Mac: active (all 4 services)

    Mac->>H: ls /etc/portlama/pki/{ca.crt, client.crt, client.key}
    H-->>Mac: files exist

    Mac->>H: curl https://panel.TEST_DOMAIN (mTLS)
    H-->>Mac: 200 OK (React app)

    Mac->>H: dig TEST_DOMAIN @127.0.0.1
    H-->>Mac: HOST_IP

    Mac->>A: curl https://HOST_IP:9292 (no mTLS cert)
    A-->>Mac: TLS handshake failure

    Mac->>V: curl https://HOST_IP:9292 (no mTLS cert)
    V-->>Mac: TLS handshake failure

    Mac->>V: curl https://auth.TEST_DOMAIN/
    V-->>Mac: 200 OK (Authelia portal)
```

## Test 02 — Tunnel Traffic

```mermaid
sequenceDiagram
    participant Mac as macOS (Test Runner)
    participant H as Host VM
    participant A as Agent VM

    note over Mac,H: Setup
    Mac->>H: POST /api/tunnels {subdomain: e2etraffic, port: 18080} (mTLS)
    H-->>Mac: { id, fqdn: e2etraffic.TEST_DOMAIN }

    Mac->>A: echo marker > /tmp/e2e-tunnel-index.html
    Mac->>A: python3 -m http.server 18080 --bind 127.0.0.1 &
    Mac->>A: chisel client wss://tunnel.TEST_DOMAIN:443 R:18080:127.0.0.1:18080 &

    note over Mac,A: Wait for tunnel
    loop Poll up to 15s
        Mac->>H: curl http://127.0.0.1:18080/
        H-->>Mac: 200 (tunnel established)
    end

    note over Mac,H: Authenticate with Authelia
    Mac->>H: POST /api/users/testuser/reset-totp (mTLS)
    H-->>Mac: { otpauth URI, TOTP secret }
    Mac->>Mac: oathtool --totp secret
    Mac->>H: POST https://auth.TEST_DOMAIN/api/firstfactor
    H-->>Mac: session cookie
    Mac->>H: POST https://auth.TEST_DOMAIN/api/secondfactor/totp
    H-->>Mac: authenticated session

    note over Mac,H: Verify traffic
    Mac->>H: curl http://127.0.0.1:18080/e2e-tunnel-index.html (direct)
    H-->>Mac: 200 + marker content

    Mac->>H: curl https://e2etraffic.TEST_DOMAIN/ -b session (via nginx)
    H-->>Mac: 200 + marker content

    note over Mac,A: Cleanup
    Mac->>A: pkill python3, pkill chisel
    Mac->>H: DELETE /api/tunnels/{id} (mTLS)
```

## Test 03 — Tunnel Toggle

```mermaid
sequenceDiagram
    participant Mac as macOS (Test Runner)
    participant H as Host VM
    participant A as Agent VM

    Mac->>H: POST /api/tunnels {subdomain: e2etoggle, port: 18081} (mTLS)
    H-->>Mac: { id, fqdn }

    Mac->>A: start HTTP server + chisel client

    note over Mac,H: Verify initial traffic
    Mac->>H: curl http://127.0.0.1:18081/
    H-->>Mac: 200 + marker

    note over Mac,H: Disable tunnel
    Mac->>H: PATCH /api/tunnels/{id} {enabled: false} (mTLS)
    H-->>Mac: OK
    Mac->>H: sleep 2 (nginx reload)
    Mac->>H: ls /etc/nginx/sites-enabled/portlama-app-e2etoggle
    H-->>Mac: not found (vhost removed)
    Mac->>H: curl https://FQDN/
    H-->>Mac: marker NOT present

    note over Mac,H: Re-enable tunnel
    Mac->>H: PATCH /api/tunnels/{id} {enabled: true} (mTLS)
    H-->>Mac: OK
    Mac->>H: sleep 2 (nginx reload)
    Mac->>H: curl http://127.0.0.1:18081/
    H-->>Mac: 200 + marker

    note over Mac,H: Authenticated access
    Mac->>H: Authelia first + second factor
    Mac->>H: curl https://FQDN/ -b session
    H-->>Mac: 200 + marker

    Mac->>A: pkill python3, pkill chisel
    Mac->>H: DELETE /api/tunnels/{id} (mTLS)
```

## Test 04 — Authelia Authentication (from Visitor)

```mermaid
sequenceDiagram
    participant Mac as macOS (Test Runner)
    participant H as Host VM
    participant A as Agent VM
    participant V as Visitor VM

    note over Mac,A: Setup tunnel + HTTP server
    Mac->>H: POST /api/tunnels {subdomain: e2eauth, port: 18082} (mTLS)
    Mac->>H: POST /api/users/testuser/reset-totp (mTLS)
    H-->>Mac: TOTP secret
    Mac->>A: start HTTP server + chisel client

    note over Mac,V: Unauthenticated access
    Mac->>V: curl https://FQDN/ (no session)
    V->>H: HTTPS request (port 443)
    H-->>V: 302 redirect → auth.TEST_DOMAIN
    V-->>Mac: redirect URL contains auth.TEST_DOMAIN

    note over Mac,V: Authenticate
    Mac->>V: POST https://auth.TEST_DOMAIN/api/firstfactor
    V->>H: username + password
    H-->>V: session cookie
    V-->>Mac: cookie saved

    Mac->>V: oathtool --totp secret
    Mac->>V: POST https://auth.TEST_DOMAIN/api/secondfactor/totp
    V->>H: TOTP code + session
    H-->>V: authenticated
    V-->>Mac: OK

    note over Mac,V: Authenticated access
    Mac->>V: curl https://FQDN/ -b session
    V->>H: request with Authelia session
    H->>H: nginx forward auth → Authelia OK
    H->>H: proxy to chisel → agent HTTP server
    H-->>V: 200 + marker content
    V-->>Mac: marker verified

    note over Mac,V: Invalid session
    Mac->>V: curl https://FQDN/ -b fake_cookie
    V->>H: request with invalid session
    H-->>V: 302/401 (rejected)
    V-->>Mac: marker NOT present

    Mac->>A: pkill python3, pkill chisel
    Mac->>H: DELETE /api/tunnels/{id}
```

## Test 05 — Admin Journey (Panel CRUD)

```mermaid
sequenceDiagram
    participant Mac as macOS (Test Runner)
    participant H as Host VM

    note over Mac,H: Panel accessibility
    Mac->>H: GET https://127.0.0.1:9292/ (mTLS)
    H-->>Mac: 200 HTML with <div id="root">
    Mac->>H: GET https://127.0.0.1:9292/ (NO mTLS)
    H-->>Mac: TLS handshake failure

    note over Mac,H: System endpoints
    Mac->>H: GET /api/health (mTLS)
    H-->>Mac: { status: ok }
    Mac->>H: GET /api/system/stats (mTLS)
    H-->>Mac: { cpu, memory, disk }

    note over Mac,H: Tunnel CRUD
    Mac->>H: POST /api/tunnels {subdomain, port}
    H-->>Mac: { id }
    Mac->>H: GET /api/tunnels
    H-->>Mac: tunnel in list
    Mac->>H: PATCH /api/tunnels/{id} {enabled: false}
    Mac->>H: PATCH /api/tunnels/{id} {enabled: true}
    Mac->>H: DELETE /api/tunnels/{id}
    Mac->>H: GET /api/tunnels
    H-->>Mac: tunnel gone

    note over Mac,H: User CRUD
    Mac->>H: POST /api/users {username, password, ...}
    H-->>Mac: created
    Mac->>H: GET /api/users
    H-->>Mac: user in list
    Mac->>H: PUT /api/users/{username} {displayname}
    Mac->>H: POST /api/users/{username}/reset-totp
    H-->>Mac: { otpauth URI }
    Mac->>H: DELETE /api/users/{username}

    note over Mac,H: Services + Certs
    Mac->>H: GET /api/services
    H-->>Mac: [nginx, chisel, authelia, portlama-panel]
    Mac->>H: GET /api/certs
    H-->>Mac: certificate info
```

## Test 06 — Tunnel User Journey (Full 2FA from Visitor)

```mermaid
sequenceDiagram
    participant Mac as macOS (Test Runner)
    participant H as Host VM
    participant A as Agent VM
    participant V as Visitor VM

    Mac->>H: POST /api/tunnels {subdomain: e2ejourney, port: 18090} (mTLS)
    Mac->>H: POST /api/users/testuser/reset-totp (mTLS)
    H-->>Mac: TOTP secret

    Mac->>A: write marker + start HTTP server + chisel client

    note over Mac,V: Step 1 — Unauthenticated
    Mac->>V: curl https://FQDN/
    V->>H: request (no session)
    H-->>V: 302 → auth.TEST_DOMAIN
    V-->>Mac: redirected, marker NOT present

    note over Mac,V: Step 2 — First factor
    Mac->>V: POST /api/firstfactor {username, password}
    V->>H: credentials
    H-->>V: session cookie

    note over Mac,V: Step 3 — Second factor
    Mac->>V: oathtool → TOTP code
    Mac->>V: POST /api/secondfactor/totp {token}
    V->>H: TOTP + session
    H-->>V: authenticated

    note over Mac,V: Step 4 — Access tunneled app
    Mac->>V: curl https://FQDN/ -b session
    V->>H: authenticated request
    H->>A: chisel reverse tunnel
    A-->>H: HTTP response (marker)
    H-->>V: 200 + marker
    V-->>Mac: verified

    note over Mac,V: Step 5 — Session persistence
    Mac->>V: curl https://FQDN/ -b session (again)
    V-->>Mac: 200 + marker (still valid)

    note over Mac,V: Step 6 — Invalid session
    Mac->>V: curl https://FQDN/ -b fake_cookie
    V-->>Mac: 302/401, marker NOT present

    Mac->>A: cleanup (pkill, rm)
    Mac->>H: DELETE /api/tunnels/{id}
```

## Test 07 — Static Site Visitor Journey

```mermaid
sequenceDiagram
    participant Mac as macOS (Test Runner)
    participant H as Host VM
    participant V as Visitor VM

    Mac->>H: POST /api/sites {subdomain: e2eblog, autheliaProtected: true} (mTLS)
    H-->>Mac: { id, fqdn }
    Mac->>H: write marker HTML to /var/www/portlama/{id}/index.html
    Mac->>H: POST /api/users/testuser/reset-totp (mTLS)
    H-->>Mac: TOTP secret

    note over Mac,V: Protected — no auth
    Mac->>V: curl https://FQDN/
    V->>H: request (no session)
    H-->>V: 302 → auth.TEST_DOMAIN
    V-->>Mac: redirected

    note over Mac,V: Protected — with auth
    Mac->>V: Authelia first factor + second factor (TOTP)
    Mac->>V: curl https://FQDN/ -b session
    V->>H: authenticated
    H-->>V: 200 + marker
    V-->>Mac: verified

    note over Mac,H: Disable Authelia protection
    Mac->>H: PATCH /api/sites/{id} {autheliaProtected: false} (mTLS)
    Mac->>Mac: sleep 2

    note over Mac,V: Unprotected — no auth needed
    Mac->>V: curl https://FQDN/ (no session)
    V->>H: request
    H-->>V: 200 + marker (public access)
    V-->>Mac: verified

    note over Mac,H: Re-enable Authelia protection
    Mac->>H: PATCH /api/sites/{id} {autheliaProtected: true} (mTLS)
    Mac->>Mac: sleep 2

    note over Mac,V: Protected again — no auth
    Mac->>V: curl https://FQDN/ (no session)
    V-->>Mac: 302/401 (enforced again)

    Mac->>H: DELETE /api/sites/{id} (mTLS)
```

## Test 08 — Invitation Journey

```mermaid
sequenceDiagram
    participant Mac as macOS (Test Runner)
    participant H as Host VM
    participant V as Visitor VM

    note over Mac,H: Create invitation
    Mac->>H: POST /api/invitations {username: inviteduser, email} (mTLS)
    H-->>Mac: { id, token, inviteUrl }
    Mac->>H: GET /api/invitations (mTLS)
    H-->>Mac: invitation in list

    note over Mac,V: Accept invitation (public endpoints, no mTLS)
    Mac->>V: GET https://auth.TEST_DOMAIN/api/invite/{token}
    V->>H: public request
    H-->>V: { username, email, expiresAt }
    V-->>Mac: invitation details

    Mac->>V: POST https://auth.TEST_DOMAIN/api/invite/{token}/accept {password}
    V->>H: accept with password
    H-->>V: user created
    V-->>Mac: OK

    note over Mac,H: Verify user created
    Mac->>H: GET /api/users (mTLS)
    H-->>Mac: inviteduser in list

    note over Mac,V: Authenticate as invited user
    Mac->>H: POST /api/users/inviteduser/reset-totp (mTLS)
    H-->>Mac: TOTP secret
    Mac->>V: POST /api/firstfactor {inviteduser, password}
    V->>H: credentials
    H-->>V: session cookie
    Mac->>V: oathtool → TOTP code
    Mac->>V: POST /api/secondfactor/totp
    V->>H: TOTP + session
    H-->>V: authenticated

    Mac->>V: GET /api/verify -b session
    V->>H: verify session
    H-->>V: 200 (valid)

    note over Mac,V: Token reuse prevention
    Mac->>V: GET /api/invite/{token}
    V->>H: reuse token
    H-->>V: 410 Gone

    Mac->>V: POST /api/invite/{token}/accept
    V->>H: reuse token
    H-->>V: 410 Gone

    Mac->>H: DELETE /api/users/inviteduser (mTLS)
    Mac->>H: DELETE /api/invitations/{id} (mTLS)
```
