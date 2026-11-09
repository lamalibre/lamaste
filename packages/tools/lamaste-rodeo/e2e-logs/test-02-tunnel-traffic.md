# Lamaste E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-11-09 12:32:33 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `12:32:34` Tunnel creation returned ok: true  
✅ `12:32:34` Tunnel has an ID  
✅ `12:32:34` Tunnel is owned by test-agent  
ℹ️ `12:32:34` Created tunnel ID: 789d0ee2-9037-4902-9717-ce578b29d1e2 (e2etraffic.test.lamaste.local)  

## Verify the owner's chisel config and grant

✅ `12:32:34` agent-config?agent=test-agent lists the tunnel  
✅ `12:32:34` Host chisel authfile grants test-agent ^R:127\.0\.0\.1:18080$  

## Configure agent VM for tunnel

✅ `12:32:34` Added tunnel.test.lamaste.local to agent /etc/hosts  
✅ `12:32:34` Added e2etraffic.test.lamaste.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `12:32:37` HTTP server running on agent at port 18080  

## Refresh agent config to pick up new tunnel

ℹ️ `12:32:38` Waiting for Chisel tunnel to establish...  
✅ `12:32:38` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `12:32:38` Direct tunnel traffic returns expected content  

## Verify the agent's chisel client: verified TLS, credential off argv

✅ `12:32:38` Chisel unit reads its credential from EnvironmentFile=  
✅ `12:32:38` Chisel unit connects to https://tunnel.test.lamaste.local:443  
✅ `12:32:38` Chisel unit carries no --auth argument  
✅ `12:32:38` Chisel unit does not skip TLS verification  
✅ `12:32:38` chisel.env is mode 600  
✅ `12:32:38` chisel.env holds AUTH=agent-test-agent:<password>  
✅ `12:32:38` Running chisel client argv has no password, --auth or --tls-skip-verify  

## Pinned chisel release on both ends; client argv shape

✅ `12:32:38` Agent chisel (/root/.lamalibre/lamaste/bin/chisel) reports version 1.12.0  
✅ `12:32:38` Server chisel (/usr/local/bin/chisel) reports version 1.12.0  
✅ `12:32:39` Chisel client argv is 'client --max-retry-interval 30s https://tunnel.test.lamaste.local:443 R:...'  
✅ `12:32:39` Chisel client argv carries the tunnel's reverse remote  

## Reset TOTP before authentication

✅ `12:32:39` TOTP reset returned otpauth URI  
✅ `12:32:39` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `12:33:02` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `12:33:02` Generated TOTP code: 843302  
✅ `12:33:02` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `12:33:03` Full-path tunnel traffic (nginx + Authelia) returns expected content  

## Verify the request body limit at the tunnel vhost

✅ `12:33:03` 2 MB POST through the tunnel passes the body limit (above nginx's 1 MB default; HTTP 502)  
✅ `12:33:03` 11 MB POST through the tunnel rejected with 413 (limit 10 MB)  

## Public tunnel: spoofed identity headers never reach the app

✅ `12:33:06` Header-echo app running on agent at port 18090  
✅ `12:33:06` Public tunnel e2eheaders.test.lamaste.local created  
✅ `12:33:15` Public tunnel serves within 60 seconds with no lamaste-agent update  
✅ `12:33:15` App sees Host = e2eheaders.test.lamaste.local (not 127.0.0.1:18090)  
✅ `12:33:15` App sees X-Forwarded-Proto: https (the client's value is replaced)  
✅ `12:33:15` App sees X-Forwarded-For  
✅ `12:33:15` Client-supplied x-ssl-client-verify header does not reach the app  
✅ `12:33:15` Client-supplied x-ssl-client-dn header does not reach the app  
✅ `12:33:15` Client-supplied x-ssl-client-serial header does not reach the app  
✅ `12:33:15` Client-supplied remote-user header does not reach the app  
✅ `12:33:15` Client-supplied remote-groups header does not reach the app  
✅ `12:33:15` Client-supplied remote-name header does not reach the app  
✅ `12:33:15` Client-supplied remote-email header does not reach the app  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `41` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `41` |

ℹ️ `12:33:15` Cleaning up test resources...  
