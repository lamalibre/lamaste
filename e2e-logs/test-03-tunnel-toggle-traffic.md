# Portlama E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-03-23 12:10:24 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `12:10:27` Tunnel creation returned ok: true  
✅ `12:10:27` Tunnel has an ID  
ℹ️ `12:10:27` Created tunnel ID: 473ad4e8-d957-4d8d-85f2-ae2283fcf633  
ℹ️ `12:10:29` Waiting for Chisel tunnel to establish...  
✅ `12:10:29` Chisel tunnel established  

## Verify traffic flows (tunnel enabled)

✅ `12:10:30` Traffic flows through enabled tunnel  

## Disable tunnel

✅ `12:10:32` Tunnel disable returned ok: true  
✅ `12:10:32` Tunnel shows as disabled in list  

## Verify traffic blocked (tunnel disabled)

✅ `12:10:34` Tunnel content not accessible after disable (vhost removed)  
✅ `12:10:35` Nginx vhost symlink removed after disable  

## Re-enable tunnel

✅ `12:10:37` Tunnel re-enable returned ok: true  
✅ `12:10:37` Tunnel shows as enabled in list  

## Verify traffic restored (tunnel re-enabled)

✅ `12:10:39` Traffic flows through re-enabled tunnel  
✅ `12:10:39` Nginx vhost restored after re-enable (HTTP 302)  

## Reset TOTP before authentication

✅ `12:10:40` TOTP reset returned otpauth URI  
✅ `12:10:40` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `12:10:43` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `12:10:43` Generated TOTP code: 475339  
✅ `12:10:43` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `12:10:43` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `12:10:43` Cleaning up test resources...  
🔵 `12:10:46` **Running: 04-authelia-auth.sh**  
