# Portlama E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-03-19 12:18:19 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `12:18:21` Tunnel creation returned ok: true  
✅ `12:18:22` Tunnel has an ID  
ℹ️ `12:18:22` Created tunnel ID: 81aa7d5c-b475-4021-a4a1-3a9025dfa915  
ℹ️ `12:18:24` Waiting for Chisel tunnel to establish...  
✅ `12:18:24` Chisel tunnel established  

## Verify traffic flows (tunnel enabled)

✅ `12:18:24` Traffic flows through enabled tunnel  

## Disable tunnel

✅ `12:18:26` Tunnel disable returned ok: true  
✅ `12:18:27` Tunnel shows as disabled in list  

## Verify traffic blocked (tunnel disabled)

✅ `12:18:29` Tunnel content not accessible after disable (vhost removed)  
✅ `12:18:29` Nginx vhost symlink removed after disable  

## Re-enable tunnel

✅ `12:18:31` Tunnel re-enable returned ok: true  
✅ `12:18:31` Tunnel shows as enabled in list  

## Verify traffic restored (tunnel re-enabled)

✅ `12:18:33` Traffic flows through re-enabled tunnel  
✅ `12:18:34` Nginx vhost restored after re-enable (HTTP 302)  

## Reset TOTP before authentication

✅ `12:18:34` TOTP reset returned otpauth URI  
✅ `12:18:34` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `12:18:37` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `12:18:37` Generated TOTP code: 319775  
✅ `12:18:37` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `12:18:37` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `12:18:37` Cleaning up test resources...  
🔵 `12:18:40` **Running: 04-authelia-auth.sh**  
