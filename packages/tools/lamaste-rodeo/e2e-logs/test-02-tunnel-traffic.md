# Lamaste E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-11-11 08:52:37 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `08:52:38` Tunnel creation returned ok: true  
✅ `08:52:38` Tunnel has an ID  
✅ `08:52:38` Tunnel is owned by test-agent  
ℹ️ `08:52:38` Created tunnel ID: 97b5644e-a38c-4ad1-9d4f-bcce0d49eef1 (e2etraffic.test.lamaste.local)  

## Verify the owner's chisel config and grant

✅ `08:52:38` agent-config?agent=test-agent lists the tunnel  
✅ `08:52:38` Host chisel authfile grants test-agent ^R:127\.0\.0\.1:18080$  

## Configure agent VM for tunnel

✅ `08:52:38` Added tunnel.test.lamaste.local to agent /etc/hosts  
✅ `08:52:38` Added e2etraffic.test.lamaste.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `08:52:41` HTTP server running on agent at port 18080  

## Refresh agent config to pick up new tunnel

ℹ️ `08:52:42` Waiting for Chisel tunnel to establish...  
✅ `08:52:42` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `08:52:42` Direct tunnel traffic returns expected content  

## Verify the agent's chisel client: verified TLS, credential off argv

✅ `08:52:42` Chisel unit reads its credential from EnvironmentFile=  
✅ `08:52:42` Chisel unit connects to https://tunnel.test.lamaste.local:443  
✅ `08:52:42` Chisel unit carries no --auth argument  
✅ `08:52:42` Chisel unit does not skip TLS verification  
✅ `08:52:42` chisel.env is mode 600  
✅ `08:52:42` chisel.env holds AUTH=agent-test-agent:<password>  
✅ `08:52:43` Running chisel client argv has no password, --auth or --tls-skip-verify  

## Pinned chisel release on both ends; client argv shape

✅ `08:52:43` Agent chisel (/root/.lamalibre/lamaste/bin/chisel) reports version 1.12.0  
✅ `08:52:43` Server chisel (/usr/local/bin/chisel) reports version 1.12.0  
✅ `08:52:43` Chisel client argv is 'client --max-retry-interval 30s https://tunnel.test.lamaste.local:443 R:...'  
✅ `08:52:43` Chisel client argv carries the tunnel's reverse remote  

## Reset TOTP before authentication

✅ `08:52:43` TOTP reset returned otpauth URI  
✅ `08:52:43` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `08:53:03` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `08:53:03` Generated TOTP code: 845086  
✅ `08:53:03` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `08:53:03` Full-path tunnel traffic (nginx + Authelia) returns expected content  

## Verify the request body limit at the tunnel vhost

✅ `08:53:03` 2 MB POST through the tunnel passes the body limit (above nginx's 1 MB default; HTTP 501)  
✅ `08:53:03` 11 MB POST through the tunnel rejected with 413 (limit 10 MB)  

## Public tunnel: spoofed identity headers never reach the app

✅ `08:53:06` Header-echo app running on agent at port 18090  
✅ `08:53:07` Public tunnel e2eheaders.test.lamaste.local created  
✅ `08:53:14` Public tunnel serves within 60 seconds with no lamaste-agent update  
✅ `08:53:14` App sees Host = e2eheaders.test.lamaste.local (not 127.0.0.1:18090)  
✅ `08:53:14` App sees X-Forwarded-Proto: https (the client's value is replaced)  
✅ `08:53:14` App sees X-Forwarded-For  
✅ `08:53:14` Client-supplied x-ssl-client-verify header does not reach the app  
✅ `08:53:14` Client-supplied x-ssl-client-dn header does not reach the app  
✅ `08:53:14` Client-supplied x-ssl-client-serial header does not reach the app  
✅ `08:53:14` Client-supplied remote-user header does not reach the app  
✅ `08:53:14` Client-supplied remote-groups header does not reach the app  
✅ `08:53:14` Client-supplied remote-name header does not reach the app  
✅ `08:53:14` Client-supplied remote-email header does not reach the app  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `41` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `41` |

ℹ️ `08:53:14` Cleaning up test resources...  
