# Portlama E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-03-28 22:40:25 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `22:40:28` Tunnel creation returned ok: true  
✅ `22:40:28` Tunnel has an ID  
ℹ️ `22:40:28` Created tunnel ID: 23dc5471-6ae5-4089-96c5-08d7b7dd4d35  
ℹ️ `22:40:37` Waiting for Chisel tunnel to establish...  
✅ `22:40:37` Chisel tunnel established  

## Verify traffic flows (tunnel enabled)

✅ `22:40:37` Traffic flows through enabled tunnel  

## Disable tunnel

✅ `22:40:40` Tunnel disable returned ok: true  
✅ `22:40:40` Tunnel shows as disabled in list  

## Verify traffic blocked (tunnel disabled)

✅ `22:40:42` Tunnel content not accessible after disable (vhost removed)  
✅ `22:40:42` Nginx vhost symlink removed after disable  

## Re-enable tunnel

✅ `22:40:45` Tunnel re-enable returned ok: true  
✅ `22:40:45` Tunnel shows as enabled in list  

## Verify traffic restored (tunnel re-enabled)

✅ `22:40:47` Traffic flows through re-enabled tunnel  
✅ `22:40:47` Nginx vhost restored after re-enable (HTTP 302)  

## Reset TOTP before authentication

✅ `22:40:47` TOTP reset returned otpauth URI  
✅ `22:40:47` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `22:40:50` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `22:40:51` Generated TOTP code: 621390  
✅ `22:40:51` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `22:40:51` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `22:40:51` Cleaning up test resources...  
🔵 `22:40:56` **Running: 04-authelia-auth.sh**  
