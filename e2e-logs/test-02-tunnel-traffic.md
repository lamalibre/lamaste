# Lamaste E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-03-30 13:08:40 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `13:08:43` Tunnel creation returned ok: true  
✅ `13:08:43` Tunnel has an ID  
ℹ️ `13:08:43` Created tunnel ID: 0b261503-70c1-4d4e-b767-bc3d29fb7a7f (e2etraffic.test.lamaste.local)  

## Configure agent VM for tunnel

✅ `13:08:43` Added tunnel.test.lamaste.local to agent /etc/hosts  
✅ `13:08:43` Added e2etraffic.test.lamaste.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `13:08:46` HTTP server running on agent at port 18080  

## Refresh agent config to pick up new tunnel

ℹ️ `13:08:48` Waiting for Chisel tunnel to establish...  
✅ `13:08:48` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `13:08:48` Direct tunnel traffic returns expected content  

## Reset TOTP before authentication

✅ `13:08:49` TOTP reset returned otpauth URI  
✅ `13:08:49` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `13:08:52` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `13:08:52` Generated TOTP code: 858765  
✅ `13:08:52` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `13:08:52` Full-path tunnel traffic (nginx + Authelia) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `12` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `12` |

ℹ️ `13:08:52` Cleaning up test resources...  
🔵 `13:08:58` **Running: 03-tunnel-toggle-traffic.sh**  
