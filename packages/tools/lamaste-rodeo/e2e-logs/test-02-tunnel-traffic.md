# Lamaste E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-11-02 15:40:39 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `15:40:40` Tunnel creation returned ok: true  
✅ `15:40:40` Tunnel has an ID  
✅ `15:40:40` Tunnel is owned by test-agent  
ℹ️ `15:40:40` Created tunnel ID: 8ef86d46-94b3-4e63-8433-69f63ec5cbc4 (e2etraffic.test.lamaste.local)  

## Verify the owner's chisel config and grant

✅ `15:40:40` agent-config?agent=test-agent lists the tunnel  
✅ `15:40:40` Host chisel authfile grants test-agent ^R:127\.0\.0\.1:18080$  

## Configure agent VM for tunnel

✅ `15:40:40` Added tunnel.test.lamaste.local to agent /etc/hosts  
✅ `15:40:40` Added e2etraffic.test.lamaste.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `15:40:42` HTTP server running on agent at port 18080  

## Refresh agent config to pick up new tunnel

ℹ️ `15:40:43` Waiting for Chisel tunnel to establish...  
✅ `15:40:43` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `15:40:43` Direct tunnel traffic returns expected content  

## Verify the agent's chisel client: verified TLS, credential off argv

✅ `15:40:43` Chisel unit reads its credential from EnvironmentFile=  
✅ `15:40:43` Chisel unit connects to https://tunnel.test.lamaste.local:443  
✅ `15:40:43` Chisel unit carries no --auth argument  
✅ `15:40:43` Chisel unit does not skip TLS verification  
✅ `15:40:43` chisel.env is mode 600  
✅ `15:40:44` chisel.env holds AUTH=agent-test-agent:<password>  
✅ `15:40:44` Running chisel client argv has no password, --auth or --tls-skip-verify  

## Pinned chisel release on both ends; client argv shape

✅ `15:40:44` Agent chisel (/root/.lamalibre/lamaste/bin/chisel) reports version 1.12.0  
✅ `15:40:44` Server chisel (/usr/local/bin/chisel) reports version 1.12.0  
✅ `15:40:44` Chisel client argv is 'client --max-retry-interval 30s https://tunnel.test.lamaste.local:443 R:...'  
✅ `15:40:44` Chisel client argv carries the tunnel's reverse remote  

## Reset TOTP before authentication

✅ `15:40:44` TOTP reset returned otpauth URI  
✅ `15:40:44` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `15:41:03` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `15:41:03` Generated TOTP code: 303516  
✅ `15:41:03` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `15:41:03` Full-path tunnel traffic (nginx + Authelia) returns expected content  

## Verify the request body limit at the tunnel vhost

✅ `15:41:03` 2 MB POST through the tunnel passes the body limit (above nginx's 1 MB default; HTTP 501)  
✅ `15:41:04` 11 MB POST through the tunnel rejected with 413 (limit 10 MB)  

## Public tunnel: spoofed identity headers never reach the app

✅ `15:41:06` Header-echo app running on agent at port 18090  
✅ `15:41:07` Public tunnel e2eheaders.test.lamaste.local created  
✅ `15:41:25` Public tunnel serves within 60 seconds with no lamaste-agent update  
✅ `15:41:25` App sees Host = e2eheaders.test.lamaste.local (not 127.0.0.1:18090)  
✅ `15:41:25` App sees X-Forwarded-Proto: https (the client's value is replaced)  
✅ `15:41:25` App sees X-Forwarded-For  
✅ `15:41:25` Client-supplied x-ssl-client-verify header does not reach the app  
✅ `15:41:25` Client-supplied x-ssl-client-dn header does not reach the app  
✅ `15:41:25` Client-supplied x-ssl-client-serial header does not reach the app  
✅ `15:41:25` Client-supplied remote-user header does not reach the app  
✅ `15:41:25` Client-supplied remote-groups header does not reach the app  
✅ `15:41:25` Client-supplied remote-name header does not reach the app  
✅ `15:41:25` Client-supplied remote-email header does not reach the app  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `41` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `41` |

ℹ️ `15:41:25` Cleaning up test resources...  
