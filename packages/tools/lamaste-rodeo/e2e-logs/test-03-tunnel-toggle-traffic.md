# Lamaste E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-04-30 08:56:38 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `08:56:41` Tunnel creation returned ok: true  
✅ `08:56:41` Tunnel has an ID  
ℹ️ `08:56:41` Created tunnel ID: f3902326-fa10-4d2a-9894-7c0caba878ed  
ℹ️ `08:56:48` Waiting for Chisel tunnel to establish...  
✅ `08:56:49` Chisel tunnel established  

## Verify traffic flows (tunnel enabled)

✅ `08:56:49` Traffic flows through enabled tunnel  

## Disable tunnel

✅ `08:56:51` Tunnel disable returned ok: true  
✅ `08:56:51` Tunnel shows as disabled in list  

## Verify traffic blocked (tunnel disabled)

✅ `08:56:53` Tunnel content not accessible after disable (vhost removed)  
✅ `08:56:53` Nginx vhost symlink removed after disable  

## Re-enable tunnel

✅ `08:56:56` Tunnel re-enable returned ok: true  
✅ `08:56:56` Tunnel shows as enabled in list  

## Verify traffic restored (tunnel re-enabled)

✅ `08:56:58` Traffic flows through re-enabled tunnel  
✅ `08:56:58` Nginx vhost restored after re-enable (HTTP 302)  

## Reset TOTP before authentication

✅ `08:56:59` TOTP reset returned otpauth URI  
✅ `08:56:59` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `08:57:02` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `08:57:02` Generated TOTP code: 290244  
✅ `08:57:02` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `08:57:02` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `08:57:02` Cleaning up test resources...  
