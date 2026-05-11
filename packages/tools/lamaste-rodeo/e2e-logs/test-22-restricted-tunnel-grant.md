# Lamaste E2E: 22 — Restricted Tunnel + Per-User Grant (Three-VM)

> Started at `2026-04-30 09:06:05 UTC`


## Pre-flight

✅ `09:06:05` Onboarding is complete  

## Step 1: Create tunnel using the default accessMode

✅ `09:06:08` Tunnel creation returned ok: true  
✅ `09:06:08` Tunnel has an ID  
✅ `09:06:08` Default accessMode is 'restricted' (security posture)  
ℹ️ `09:06:08` Created restricted tunnel: e2erestricted.test.lamaste.local (ID: 4d0328ce-0355-4bbb-a27d-cc9ccb0e3919)  

## Step 2: Wire up host entries and start a marker HTTP server

✅ `09:06:11` Marker HTTP server running on agent at port 18090  

## Step 3: Create a second Authelia user without a grant

✅ `09:07:19` Created second Authelia user (e2eoutsider) for no-grant case  

## Step 4: Authenticate as testuser (will have the grant)

✅ `09:07:20` TOTP reset returned otpauth URI for testuser  
✅ `09:07:33` testuser first factor OK  
✅ `09:07:33` testuser TOTP OK  

## Step 5: testuser WITHOUT a grant is denied (403)

✅ `09:07:33` Restricted tunnel denies authenticated user without grant (403)  

## Step 6: Admin creates a grant for testuser

✅ `09:07:33` Grant created (8385a482-c03f-4ef8-b836-8815def6c590)  

## Step 7: testuser WITH a grant is allowed (200 + marker)

✅ `09:07:34` Grantee receives tunnel marker content  
✅ `09:07:34` Grantee reaches tunnel (HTTP 200)  

## Step 8: Outsider authenticates but has no grant → 403

✅ `09:08:02` outsider first factor OK  
✅ `09:08:02` outsider TOTP OK  
✅ `09:08:02` Outsider authenticated but ungranted receives 403  
✅ `09:08:02` Outsider does not see tunnel content (restricted mode holds)  

## Step 9: Revoke testuser's grant → previously-allowed user 403

✅ `09:08:50` Revoked grant blocks the previously-allowed user (403)  
✅ `09:08:50` Previously-allowed user no longer receives tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `19` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `19` |

ℹ️ `09:08:50` Cleaning up test resources...  
