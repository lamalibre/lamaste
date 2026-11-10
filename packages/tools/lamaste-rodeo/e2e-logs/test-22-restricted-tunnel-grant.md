# Lamaste E2E: 22 — Restricted Tunnel + Per-User Grant (Three-VM)

> Started at `2026-11-10 13:05:47 UTC`


## Pre-flight

✅ `13:05:47` Onboarding is complete  

## Step 1: Create tunnel using the default accessMode

✅ `13:05:49` Tunnel creation returned ok: true  
✅ `13:05:49` Tunnel has an ID  
✅ `13:05:49` Tunnel is owned by test-agent  
✅ `13:05:49` Default accessMode is 'restricted' (security posture)  
ℹ️ `13:05:49` Created restricted tunnel: e2erestricted.test.lamaste.local (ID: 8d1c5608-a74a-4129-a272-5dd138292525)  
✅ `13:05:50` Second tunnel e2ehostconfusion.test.lamaste.local is 'authenticated' (any Authelia user)  

## Step 2: Wire up host entries and start a marker HTTP server

✅ `13:05:53` Marker HTTP server running on agent at port 18090  

## Step 3: Create a second Authelia user without a grant

✅ `13:06:00` Created second Authelia user (e2eoutsider) for no-grant case  

## Step 4: Authenticate as testuser (will have the grant)

✅ `13:06:01` TOTP reset returned otpauth URI for testuser  
✅ `13:06:32` testuser first factor OK  
✅ `13:06:33` testuser TOTP OK  

## Step 5: testuser WITHOUT a grant is denied (403)

✅ `13:06:33` Restricted tunnel denies authenticated user without grant (403)  

## Step 6: Admin creates a grant for testuser

✅ `13:06:33` Grant created (2ef69735-7a32-472a-b8f5-964c7b53d402)  

## Step 7: testuser WITH a grant is allowed (200 + marker)

✅ `13:06:35` Grantee receives tunnel marker content  
✅ `13:06:35` Grantee reaches tunnel (HTTP 200)  

## Step 8: Outsider authenticates but has no grant → 403

✅ `13:07:03` outsider first factor OK  
✅ `13:07:03` outsider TOTP OK  
✅ `13:07:03` Outsider authenticated but ungranted receives 403  
✅ `13:07:03` Outsider does not see tunnel content (restricted mode holds)  

## Step 8b: Another tunnel's Host header does not open this tunnel

✅ `13:07:04` Restricted tunnel vhost set back to the old form  
✅ `13:07:05` A vhost written the old way closes its tunnel (grantee gets 403)  
✅ `13:07:05` Old vhost: the outsider does not get in with Host e2ehostconfusion.test.lamaste.local  
✅ `13:07:08` Panel startup rewrote the vhost: the subrequest path names e2erestricted.test.lamaste.local  
✅ `13:07:08` Panel startup rewrote the vhost: X-Original-URL names e2erestricted.test.lamaste.local  
✅ `13:07:08` Panel startup rewrote the vhost: Host names e2erestricted.test.lamaste.local  
✅ `13:07:08` The rewritten vhost names no client Host header  
✅ `13:07:09` Rewritten vhost: the grantee gets in again  
✅ `13:07:09` Control: the grantee's request line for e2erestricted.test.lamaste.local with Host e2ehostconfusion.test.lamaste.local is served  
✅ `13:07:10` Outsider with Host e2ehostconfusion.test.lamaste.local is denied this tunnel (403)  
✅ `13:07:10` Outsider with another tunnel's Host does not see tunnel content  
✅ `13:07:10` Anonymous request is sent to the login portal  
✅ `13:07:10` Login redirect returns to e2erestricted.test.lamaste.local, not the Host header  

## Step 9: Revoke testuser's grant → previously-allowed user 403

✅ `13:07:22` Revoked grant blocks the previously-allowed user (403)  
✅ `13:07:22` Previously-allowed user no longer receives tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `34` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `34` |

ℹ️ `13:07:22` Cleaning up test resources...  
