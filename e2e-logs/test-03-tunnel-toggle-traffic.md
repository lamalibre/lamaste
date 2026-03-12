# Portlama E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-03-16 17:22:33 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `17:22:36` Tunnel creation returned ok: true  
✅ `17:22:36` Tunnel has an ID  
ℹ️ `17:22:36` Created tunnel ID: e5f1e384-b033-4aff-b16c-d4ed10eb7c6a  
ℹ️ `17:22:39` Waiting for Chisel tunnel to establish...  
✅ `17:22:39` Chisel tunnel established  

## Verify traffic flows (tunnel enabled)

✅ `17:22:39` Traffic flows through enabled tunnel  

## Disable tunnel

✅ `17:22:41` Tunnel disable returned ok: true  
✅ `17:22:41` Tunnel shows as disabled in list  

## Verify traffic blocked (tunnel disabled)

✅ `17:22:43` Tunnel content not accessible after disable (vhost removed)  
✅ `17:22:43` Nginx vhost symlink removed after disable  

## Re-enable tunnel

✅ `17:22:46` Tunnel re-enable returned ok: true  
✅ `17:22:46` Tunnel shows as enabled in list  

## Verify traffic restored (tunnel re-enabled)

✅ `17:22:48` Traffic flows through re-enabled tunnel  
✅ `17:22:48` Nginx vhost restored after re-enable (HTTP 302)  

## Reset TOTP before authentication

✅ `17:22:48` TOTP reset returned otpauth URI  
✅ `17:22:48` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `17:22:52` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `17:22:52` Generated TOTP code: 625104  
✅ `17:22:52` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `17:22:52` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `17:22:52` Cleaning up test resources...  
🔵 `17:22:55` **Running: 04-authelia-auth.sh**  
