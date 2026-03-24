# Portlama E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-03-24 09:38:24 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `09:38:27` Tunnel creation returned ok: true  
✅ `09:38:27` Tunnel has an ID  
ℹ️ `09:38:27` Created tunnel ID: 76739a76-e624-4089-9e6d-18589d0b5565 (e2etraffic.test.portlama.local)  

## Configure agent VM for tunnel

✅ `09:38:27` Added tunnel.test.portlama.local to agent /etc/hosts  
✅ `09:38:27` Added e2etraffic.test.portlama.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `09:38:29` HTTP server running on agent at port 18080  

## Start Chisel client on agent VM

ℹ️ `09:38:29` Waiting for Chisel tunnel to establish...  
✅ `09:38:30` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `09:38:30` Direct tunnel traffic returns expected content  

## Reset TOTP before authentication

✅ `09:38:30` TOTP reset returned otpauth URI  
✅ `09:38:30` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `09:38:33` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `09:38:33` Generated TOTP code: 223957  
✅ `09:38:33` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `09:38:33` Full-path tunnel traffic (nginx + Authelia) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `12` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `12` |

ℹ️ `09:38:33` Cleaning up test resources...  
🔵 `09:38:36` **Running: 03-tunnel-toggle-traffic.sh**  
