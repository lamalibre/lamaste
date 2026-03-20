# Portlama E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-03-20 14:34:50 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `14:34:53` Tunnel creation returned ok: true  
✅ `14:34:53` Tunnel has an ID  
ℹ️ `14:34:53` Created tunnel ID: 76385882-8d1b-44d7-a061-369efd498a9f  
ℹ️ `14:34:55` Waiting for Chisel tunnel to establish...  
✅ `14:34:55` Chisel tunnel established  

## Verify traffic flows (tunnel enabled)

✅ `14:34:55` Traffic flows through enabled tunnel  

## Disable tunnel

✅ `14:34:58` Tunnel disable returned ok: true  
✅ `14:34:58` Tunnel shows as disabled in list  

## Verify traffic blocked (tunnel disabled)

✅ `14:35:00` Tunnel content not accessible after disable (vhost removed)  
✅ `14:35:00` Nginx vhost symlink removed after disable  

## Re-enable tunnel

✅ `14:35:02` Tunnel re-enable returned ok: true  
✅ `14:35:02` Tunnel shows as enabled in list  

## Verify traffic restored (tunnel re-enabled)

✅ `14:35:05` Traffic flows through re-enabled tunnel  
✅ `14:35:05` Nginx vhost restored after re-enable (HTTP 302)  

## Reset TOTP before authentication

✅ `14:35:05` TOTP reset returned otpauth URI  
✅ `14:35:05` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `14:35:08` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `14:35:08` Generated TOTP code: 362098  
✅ `14:35:08` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `14:35:08` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `14:35:09` Cleaning up test resources...  
🔵 `14:35:11` **Running: 04-authelia-auth.sh**  
