# Portlama E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-03-19 12:18:03 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `12:18:06` Tunnel creation returned ok: true  
✅ `12:18:06` Tunnel has an ID  
ℹ️ `12:18:06` Created tunnel ID: c587c031-b87a-4943-8646-0e41f7e69550 (e2etraffic.test.portlama.local)  

## Configure agent VM for tunnel

✅ `12:18:06` Added tunnel.test.portlama.local to agent /etc/hosts  
✅ `12:18:06` Added e2etraffic.test.portlama.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `12:18:08` HTTP server running on agent at port 18080  

## Start Chisel client on agent VM

ℹ️ `12:18:08` Waiting for Chisel tunnel to establish...  
✅ `12:18:09` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `12:18:09` Direct tunnel traffic returns expected content  

## Reset TOTP before authentication

✅ `12:18:09` TOTP reset returned otpauth URI  
✅ `12:18:09` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `12:18:12` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `12:18:12` Generated TOTP code: 542946  
✅ `12:18:12` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `12:18:13` Full-path tunnel traffic (nginx + Authelia) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `12` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `12` |

ℹ️ `12:18:13` Cleaning up test resources...  
🔵 `12:18:15` **Running: 03-tunnel-toggle-traffic.sh**  
