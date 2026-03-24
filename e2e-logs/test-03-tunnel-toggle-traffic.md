# Portlama E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-03-24 09:38:39 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `09:38:42` Tunnel creation returned ok: true  
✅ `09:38:42` Tunnel has an ID  
ℹ️ `09:38:42` Created tunnel ID: 75137d37-ea01-4f64-b819-a1306bc606c4  
ℹ️ `09:38:45` Waiting for Chisel tunnel to establish...  
✅ `09:38:45` Chisel tunnel established  

## Verify traffic flows (tunnel enabled)

✅ `09:38:45` Traffic flows through enabled tunnel  

## Disable tunnel

✅ `09:38:47` Tunnel disable returned ok: true  
✅ `09:38:47` Tunnel shows as disabled in list  

## Verify traffic blocked (tunnel disabled)

✅ `09:38:49` Tunnel content not accessible after disable (vhost removed)  
✅ `09:38:49` Nginx vhost symlink removed after disable  

## Re-enable tunnel

✅ `09:38:52` Tunnel re-enable returned ok: true  
✅ `09:38:52` Tunnel shows as enabled in list  

## Verify traffic restored (tunnel re-enabled)

✅ `09:38:54` Traffic flows through re-enabled tunnel  
✅ `09:38:54` Nginx vhost restored after re-enable (HTTP 302)  

## Reset TOTP before authentication

✅ `09:38:54` TOTP reset returned otpauth URI  
✅ `09:38:54` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `09:38:57` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `09:38:58` Generated TOTP code: 806420  
✅ `09:38:58` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `09:38:58` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `09:38:58` Cleaning up test resources...  
🔵 `09:39:01` **Running: 04-authelia-auth.sh**  
