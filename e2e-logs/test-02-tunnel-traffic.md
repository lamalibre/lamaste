# Portlama E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-03-24 08:11:33 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `08:11:36` Tunnel creation returned ok: true  
✅ `08:11:36` Tunnel has an ID  
ℹ️ `08:11:36` Created tunnel ID: 6e572bba-cd07-45bb-ba51-0bf217656e60 (e2etraffic.test.portlama.local)  

## Configure agent VM for tunnel

✅ `08:11:36` Added tunnel.test.portlama.local to agent /etc/hosts  
✅ `08:11:36` Added e2etraffic.test.portlama.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `08:11:38` HTTP server running on agent at port 18080  

## Start Chisel client on agent VM

ℹ️ `08:11:38` Waiting for Chisel tunnel to establish...  
✅ `08:11:38` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `08:11:38` Direct tunnel traffic returns expected content  

## Reset TOTP before authentication

✅ `08:11:39` TOTP reset returned otpauth URI  
✅ `08:11:39` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `08:11:42` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `08:11:42` Generated TOTP code: 968545  
✅ `08:11:42` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `08:11:42` Full-path tunnel traffic (nginx + Authelia) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `12` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `12` |

ℹ️ `08:11:42` Cleaning up test resources...  
🔵 `08:11:45` **Running: 03-tunnel-toggle-traffic.sh**  
