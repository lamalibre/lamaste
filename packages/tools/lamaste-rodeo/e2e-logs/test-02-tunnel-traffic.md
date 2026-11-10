# Lamaste E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-11-10 12:54:27 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `12:54:28` Tunnel creation returned ok: true  
✅ `12:54:28` Tunnel has an ID  
✅ `12:54:28` Tunnel is owned by test-agent  
ℹ️ `12:54:28` Created tunnel ID: bcfe6aa6-5630-4b1a-a180-fb13934a80a8 (e2etraffic.test.lamaste.local)  

## Verify the owner's chisel config and grant

✅ `12:54:28` agent-config?agent=test-agent lists the tunnel  
✅ `12:54:28` Host chisel authfile grants test-agent ^R:127\.0\.0\.1:18080$  

## Configure agent VM for tunnel

✅ `12:54:29` Added tunnel.test.lamaste.local to agent /etc/hosts  
✅ `12:54:29` Added e2etraffic.test.lamaste.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `12:54:31` HTTP server running on agent at port 18080  

## Refresh agent config to pick up new tunnel

ℹ️ `12:54:32` Waiting for Chisel tunnel to establish...  
✅ `12:54:32` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `12:54:32` Direct tunnel traffic returns expected content  

## Verify the agent's chisel client: verified TLS, credential off argv

✅ `12:54:33` Chisel unit reads its credential from EnvironmentFile=  
✅ `12:54:33` Chisel unit connects to https://tunnel.test.lamaste.local:443  
✅ `12:54:33` Chisel unit carries no --auth argument  
✅ `12:54:33` Chisel unit does not skip TLS verification  
✅ `12:54:33` chisel.env is mode 600  
✅ `12:54:33` chisel.env holds AUTH=agent-test-agent:<password>  
✅ `12:54:33` Running chisel client argv has no password, --auth or --tls-skip-verify  

## Pinned chisel release on both ends; client argv shape

✅ `12:54:33` Agent chisel (/root/.lamalibre/lamaste/bin/chisel) reports version 1.12.0  
✅ `12:54:33` Server chisel (/usr/local/bin/chisel) reports version 1.12.0  
✅ `12:54:33` Chisel client argv is 'client --max-retry-interval 30s https://tunnel.test.lamaste.local:443 R:...'  
✅ `12:54:33` Chisel client argv carries the tunnel's reverse remote  

## Reset TOTP before authentication

✅ `12:54:34` TOTP reset returned otpauth URI  
✅ `12:54:34` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `12:55:02` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `12:55:03` Generated TOTP code: 881800  
✅ `12:55:03` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `12:55:03` Full-path tunnel traffic (nginx + Authelia) returns expected content  

## Verify the request body limit at the tunnel vhost

✅ `12:55:03` 2 MB POST through the tunnel passes the body limit (above nginx's 1 MB default; HTTP 502)  
✅ `12:55:04` 11 MB POST through the tunnel rejected with 413 (limit 10 MB)  

## Public tunnel: spoofed identity headers never reach the app

✅ `12:55:06` Header-echo app running on agent at port 18090  
✅ `12:55:07` Public tunnel e2eheaders.test.lamaste.local created  
✅ `12:55:16` Public tunnel serves within 60 seconds with no lamaste-agent update  
✅ `12:55:16` App sees Host = e2eheaders.test.lamaste.local (not 127.0.0.1:18090)  
✅ `12:55:16` App sees X-Forwarded-Proto: https (the client's value is replaced)  
✅ `12:55:16` App sees X-Forwarded-For  
✅ `12:55:16` Client-supplied x-ssl-client-verify header does not reach the app  
✅ `12:55:16` Client-supplied x-ssl-client-dn header does not reach the app  
✅ `12:55:16` Client-supplied x-ssl-client-serial header does not reach the app  
✅ `12:55:16` Client-supplied remote-user header does not reach the app  
✅ `12:55:16` Client-supplied remote-groups header does not reach the app  
✅ `12:55:16` Client-supplied remote-name header does not reach the app  
✅ `12:55:16` Client-supplied remote-email header does not reach the app  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `41` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `41` |

ℹ️ `12:55:16` Cleaning up test resources...  
