# Portlama E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-03-29 09:09:41 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `09:09:44` Tunnel creation returned ok: true  
✅ `09:09:44` Tunnel has an ID  
ℹ️ `09:09:44` Created tunnel ID: cdd23b28-6f57-49de-a412-d56498e69e86 (e2etraffic.test.portlama.local)  

## Configure agent VM for tunnel

✅ `09:09:44` Added tunnel.test.portlama.local to agent /etc/hosts  
✅ `09:09:44` Added e2etraffic.test.portlama.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `09:09:46` HTTP server running on agent at port 18080  

## Refresh agent config to pick up new tunnel

ℹ️ `09:09:49` Waiting for Chisel tunnel to establish...  
✅ `09:09:49` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `09:09:49` Direct tunnel traffic returns expected content  

## Reset TOTP before authentication

✅ `09:09:49` TOTP reset returned otpauth URI  
✅ `09:09:49` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `09:09:53` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `09:09:53` Generated TOTP code: 120105  
✅ `09:09:53` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `09:09:53` Full-path tunnel traffic (nginx + Authelia) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `12` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `12` |

ℹ️ `09:09:53` Cleaning up test resources...  
🔵 `09:09:58` **Running: 03-tunnel-toggle-traffic.sh**  
