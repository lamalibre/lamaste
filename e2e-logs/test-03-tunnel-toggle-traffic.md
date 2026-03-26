# Portlama E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-03-26 10:48:19 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `10:48:21` Tunnel creation returned ok: true  
✅ `10:48:21` Tunnel has an ID  
ℹ️ `10:48:21` Created tunnel ID: a5d26fa3-83ee-43ff-b6fb-cb75c27a2f8e  
ℹ️ `10:48:31` Waiting for Chisel tunnel to establish...  
✅ `10:48:31` Chisel tunnel established  

## Verify traffic flows (tunnel enabled)

✅ `10:48:31` Traffic flows through enabled tunnel  

## Disable tunnel

✅ `10:48:34` Tunnel disable returned ok: true  
✅ `10:48:34` Tunnel shows as disabled in list  

## Verify traffic blocked (tunnel disabled)

✅ `10:48:36` Tunnel content not accessible after disable (vhost removed)  
✅ `10:48:36` Nginx vhost symlink removed after disable  

## Re-enable tunnel

✅ `10:48:38` Tunnel re-enable returned ok: true  
✅ `10:48:38` Tunnel shows as enabled in list  

## Verify traffic restored (tunnel re-enabled)

✅ `10:48:40` Traffic flows through re-enabled tunnel  
✅ `10:48:41` Nginx vhost restored after re-enable (HTTP 302)  

## Reset TOTP before authentication

✅ `10:48:41` TOTP reset returned otpauth URI  
✅ `10:48:41` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `10:48:44` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `10:48:44` Generated TOTP code: 403731  
✅ `10:48:44` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `10:48:44` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `10:48:45` Cleaning up test resources...  
🔵 `10:48:50` **Running: 04-authelia-auth.sh**  
