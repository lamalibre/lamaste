# Lamaste E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-11-10 17:36:51 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `17:36:52` Tunnel creation returned ok: true  
✅ `17:36:52` Tunnel has an ID  
✅ `17:36:52` Tunnel is owned by test-agent  
ℹ️ `17:36:52` Created tunnel ID: d08fabb5-d40b-453c-a8cd-1f472ab3aace (e2etraffic.test.lamaste.local)  

## Verify the owner's chisel config and grant

✅ `17:36:52` agent-config?agent=test-agent lists the tunnel  
✅ `17:36:52` Host chisel authfile grants test-agent ^R:127\.0\.0\.1:18080$  

## Configure agent VM for tunnel

✅ `17:36:52` Added tunnel.test.lamaste.local to agent /etc/hosts  
✅ `17:36:52` Added e2etraffic.test.lamaste.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `17:36:55` HTTP server running on agent at port 18080  

## Refresh agent config to pick up new tunnel

ℹ️ `17:36:56` Waiting for Chisel tunnel to establish...  
✅ `17:36:56` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `17:36:56` Direct tunnel traffic returns expected content  

## Verify the agent's chisel client: verified TLS, credential off argv

✅ `17:36:56` Chisel unit reads its credential from EnvironmentFile=  
✅ `17:36:56` Chisel unit connects to https://tunnel.test.lamaste.local:443  
✅ `17:36:56` Chisel unit carries no --auth argument  
✅ `17:36:56` Chisel unit does not skip TLS verification  
✅ `17:36:56` chisel.env is mode 600  
✅ `17:36:57` chisel.env holds AUTH=agent-test-agent:<password>  
✅ `17:36:57` Running chisel client argv has no password, --auth or --tls-skip-verify  

## Pinned chisel release on both ends; client argv shape

✅ `17:36:57` Agent chisel (/root/.lamalibre/lamaste/bin/chisel) reports version 1.12.0  
✅ `17:36:57` Server chisel (/usr/local/bin/chisel) reports version 1.12.0  
✅ `17:36:57` Chisel client argv is 'client --max-retry-interval 30s https://tunnel.test.lamaste.local:443 R:...'  
✅ `17:36:57` Chisel client argv carries the tunnel's reverse remote  

## Reset TOTP before authentication

✅ `17:36:57` TOTP reset returned otpauth URI  
✅ `17:36:57` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `17:37:03` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `17:37:03` Generated TOTP code: 525288  
✅ `17:37:03` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `17:37:03` Full-path tunnel traffic (nginx + Authelia) returns expected content  

## Verify the request body limit at the tunnel vhost

✅ `17:37:03` 2 MB POST through the tunnel passes the body limit (above nginx's 1 MB default; HTTP 502)  
✅ `17:37:03` 11 MB POST through the tunnel rejected with 413 (limit 10 MB)  

## Public tunnel: spoofed identity headers never reach the app

✅ `17:37:06` Header-echo app running on agent at port 18090  
✅ `17:37:07` Public tunnel e2eheaders.test.lamaste.local created  
✅ `17:37:36` Public tunnel serves within 60 seconds with no lamaste-agent update  
✅ `17:37:36` App sees Host = e2eheaders.test.lamaste.local (not 127.0.0.1:18090)  
✅ `17:37:36` App sees X-Forwarded-Proto: https (the client's value is replaced)  
✅ `17:37:36` App sees X-Forwarded-For  
✅ `17:37:36` Client-supplied x-ssl-client-verify header does not reach the app  
✅ `17:37:36` Client-supplied x-ssl-client-dn header does not reach the app  
✅ `17:37:36` Client-supplied x-ssl-client-serial header does not reach the app  
✅ `17:37:36` Client-supplied remote-user header does not reach the app  
✅ `17:37:36` Client-supplied remote-groups header does not reach the app  
✅ `17:37:36` Client-supplied remote-name header does not reach the app  
✅ `17:37:36` Client-supplied remote-email header does not reach the app  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `41` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `41` |

ℹ️ `17:37:36` Cleaning up test resources...  
