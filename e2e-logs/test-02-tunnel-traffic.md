# Portlama E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-03-16 17:22:19 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `17:22:21` Tunnel creation returned ok: true  
✅ `17:22:21` Tunnel has an ID  
ℹ️ `17:22:21` Created tunnel ID: 2da03452-893b-4ad6-846a-b917bc963d67 (e2etraffic.test.portlama.local)  

## Configure agent VM for tunnel

✅ `17:22:21` Added tunnel.test.portlama.local to agent /etc/hosts  
✅ `17:22:21` Added e2etraffic.test.portlama.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `17:22:24` HTTP server running on agent at port 18080  

## Start Chisel client on agent VM

ℹ️ `17:22:24` Waiting for Chisel tunnel to establish...  
✅ `17:22:24` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `17:22:24` Direct tunnel traffic returns expected content  

## Reset TOTP before authentication

✅ `17:22:24` TOTP reset returned otpauth URI  
✅ `17:22:24` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `17:22:27` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `17:22:27` Generated TOTP code: 937031  
✅ `17:22:28` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `17:22:28` Full-path tunnel traffic (nginx + Authelia) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `12` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `12` |

ℹ️ `17:22:28` Cleaning up test resources...  
🔵 `17:22:30` **Running: 03-tunnel-toggle-traffic.sh**  
