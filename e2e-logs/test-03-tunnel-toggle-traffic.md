# Portlama E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-03-28 16:09:48 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `16:09:50` Tunnel creation returned ok: true  
✅ `16:09:50` Tunnel has an ID  
ℹ️ `16:09:50` Created tunnel ID: 3ac43e35-b586-4cf7-8fa3-e5a3887e9208  
ℹ️ `16:10:00` Waiting for Chisel tunnel to establish...  
✅ `16:10:00` Chisel tunnel established  

## Verify traffic flows (tunnel enabled)

✅ `16:10:00` Traffic flows through enabled tunnel  

## Disable tunnel

✅ `16:10:03` Tunnel disable returned ok: true  
✅ `16:10:03` Tunnel shows as disabled in list  

## Verify traffic blocked (tunnel disabled)

✅ `16:10:05` Tunnel content not accessible after disable (vhost removed)  
✅ `16:10:05` Nginx vhost symlink removed after disable  

## Re-enable tunnel

✅ `16:10:07` Tunnel re-enable returned ok: true  
✅ `16:10:07` Tunnel shows as enabled in list  

## Verify traffic restored (tunnel re-enabled)

✅ `16:10:10` Traffic flows through re-enabled tunnel  
✅ `16:10:10` Nginx vhost restored after re-enable (HTTP 302)  

## Reset TOTP before authentication

✅ `16:10:10` TOTP reset returned otpauth URI  
✅ `16:10:10` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `16:10:13` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `16:10:13` Generated TOTP code: 942334  
✅ `16:10:13` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `16:10:14` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `16:10:14` Cleaning up test resources...  
🔵 `16:10:19` **Running: 04-authelia-auth.sh**  
