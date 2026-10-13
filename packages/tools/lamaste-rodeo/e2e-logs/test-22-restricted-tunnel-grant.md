# Lamaste E2E: 22 — Restricted Tunnel + Per-User Grant (Three-VM)

> Started at `2026-10-13 11:51:11 UTC`


## Pre-flight

✅ `11:51:12` Onboarding is complete  

## Step 1: Create tunnel using the default accessMode

✅ `11:51:13` Tunnel creation returned ok: true  
✅ `11:51:13` Tunnel has an ID  
✅ `11:51:13` Tunnel is owned by test-agent  
✅ `11:51:13` Default accessMode is 'restricted' (security posture)  
ℹ️ `11:51:13` Created restricted tunnel: e2erestricted.test.lamaste.local (ID: ffdc6a3c-412d-430a-99d5-9ea0022520e0)  

## Step 2: Wire up host entries and start a marker HTTP server

✅ `11:51:16` Marker HTTP server running on agent at port 18090  

## Step 3: Create a second Authelia user without a grant

✅ `11:51:24` Created second Authelia user (e2eoutsider) for no-grant case  

## Step 4: Authenticate as testuser (will have the grant)

✅ `11:51:25` TOTP reset returned otpauth URI for testuser  
✅ `11:51:33` testuser first factor OK  
✅ `11:51:33` testuser TOTP OK  

## Step 5: testuser WITHOUT a grant is denied (403)

✅ `11:51:33` Restricted tunnel denies authenticated user without grant (403)  

## Step 6: Admin creates a grant for testuser

✅ `11:51:33` Grant created (8f5cd07f-dfca-4893-b5d7-6919c73d8d0e)  

## Step 7: testuser WITH a grant is allowed (200 + marker)

✅ `11:51:35` Grantee receives tunnel marker content  
✅ `11:51:35` Grantee reaches tunnel (HTTP 200)  

## Step 8: Outsider authenticates but has no grant → 403

✅ `11:52:02` outsider first factor OK  
✅ `11:52:03` outsider TOTP OK  
✅ `11:52:03` Outsider authenticated but ungranted receives 403  
✅ `11:52:03` Outsider does not see tunnel content (restricted mode holds)  

## Step 9: Revoke testuser's grant → previously-allowed user 403

✅ `11:52:16` Revoked grant blocks the previously-allowed user (403)  
✅ `11:52:16` Previously-allowed user no longer receives tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

ℹ️ `11:52:16` Cleaning up test resources...  
