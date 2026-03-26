# Portlama E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-03-26 10:47:58 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `10:48:01` Tunnel creation returned ok: true  
✅ `10:48:01` Tunnel has an ID  
ℹ️ `10:48:01` Created tunnel ID: d8ee6b0f-0e9e-40a5-993c-75dcf4d66fcc (e2etraffic.test.portlama.local)  

## Configure agent VM for tunnel

✅ `10:48:01` Added tunnel.test.portlama.local to agent /etc/hosts  
✅ `10:48:01` Added e2etraffic.test.portlama.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `10:48:03` HTTP server running on agent at port 18080  

## Refresh agent config to pick up new tunnel

ℹ️ `10:48:06` Waiting for Chisel tunnel to establish...  
✅ `10:48:06` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `10:48:06` Direct tunnel traffic returns expected content  

## Reset TOTP before authentication

✅ `10:48:06` TOTP reset returned otpauth URI  
✅ `10:48:06` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `10:48:10` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `10:48:10` Generated TOTP code: 741101  
✅ `10:48:10` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `10:48:10` Full-path tunnel traffic (nginx + Authelia) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `12` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `12` |

ℹ️ `10:48:10` Cleaning up test resources...  
🔵 `10:48:15` **Running: 03-tunnel-toggle-traffic.sh**  
