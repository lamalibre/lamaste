# Portlama E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-03-28 22:40:04 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `22:40:07` Tunnel creation returned ok: true  
✅ `22:40:07` Tunnel has an ID  
ℹ️ `22:40:07` Created tunnel ID: eb3ef1ab-bd07-4878-8757-f95f49999e0e (e2etraffic.test.portlama.local)  

## Configure agent VM for tunnel

✅ `22:40:07` Added tunnel.test.portlama.local to agent /etc/hosts  
✅ `22:40:07` Added e2etraffic.test.portlama.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `22:40:10` HTTP server running on agent at port 18080  

## Refresh agent config to pick up new tunnel

ℹ️ `22:40:12` Waiting for Chisel tunnel to establish...  
✅ `22:40:12` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `22:40:13` Direct tunnel traffic returns expected content  

## Reset TOTP before authentication

✅ `22:40:13` TOTP reset returned otpauth URI  
✅ `22:40:13` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `22:40:16` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `22:40:16` Generated TOTP code: 048049  
✅ `22:40:16` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `22:40:16` Full-path tunnel traffic (nginx + Authelia) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `12` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `12` |

ℹ️ `22:40:16` Cleaning up test resources...  
🔵 `22:40:22` **Running: 03-tunnel-toggle-traffic.sh**  
