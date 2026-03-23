# Portlama E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-03-23 12:10:07 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `12:10:10` Tunnel creation returned ok: true  
✅ `12:10:10` Tunnel has an ID  
ℹ️ `12:10:10` Created tunnel ID: 99906371-48ce-48f7-a589-66d5472560ab (e2etraffic.test.portlama.local)  

## Configure agent VM for tunnel

✅ `12:10:11` Added tunnel.test.portlama.local to agent /etc/hosts  
✅ `12:10:11` Added e2etraffic.test.portlama.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `12:10:13` HTTP server running on agent at port 18080  

## Start Chisel client on agent VM

ℹ️ `12:10:13` Waiting for Chisel tunnel to establish...  
✅ `12:10:13` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `12:10:13` Direct tunnel traffic returns expected content  

## Reset TOTP before authentication

✅ `12:10:14` TOTP reset returned otpauth URI  
✅ `12:10:14` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `12:10:17` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `12:10:17` Generated TOTP code: 630341  
✅ `12:10:17` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `12:10:17` Full-path tunnel traffic (nginx + Authelia) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `12` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `12` |

ℹ️ `12:10:17` Cleaning up test resources...  
🔵 `12:10:20` **Running: 03-tunnel-toggle-traffic.sh**  
