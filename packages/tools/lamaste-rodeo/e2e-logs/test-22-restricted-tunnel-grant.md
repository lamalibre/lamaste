# Lamaste E2E: 22 — Restricted Tunnel + Per-User Grant (Three-VM)

> Started at `2026-11-04 13:36:29 UTC`


## Pre-flight

✅ `13:36:29` Onboarding is complete  

## Step 1: Create tunnel using the default accessMode

✅ `13:36:31` Tunnel creation returned ok: true  
✅ `13:36:31` Tunnel has an ID  
✅ `13:36:31` Tunnel is owned by test-agent  
✅ `13:36:31` Default accessMode is 'restricted' (security posture)  
ℹ️ `13:36:31` Created restricted tunnel: e2erestricted.test.lamaste.local (ID: c8ddb793-b516-42be-bb2b-d94df9e5f958)  
✅ `13:36:32` Second tunnel e2ehostconfusion.test.lamaste.local is 'authenticated' (any Authelia user)  

## Step 2: Wire up host entries and start a marker HTTP server

✅ `13:36:35` Marker HTTP server running on agent at port 18090  

## Step 3: Create a second Authelia user without a grant

✅ `13:36:42` Created second Authelia user (e2eoutsider) for no-grant case  

## Step 4: Authenticate as testuser (will have the grant)

✅ `13:36:43` TOTP reset returned otpauth URI for testuser  
✅ `13:37:03` testuser first factor OK  
✅ `13:37:03` testuser TOTP OK  

## Step 5: testuser WITHOUT a grant is denied (403)

✅ `13:37:03` Restricted tunnel denies authenticated user without grant (403)  

## Step 6: Admin creates a grant for testuser

✅ `13:37:03` Grant created (e9073d86-3c05-4de6-b23f-75da54fa123e)  

## Step 7: testuser WITH a grant is allowed (200 + marker)

✅ `13:37:05` Grantee receives tunnel marker content  
✅ `13:37:05` Grantee reaches tunnel (HTTP 200)  

## Step 8: Outsider authenticates but has no grant → 403

✅ `13:37:33` outsider first factor OK  
✅ `13:37:33` outsider TOTP OK  
✅ `13:37:33` Outsider authenticated but ungranted receives 403  
✅ `13:37:33` Outsider does not see tunnel content (restricted mode holds)  

## Step 8b: Another tunnel's Host header does not open this tunnel

✅ `13:37:34` Restricted tunnel vhost set back to the old form  
✅ `13:37:35` A vhost written the old way closes its tunnel (grantee gets 403)  
✅ `13:37:36` Old vhost: the outsider does not get in with Host e2ehostconfusion.test.lamaste.local  
✅ `13:37:38` Panel startup rewrote the vhost: the subrequest path names e2erestricted.test.lamaste.local  
✅ `13:37:38` Panel startup rewrote the vhost: X-Original-URL names e2erestricted.test.lamaste.local  
✅ `13:37:39` Panel startup rewrote the vhost: Host names e2erestricted.test.lamaste.local  
✅ `13:37:39` The rewritten vhost names no client Host header  
✅ `13:37:40` Rewritten vhost: the grantee gets in again  
✅ `13:37:40` Control: the grantee's request line for e2erestricted.test.lamaste.local with Host e2ehostconfusion.test.lamaste.local is served  
✅ `13:37:41` Outsider with Host e2ehostconfusion.test.lamaste.local is denied this tunnel (403)  
✅ `13:37:41` Outsider with another tunnel's Host does not see tunnel content  
✅ `13:37:41` Anonymous request is sent to the login portal  
✅ `13:37:41` Login redirect returns to e2erestricted.test.lamaste.local, not the Host header  

## Step 9: Revoke testuser's grant → previously-allowed user 403

✅ `13:37:54` Revoked grant blocks the previously-allowed user (403)  
✅ `13:37:54` Previously-allowed user no longer receives tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `34` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `34` |

ℹ️ `13:37:54` Cleaning up test resources...  
