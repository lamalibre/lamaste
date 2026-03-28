# Portlama E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-03-28 16:09:27 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `16:09:30` Tunnel creation returned ok: true  
✅ `16:09:30` Tunnel has an ID  
ℹ️ `16:09:30` Created tunnel ID: f4914a20-71a8-42c8-88e8-0dfbef1d4806 (e2etraffic.test.portlama.local)  

## Configure agent VM for tunnel

✅ `16:09:30` Added tunnel.test.portlama.local to agent /etc/hosts  
✅ `16:09:30` Added e2etraffic.test.portlama.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `16:09:32` HTTP server running on agent at port 18080  

## Refresh agent config to pick up new tunnel

ℹ️ `16:09:35` Waiting for Chisel tunnel to establish...  
✅ `16:09:35` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `16:09:35` Direct tunnel traffic returns expected content  

## Reset TOTP before authentication

✅ `16:09:35` TOTP reset returned otpauth URI  
✅ `16:09:35` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `16:09:39` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `16:09:39` Generated TOTP code: 447290  
✅ `16:09:39` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `16:09:39` Full-path tunnel traffic (nginx + Authelia) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `12` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `12` |

ℹ️ `16:09:39` Cleaning up test resources...  
🔵 `16:09:45` **Running: 03-tunnel-toggle-traffic.sh**  
