# Lamaste E2E: 22 — Restricted Tunnel + Per-User Grant (Three-VM)

> Started at `2026-10-25 17:19:47 UTC`


## Pre-flight

✅ `17:19:47` Onboarding is complete  

## Step 1: Create tunnel using the default accessMode

✅ `17:19:48` Tunnel creation returned ok: true  
✅ `17:19:48` Tunnel has an ID  
✅ `17:19:48` Tunnel is owned by test-agent  
✅ `17:19:48` Default accessMode is 'restricted' (security posture)  
ℹ️ `17:19:48` Created restricted tunnel: e2erestricted.test.lamaste.local (ID: fc8a4480-e2da-4317-a319-70f76f0d2d8b)  
✅ `17:19:49` Second tunnel e2ehostconfusion.test.lamaste.local is 'authenticated' (any Authelia user)  

## Step 2: Wire up host entries and start a marker HTTP server

✅ `17:19:52` Marker HTTP server running on agent at port 18090  

## Step 3: Create a second Authelia user without a grant

✅ `17:20:00` Created second Authelia user (e2eoutsider) for no-grant case  

## Step 4: Authenticate as testuser (will have the grant)

✅ `17:20:01` TOTP reset returned otpauth URI for testuser  
✅ `17:20:33` testuser first factor OK  
✅ `17:20:33` testuser TOTP OK  

## Step 5: testuser WITHOUT a grant is denied (403)

✅ `17:20:33` Restricted tunnel denies authenticated user without grant (403)  

## Step 6: Admin creates a grant for testuser

✅ `17:20:34` Grant created (9d01e66d-817c-4ff0-9eb6-427e23ae19c5)  

## Step 7: testuser WITH a grant is allowed (200 + marker)

✅ `17:20:35` Grantee receives tunnel marker content  
✅ `17:20:35` Grantee reaches tunnel (HTTP 200)  

## Step 8: Outsider authenticates but has no grant → 403

✅ `17:21:03` outsider first factor OK  
✅ `17:21:03` outsider TOTP OK  
✅ `17:21:03` Outsider authenticated but ungranted receives 403  
✅ `17:21:03` Outsider does not see tunnel content (restricted mode holds)  

## Step 8b: Another tunnel's Host header does not open this tunnel

✅ `17:21:04` Restricted tunnel vhost set back to the old form  
✅ `17:21:05` A vhost written the old way closes its tunnel (grantee gets 403)  
✅ `17:21:05` Old vhost: the outsider does not get in with Host e2ehostconfusion.test.lamaste.local  
✅ `17:21:08` Panel startup rewrote the vhost: the subrequest path names e2erestricted.test.lamaste.local  
✅ `17:21:08` Panel startup rewrote the vhost: X-Original-URL names e2erestricted.test.lamaste.local  
✅ `17:21:08` Panel startup rewrote the vhost: Host names e2erestricted.test.lamaste.local  
✅ `17:21:08` The rewritten vhost names no client Host header  
✅ `17:21:09` Rewritten vhost: the grantee gets in again  
✅ `17:21:09` Control: the grantee's request line for e2erestricted.test.lamaste.local with Host e2ehostconfusion.test.lamaste.local is served  
✅ `17:21:09` Outsider with Host e2ehostconfusion.test.lamaste.local is denied this tunnel (403)  
✅ `17:21:09` Outsider with another tunnel's Host does not see tunnel content  
✅ `17:21:09` Anonymous request is sent to the login portal  
✅ `17:21:09` Login redirect returns to e2erestricted.test.lamaste.local, not the Host header  

## Step 9: Revoke testuser's grant → previously-allowed user 403

✅ `17:21:22` Revoked grant blocks the previously-allowed user (403)  
✅ `17:21:22` Previously-allowed user no longer receives tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `34` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `34` |

ℹ️ `17:21:22` Cleaning up test resources...  
