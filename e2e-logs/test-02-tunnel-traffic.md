# Portlama E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-03-22 18:25:39 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `18:25:41` Tunnel creation returned ok: true  
✅ `18:25:41` Tunnel has an ID  
ℹ️ `18:25:41` Created tunnel ID: 1aea56e5-7d66-4f6c-a4d3-8b9de3dba17c (e2etraffic.test.portlama.local)  

## Configure agent VM for tunnel

✅ `18:25:42` Added tunnel.test.portlama.local to agent /etc/hosts  
✅ `18:25:42` Added e2etraffic.test.portlama.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `18:25:44` HTTP server running on agent at port 18080  

## Start Chisel client on agent VM

ℹ️ `18:25:44` Waiting for Chisel tunnel to establish...  
✅ `18:25:44` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `18:25:44` Direct tunnel traffic returns expected content  

## Reset TOTP before authentication

✅ `18:25:45` TOTP reset returned otpauth URI  
✅ `18:25:45` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `18:25:48` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `18:25:48` Generated TOTP code: 843851  
✅ `18:25:48` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `18:25:48` Full-path tunnel traffic (nginx + Authelia) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `12` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `12` |

ℹ️ `18:25:48` Cleaning up test resources...  
🔵 `18:25:51` **Running: 03-tunnel-toggle-traffic.sh**  
