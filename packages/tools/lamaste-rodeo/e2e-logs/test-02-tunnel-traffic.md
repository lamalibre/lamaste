# Lamaste E2E: 02 — Tunnel Traffic (Three-VM)

> Started at `2026-04-30 08:56:09 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel via API

✅ `08:56:12` Tunnel creation returned ok: true  
✅ `08:56:12` Tunnel has an ID  
ℹ️ `08:56:12` Created tunnel ID: 38aa3530-9621-45c3-a5be-f3a6c5bc267f (e2etraffic.test.lamaste.local)  

## Configure agent VM for tunnel

✅ `08:56:12` Added tunnel.test.lamaste.local to agent /etc/hosts  
✅ `08:56:12` Added e2etraffic.test.lamaste.local to agent /etc/hosts  

## Start HTTP server on agent VM

✅ `08:56:15` HTTP server running on agent at port 18080  

## Refresh agent config to pick up new tunnel

ℹ️ `08:56:17` Waiting for Chisel tunnel to establish...  
✅ `08:56:17` Chisel tunnel established (port 18080 accessible on host)  

## Verify traffic through tunnel (direct, bypassing Authelia)

✅ `08:56:17` Direct tunnel traffic returns expected content  

## Reset TOTP before authentication

✅ `08:56:18` TOTP reset returned otpauth URI  
✅ `08:56:18` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `08:56:32` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `08:56:32` Generated TOTP code: 002636  
✅ `08:56:32` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with Authelia (full path)

✅ `08:56:32` Full-path tunnel traffic (nginx + Authelia) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `12` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `12` |

ℹ️ `08:56:33` Cleaning up test resources...  
