# Lamaste E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-10-13 11:39:24 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `11:39:25` Tunnel creation returned ok: true  
✅ `11:39:25` Tunnel has an ID  
✅ `11:39:25` Tunnel is owned by test-agent  
ℹ️ `11:39:25` Created tunnel ID: 9a12b6bf-425f-4ccd-ad6b-c92e111a7047 (e2etraffic.test.lamaste.local)  

## Verify the owner's chisel config and grant

✅ `11:39:25` agent-config?agent=test-agent lists the tunnel  
✅ `11:39:25` Host chisel authfile grants test-agent ^R:127\.0\.0\.1:18080$  

## Configure agent VM for tunnel

✅ `11:39:25` Added tunnel.test.lamaste.local to agent /etc/hosts  
✅ `11:39:25` Added e2etraffic.test.lamaste.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `11:39:28` HTTP server running on agent at port 18080  

## Refresh agent config to pick up new tunnel

ℹ️ `11:39:28` Waiting for Chisel tunnel to establish...  
✅ `11:39:29` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `11:39:29` Direct tunnel traffic returns expected content  

## Verify the agent's chisel client: verified TLS, credential off argv

✅ `11:39:29` Chisel unit reads its credential from EnvironmentFile=  
✅ `11:39:29` Chisel unit connects to https://tunnel.test.lamaste.local:443  
✅ `11:39:29` Chisel unit carries no --auth argument  
✅ `11:39:29` Chisel unit does not skip TLS verification  
✅ `11:39:29` chisel.env is mode 600  
✅ `11:39:29` chisel.env holds AUTH=agent-test-agent:<password>  
✅ `11:39:29` Running chisel client argv has no password, --auth or --tls-skip-verify  

## Pinned chisel release on both ends; client argv shape

✅ `11:39:29` Agent chisel (/root/.lamalibre/lamaste/bin/chisel) reports version 1.12.0  
✅ `11:39:29` Server chisel (/usr/local/bin/chisel) reports version 1.12.0  
✅ `11:39:29` Chisel client argv is 'client --max-retry-interval 30s https://tunnel.test.lamaste.local:443 R:...'  
✅ `11:39:29` Chisel client argv carries the tunnel's reverse remote  

## Reset TOTP before authentication

✅ `11:39:30` TOTP reset returned otpauth URI  
✅ `11:39:30` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `11:40:02` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `11:40:02` Generated TOTP code: 493415  
✅ `11:40:02` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `11:40:02` Full-path tunnel traffic (nginx + Authelia) returns expected content  

## Verify the request body limit at the tunnel vhost

✅ `11:40:03` 2 MB POST through the tunnel passes the body limit (above nginx's 1 MB default; HTTP 501)  
✅ `11:40:03` 11 MB POST through the tunnel rejected with 413 (limit 10 MB)  

## Public tunnel: spoofed identity headers never reach the app

✅ `11:40:05` Header-echo app running on agent at port 18090  
✅ `11:40:06` Public tunnel e2eheaders.test.lamaste.local created  
✅ `11:40:11` Public tunnel serves within 60 seconds with no lamaste-agent update  
✅ `11:40:11` App sees Host = e2eheaders.test.lamaste.local (not 127.0.0.1:18090)  
✅ `11:40:11` App sees X-Forwarded-Proto: https (the client's value is replaced)  
✅ `11:40:11` App sees X-Forwarded-For  
✅ `11:40:11` Client-supplied x-ssl-client-verify header does not reach the app  
✅ `11:40:11` Client-supplied x-ssl-client-dn header does not reach the app  
✅ `11:40:11` Client-supplied x-ssl-client-serial header does not reach the app  
✅ `11:40:11` Client-supplied remote-user header does not reach the app  
✅ `11:40:11` Client-supplied remote-groups header does not reach the app  
✅ `11:40:11` Client-supplied remote-name header does not reach the app  
✅ `11:40:11` Client-supplied remote-email header does not reach the app  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `41` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `41` |

ℹ️ `11:40:11` Cleaning up test resources...  
