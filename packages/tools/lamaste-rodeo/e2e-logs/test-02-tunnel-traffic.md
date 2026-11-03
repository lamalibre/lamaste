# Lamaste E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-11-03 09:20:52 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `09:20:52` Tunnel creation returned ok: true  
✅ `09:20:52` Tunnel has an ID  
✅ `09:20:52` Tunnel is owned by test-agent  
ℹ️ `09:20:52` Created tunnel ID: 15e4c45a-6750-44df-b7d4-38bebb90d351 (e2etraffic.test.lamaste.local)  

## Verify the owner's chisel config and grant

✅ `09:20:52` agent-config?agent=test-agent lists the tunnel  
✅ `09:20:52` Host chisel authfile grants test-agent ^R:127\.0\.0\.1:18080$  

## Configure agent VM for tunnel

✅ `09:20:53` Added tunnel.test.lamaste.local to agent /etc/hosts  
✅ `09:20:53` Added e2etraffic.test.lamaste.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `09:20:55` HTTP server running on agent at port 18080  

## Refresh agent config to pick up new tunnel

ℹ️ `09:20:56` Waiting for Chisel tunnel to establish...  
✅ `09:20:56` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `09:20:56` Direct tunnel traffic returns expected content  

## Verify the agent's chisel client: verified TLS, credential off argv

✅ `09:20:56` Chisel unit reads its credential from EnvironmentFile=  
✅ `09:20:56` Chisel unit connects to https://tunnel.test.lamaste.local:443  
✅ `09:20:56` Chisel unit carries no --auth argument  
✅ `09:20:56` Chisel unit does not skip TLS verification  
✅ `09:20:56` chisel.env is mode 600  
✅ `09:20:56` chisel.env holds AUTH=agent-test-agent:<password>  
✅ `09:20:56` Running chisel client argv has no password, --auth or --tls-skip-verify  

## Pinned chisel release on both ends; client argv shape

✅ `09:20:56` Agent chisel (/root/.lamalibre/lamaste/bin/chisel) reports version 1.12.0  
✅ `09:20:56` Server chisel (/usr/local/bin/chisel) reports version 1.12.0  
✅ `09:20:57` Chisel client argv is 'client --max-retry-interval 30s https://tunnel.test.lamaste.local:443 R:...'  
✅ `09:20:57` Chisel client argv carries the tunnel's reverse remote  

## Reset TOTP before authentication

✅ `09:20:57` TOTP reset returned otpauth URI  
✅ `09:20:57` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `09:21:02` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `09:21:02` Generated TOTP code: 884444  
✅ `09:21:02` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `09:21:02` Full-path tunnel traffic (nginx + Authelia) returns expected content  

## Verify the request body limit at the tunnel vhost

✅ `09:21:03` 2 MB POST through the tunnel passes the body limit (above nginx's 1 MB default; HTTP 501)  
✅ `09:21:03` 11 MB POST through the tunnel rejected with 413 (limit 10 MB)  

## Public tunnel: spoofed identity headers never reach the app

✅ `09:21:05` Header-echo app running on agent at port 18090  
✅ `09:21:06` Public tunnel e2eheaders.test.lamaste.local created  
✅ `09:21:39` Public tunnel serves within 60 seconds with no lamaste-agent update  
✅ `09:21:39` App sees Host = e2eheaders.test.lamaste.local (not 127.0.0.1:18090)  
✅ `09:21:39` App sees X-Forwarded-Proto: https (the client's value is replaced)  
✅ `09:21:39` App sees X-Forwarded-For  
✅ `09:21:39` Client-supplied x-ssl-client-verify header does not reach the app  
✅ `09:21:39` Client-supplied x-ssl-client-dn header does not reach the app  
✅ `09:21:39` Client-supplied x-ssl-client-serial header does not reach the app  
✅ `09:21:39` Client-supplied remote-user header does not reach the app  
✅ `09:21:39` Client-supplied remote-groups header does not reach the app  
✅ `09:21:39` Client-supplied remote-name header does not reach the app  
✅ `09:21:39` Client-supplied remote-email header does not reach the app  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `41` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `41` |

ℹ️ `09:21:39` Cleaning up test resources...  
