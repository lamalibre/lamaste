# Portlama E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-03-20 14:34:34 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `14:34:37` Tunnel creation returned ok: true  
✅ `14:34:37` Tunnel has an ID  
ℹ️ `14:34:37` Created tunnel ID: 3a0f455c-29ba-4b91-b31f-4ef57790c013 (e2etraffic.test.portlama.local)  

## Configure agent VM for tunnel

✅ `14:34:37` Added tunnel.test.portlama.local to agent /etc/hosts  
✅ `14:34:37` Added e2etraffic.test.portlama.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `14:34:39` HTTP server running on agent at port 18080  

## Start Chisel client on agent VM

ℹ️ `14:34:40` Waiting for Chisel tunnel to establish...  
✅ `14:34:40` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `14:34:40` Direct tunnel traffic returns expected content  

## Reset TOTP before authentication

✅ `14:34:40` TOTP reset returned otpauth URI  
✅ `14:34:40` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `14:34:43` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `14:34:43` Generated TOTP code: 845746  
✅ `14:34:43` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `14:34:44` Full-path tunnel traffic (nginx + Authelia) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `12` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `12` |

ℹ️ `14:34:44` Cleaning up test resources...  
🔵 `14:34:46` **Running: 03-tunnel-toggle-traffic.sh**  
