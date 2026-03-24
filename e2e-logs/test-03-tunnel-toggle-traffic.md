# Portlama E2E: 03 — Tunnel Toggle Traffic (Three-VM)

> Started at `2026-03-24 08:11:48 UTC`


## Pre-flight: verify onboarding is complete


## Create tunnel and establish connection

✅ `08:11:51` Tunnel creation returned ok: true  
✅ `08:11:51` Tunnel has an ID  
ℹ️ `08:11:51` Created tunnel ID: 1c39cd80-6a03-4786-9b11-a3106e77c3bf  
ℹ️ `08:11:53` Waiting for Chisel tunnel to establish...  
✅ `08:11:53` Chisel tunnel established  

## Verify traffic flows (tunnel enabled)

✅ `08:11:54` Traffic flows through enabled tunnel  

## Disable tunnel

✅ `08:11:56` Tunnel disable returned ok: true  
✅ `08:11:56` Tunnel shows as disabled in list  

## Verify traffic blocked (tunnel disabled)

✅ `08:11:58` Tunnel content not accessible after disable (vhost removed)  
✅ `08:11:58` Nginx vhost symlink removed after disable  

## Re-enable tunnel

✅ `08:12:01` Tunnel re-enable returned ok: true  
✅ `08:12:01` Tunnel shows as enabled in list  

## Verify traffic restored (tunnel re-enabled)

✅ `08:12:03` Traffic flows through re-enabled tunnel  
✅ `08:12:03` Nginx vhost restored after re-enable (HTTP 302)  

## Reset TOTP before authentication

✅ `08:12:03` TOTP reset returned otpauth URI  
✅ `08:12:03` Extracted TOTP secret from otpauth URI  

## Authenticate with Authelia (first factor)

✅ `08:12:06` Authelia first factor authentication succeeded  

## Second factor authentication (TOTP)

ℹ️ `08:12:07` Generated TOTP code: 396236  
✅ `08:12:07` Second factor authentication succeeded (TOTP accepted)  

## Verify traffic through nginx with full 2FA (re-enabled tunnel)

✅ `08:12:07` Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

ℹ️ `08:12:07` Cleaning up test resources...  
🔵 `08:12:10` **Running: 04-authelia-auth.sh**  
