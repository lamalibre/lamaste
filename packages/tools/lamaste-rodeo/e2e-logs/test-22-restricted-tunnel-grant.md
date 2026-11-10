# Lamaste E2E: 22 — Restricted Tunnel + Per-User Grant (Three-VM)

> Started at `2026-11-10 17:48:39 UTC`


## Pre-flight

✅ `17:48:39` Onboarding is complete  

## Step 1: Create tunnel using the default accessMode

✅ `17:48:41` Tunnel creation returned ok: true  
✅ `17:48:41` Tunnel has an ID  
✅ `17:48:41` Tunnel is owned by test-agent  
✅ `17:48:41` Default accessMode is 'restricted' (security posture)  
ℹ️ `17:48:41` Created restricted tunnel: e2erestricted.test.lamaste.local (ID: 56c08a43-d161-4c02-8020-bc6d584f5eaf)  
✅ `17:48:42` Second tunnel e2ehostconfusion.test.lamaste.local is 'authenticated' (any Authelia user)  

## Step 2: Wire up host entries and start a marker HTTP server

✅ `17:48:45` Marker HTTP server running on agent at port 18090  

## Step 3: Create a second Authelia user without a grant

✅ `17:48:52` Created second Authelia user (e2eoutsider) for no-grant case  

## Step 4: Authenticate as testuser (will have the grant)

✅ `17:48:53` TOTP reset returned otpauth URI for testuser  
✅ `17:49:03` testuser first factor OK  
✅ `17:49:03` testuser TOTP OK  

## Step 5: testuser WITHOUT a grant is denied (403)

✅ `17:49:03` Restricted tunnel denies authenticated user without grant (403)  

## Step 6: Admin creates a grant for testuser

✅ `17:49:03` Grant created (0464bdfe-381c-4888-9449-b1b32b70efb7)  

## Step 7: testuser WITH a grant is allowed (200 + marker)

✅ `17:49:04` Grantee receives tunnel marker content  
✅ `17:49:05` Grantee reaches tunnel (HTTP 200)  

## Step 8: Outsider authenticates but has no grant → 403

✅ `17:49:32` outsider first factor OK  
✅ `17:49:32` outsider TOTP OK  
✅ `17:49:33` Outsider authenticated but ungranted receives 403  
✅ `17:49:33` Outsider does not see tunnel content (restricted mode holds)  

## Step 8b: Another tunnel's Host header does not open this tunnel

✅ `17:49:33` Restricted tunnel vhost set back to the old form  
✅ `17:49:34` A vhost written the old way closes its tunnel (grantee gets 403)  
✅ `17:49:35` Old vhost: the outsider does not get in with Host e2ehostconfusion.test.lamaste.local  
✅ `17:49:37` Panel startup rewrote the vhost: the subrequest path names e2erestricted.test.lamaste.local  
✅ `17:49:37` Panel startup rewrote the vhost: X-Original-URL names e2erestricted.test.lamaste.local  
✅ `17:49:37` Panel startup rewrote the vhost: Host names e2erestricted.test.lamaste.local  
✅ `17:49:37` The rewritten vhost names no client Host header  
✅ `17:49:38` Rewritten vhost: the grantee gets in again  
✅ `17:49:39` Control: the grantee's request line for e2erestricted.test.lamaste.local with Host e2ehostconfusion.test.lamaste.local is served  
✅ `17:49:39` Outsider with Host e2ehostconfusion.test.lamaste.local is denied this tunnel (403)  
✅ `17:49:39` Outsider with another tunnel's Host does not see tunnel content  
✅ `17:49:39` Anonymous request is sent to the login portal  
✅ `17:49:39` Login redirect returns to e2erestricted.test.lamaste.local, not the Host header  

## Step 9: Revoke testuser's grant → previously-allowed user 403

✅ `17:49:51` Revoked grant blocks the previously-allowed user (403)  
✅ `17:49:51` Previously-allowed user no longer receives tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `34` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `34` |

ℹ️ `17:49:51` Cleaning up test resources...  
