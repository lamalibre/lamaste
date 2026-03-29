# Portlama E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-03-29 09:10:01 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `09:10:04` Tunnel creation returned ok: true  
✅ `09:10:04` Tunnel has an ID  
ℹ️ `09:10:04` Created tunnel ID: 2b8b2730-ca71-4b6b-8048-2e0fcb2ef537  
ℹ️ `09:10:14` Waiting for Chisel tunnel to establish...  
✅ `09:10:14` Chisel tunnel established  

## Verify traffic flows (tunnel enabled)

✅ `09:10:14` Traffic flows through enabled tunnel  

## Disable tunnel

✅ `09:10:16` Tunnel disable returned ok: true  
✅ `09:10:16` Tunnel shows as disabled in list  

## Verify traffic blocked (tunnel disabled)

✅ `09:10:18` Tunnel content not accessible after disable (vhost removed)  
✅ `09:10:18` Nginx vhost symlink removed after disable  

## Re-enable tunnel

✅ `09:10:21` Tunnel re-enable returned ok: true  
✅ `09:10:21` Tunnel shows as enabled in list  

## Verify traffic restored (tunnel re-enabled)

✅ `09:10:23` Traffic flows through re-enabled tunnel  
✅ `09:10:23` Nginx vhost restored after re-enable (HTTP 302)  

## Reset TOTP before authentication

✅ `09:10:23` TOTP reset returned otpauth URI  
✅ `09:10:23` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `09:10:27` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `09:10:27` Generated TOTP code: 440737  
✅ `09:10:27` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `09:10:27` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `09:10:27` Cleaning up test resources...  
🔵 `09:10:32` **Running: 04-authelia-auth.sh**  
