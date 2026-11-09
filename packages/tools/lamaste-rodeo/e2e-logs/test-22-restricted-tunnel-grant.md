# Lamaste E2E: 22 — Restricted Tunnel + Per-User Grant (Three-VM)

> Started at `2026-11-09 12:43:36 UTC`


## Pre-flight

✅ `12:43:36` Onboarding is complete  

## Step 1: Create tunnel using the default accessMode

✅ `12:43:38` Tunnel creation returned ok: true  
✅ `12:43:38` Tunnel has an ID  
✅ `12:43:38` Tunnel is owned by test-agent  
✅ `12:43:38` Default accessMode is 'restricted' (security posture)  
ℹ️ `12:43:38` Created restricted tunnel: e2erestricted.test.lamaste.local (ID: 3f833a7a-7f61-4749-b9d7-dce4c0fa7c3d)  
✅ `12:43:39` Second tunnel e2ehostconfusion.test.lamaste.local is 'authenticated' (any Authelia user)  

## Step 2: Wire up host entries and start a marker HTTP server

✅ `12:43:41` Marker HTTP server running on agent at port 18090  

## Step 3: Create a second Authelia user without a grant

✅ `12:43:48` Created second Authelia user (e2eoutsider) for no-grant case  

## Step 4: Authenticate as testuser (will have the grant)

✅ `12:43:49` TOTP reset returned otpauth URI for testuser  
✅ `12:44:03` testuser first factor OK  
✅ `12:44:03` testuser TOTP OK  

## Step 5: testuser WITHOUT a grant is denied (403)

✅ `12:44:03` Restricted tunnel denies authenticated user without grant (403)  

## Step 6: Admin creates a grant for testuser

✅ `12:44:03` Grant created (125591e4-b9eb-43d8-acd0-55be8fd16688)  

## Step 7: testuser WITH a grant is allowed (200 + marker)

✅ `12:44:04` Grantee receives tunnel marker content  
✅ `12:44:04` Grantee reaches tunnel (HTTP 200)  

## Step 8: Outsider authenticates but has no grant → 403

✅ `12:44:32` outsider first factor OK  
✅ `12:44:32` outsider TOTP OK  
✅ `12:44:32` Outsider authenticated but ungranted receives 403  
✅ `12:44:32` Outsider does not see tunnel content (restricted mode holds)  

## Step 8b: Another tunnel's Host header does not open this tunnel

✅ `12:44:33` Restricted tunnel vhost set back to the old form  
✅ `12:44:34` A vhost written the old way closes its tunnel (grantee gets 403)  
✅ `12:44:34` Old vhost: the outsider does not get in with Host e2ehostconfusion.test.lamaste.local  
✅ `12:44:36` Panel startup rewrote the vhost: the subrequest path names e2erestricted.test.lamaste.local  
✅ `12:44:36` Panel startup rewrote the vhost: X-Original-URL names e2erestricted.test.lamaste.local  
✅ `12:44:36` Panel startup rewrote the vhost: Host names e2erestricted.test.lamaste.local  
✅ `12:44:36` The rewritten vhost names no client Host header  
✅ `12:44:38` Rewritten vhost: the grantee gets in again  
✅ `12:44:38` Control: the grantee's request line for e2erestricted.test.lamaste.local with Host e2ehostconfusion.test.lamaste.local is served  
✅ `12:44:38` Outsider with Host e2ehostconfusion.test.lamaste.local is denied this tunnel (403)  
✅ `12:44:38` Outsider with another tunnel's Host does not see tunnel content  
✅ `12:44:38` Anonymous request is sent to the login portal  
✅ `12:44:38` Login redirect returns to e2erestricted.test.lamaste.local, not the Host header  

## Step 9: Revoke testuser's grant → previously-allowed user 403

✅ `12:44:50` Revoked grant blocks the previously-allowed user (403)  
✅ `12:44:51` Previously-allowed user no longer receives tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `34` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `34` |

ℹ️ `12:44:51` Cleaning up test resources...  
