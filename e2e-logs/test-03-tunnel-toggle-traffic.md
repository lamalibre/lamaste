# Lamaste E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-03-30 13:09:01 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `13:09:04` Tunnel creation returned ok: true  
✅ `13:09:04` Tunnel has an ID  
ℹ️ `13:09:04` Created tunnel ID: 1ecb47ae-205e-43fc-ba17-32b1eb693932  
ℹ️ `13:09:13` Waiting for Chisel tunnel to establish...  
✅ `13:09:14` Chisel tunnel established  

## Verify traffic flows (tunnel enabled)

✅ `13:09:14` Traffic flows through enabled tunnel  

## Disable tunnel

✅ `13:09:16` Tunnel disable returned ok: true  
✅ `13:09:16` Tunnel shows as disabled in list  

## Verify traffic blocked (tunnel disabled)

✅ `13:09:18` Tunnel content not accessible after disable (vhost removed)  
✅ `13:09:18` Nginx vhost symlink removed after disable  

## Re-enable tunnel

✅ `13:09:21` Tunnel re-enable returned ok: true  
✅ `13:09:21` Tunnel shows as enabled in list  

## Verify traffic restored (tunnel re-enabled)

✅ `13:09:23` Traffic flows through re-enabled tunnel  
✅ `13:09:23` Nginx vhost restored after re-enable (HTTP 302)  

## Reset TOTP before authentication

✅ `13:09:23` TOTP reset returned otpauth URI  
✅ `13:09:23` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `13:09:27` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `13:09:27` Generated TOTP code: 449430  
✅ `13:09:27` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `13:09:27` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `13:09:27` Cleaning up test resources...  
🔵 `13:09:33` **Running: 04-authelia-auth.sh**  
