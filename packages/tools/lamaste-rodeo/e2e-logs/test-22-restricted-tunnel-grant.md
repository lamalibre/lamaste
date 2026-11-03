# Lamaste E2E: 22 — Restricted Tunnel + Per-User Grant (Three-VM)

> Started at `2026-11-03 09:31:36 UTC`


## Pre-flight

✅ `09:31:36` Onboarding is complete  

## Step 1: Create tunnel using the default accessMode

✅ `09:31:38` Tunnel creation returned ok: true  
✅ `09:31:38` Tunnel has an ID  
✅ `09:31:38` Tunnel is owned by test-agent  
✅ `09:31:38` Default accessMode is 'restricted' (security posture)  
ℹ️ `09:31:38` Created restricted tunnel: e2erestricted.test.lamaste.local (ID: 7ffa6a9b-9a8d-4c45-80d4-56a8723b23cc)  
✅ `09:31:38` Second tunnel e2ehostconfusion.test.lamaste.local is 'authenticated' (any Authelia user)  

## Step 2: Wire up host entries and start a marker HTTP server

✅ `09:31:41` Marker HTTP server running on agent at port 18090  

## Step 3: Create a second Authelia user without a grant

✅ `09:31:48` Created second Authelia user (e2eoutsider) for no-grant case  

## Step 4: Authenticate as testuser (will have the grant)

✅ `09:31:49` TOTP reset returned otpauth URI for testuser  
✅ `09:32:02` testuser first factor OK  
✅ `09:32:03` testuser TOTP OK  

## Step 5: testuser WITHOUT a grant is denied (403)

✅ `09:32:03` Restricted tunnel denies authenticated user without grant (403)  

## Step 6: Admin creates a grant for testuser

✅ `09:32:03` Grant created (99115fc0-98b8-441e-ac2c-952df16674b5)  

## Step 7: testuser WITH a grant is allowed (200 + marker)

✅ `09:32:04` Grantee receives tunnel marker content  
✅ `09:32:04` Grantee reaches tunnel (HTTP 200)  

## Step 8: Outsider authenticates but has no grant → 403

✅ `09:32:33` outsider first factor OK  
✅ `09:32:33` outsider TOTP OK  
✅ `09:32:33` Outsider authenticated but ungranted receives 403  
✅ `09:32:33` Outsider does not see tunnel content (restricted mode holds)  

## Step 8b: Another tunnel's Host header does not open this tunnel

✅ `09:32:34` Restricted tunnel vhost set back to the old form  
✅ `09:32:35` A vhost written the old way closes its tunnel (grantee gets 403)  
✅ `09:32:35` Old vhost: the outsider does not get in with Host e2ehostconfusion.test.lamaste.local  
✅ `09:32:38` Panel startup rewrote the vhost: the subrequest path names e2erestricted.test.lamaste.local  
✅ `09:32:38` Panel startup rewrote the vhost: X-Original-URL names e2erestricted.test.lamaste.local  
✅ `09:32:38` Panel startup rewrote the vhost: Host names e2erestricted.test.lamaste.local  
✅ `09:32:38` The rewritten vhost names no client Host header  
✅ `09:32:39` Rewritten vhost: the grantee gets in again  
✅ `09:32:39` Control: the grantee's request line for e2erestricted.test.lamaste.local with Host e2ehostconfusion.test.lamaste.local is served  
✅ `09:32:39` Outsider with Host e2ehostconfusion.test.lamaste.local is denied this tunnel (403)  
✅ `09:32:39` Outsider with another tunnel's Host does not see tunnel content  
✅ `09:32:40` Anonymous request is sent to the login portal  
✅ `09:32:40` Login redirect returns to e2erestricted.test.lamaste.local, not the Host header  

## Step 9: Revoke testuser's grant → previously-allowed user 403

✅ `09:32:52` Revoked grant blocks the previously-allowed user (403)  
✅ `09:32:52` Previously-allowed user no longer receives tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `34` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `34` |

ℹ️ `09:32:52` Cleaning up test resources...  
