# Lamaste E2E: 22 — Restricted Tunnel + Per-User Grant (Three-VM)

> Started at `2026-11-11 09:04:38 UTC`


## Pre-flight

✅ `09:04:38` Onboarding is complete  

## Step 1: Create tunnel using the default accessMode

✅ `09:04:40` Tunnel creation returned ok: true  
✅ `09:04:40` Tunnel has an ID  
✅ `09:04:40` Tunnel is owned by test-agent  
✅ `09:04:40` Default accessMode is 'restricted' (security posture)  
ℹ️ `09:04:40` Created restricted tunnel: e2erestricted.test.lamaste.local (ID: 02996f96-2451-4f4d-8229-41f69e9c23a8)  
✅ `09:04:41` Second tunnel e2ehostconfusion.test.lamaste.local is 'authenticated' (any Authelia user)  

## Step 2: Wire up host entries and start a marker HTTP server

✅ `09:04:44` Marker HTTP server running on agent at port 18090  

## Step 3: Create a second Authelia user without a grant

✅ `09:04:50` Created second Authelia user (e2eoutsider) for no-grant case  

## Step 4: Authenticate as testuser (will have the grant)

✅ `09:04:52` TOTP reset returned otpauth URI for testuser  
✅ `09:05:02` testuser first factor OK  
✅ `09:05:02` testuser TOTP OK  

## Step 5: testuser WITHOUT a grant is denied (403)

✅ `09:05:03` Restricted tunnel denies authenticated user without grant (403)  

## Step 6: Admin creates a grant for testuser

✅ `09:05:03` Grant created (f9d6b009-2644-4c7f-9862-b04eceb039c8)  

## Step 7: testuser WITH a grant is allowed (200 + marker)

✅ `09:05:04` Grantee receives tunnel marker content  
✅ `09:05:04` Grantee reaches tunnel (HTTP 200)  

## Step 8: Outsider authenticates but has no grant → 403

✅ `09:05:32` outsider first factor OK  
✅ `09:05:32` outsider TOTP OK  
✅ `09:05:32` Outsider authenticated but ungranted receives 403  
✅ `09:05:32` Outsider does not see tunnel content (restricted mode holds)  

## Step 8b: Another tunnel's Host header does not open this tunnel

✅ `09:05:33` Restricted tunnel vhost set back to the old form  
✅ `09:05:34` A vhost written the old way closes its tunnel (grantee gets 403)  
✅ `09:05:34` Old vhost: the outsider does not get in with Host e2ehostconfusion.test.lamaste.local  
✅ `09:05:37` Panel startup rewrote the vhost: the subrequest path names e2erestricted.test.lamaste.local  
✅ `09:05:37` Panel startup rewrote the vhost: X-Original-URL names e2erestricted.test.lamaste.local  
✅ `09:05:37` Panel startup rewrote the vhost: Host names e2erestricted.test.lamaste.local  
✅ `09:05:37` The rewritten vhost names no client Host header  
✅ `09:05:38` Rewritten vhost: the grantee gets in again  
✅ `09:05:39` Control: the grantee's request line for e2erestricted.test.lamaste.local with Host e2ehostconfusion.test.lamaste.local is served  
✅ `09:05:39` Outsider with Host e2ehostconfusion.test.lamaste.local is denied this tunnel (403)  
✅ `09:05:39` Outsider with another tunnel's Host does not see tunnel content  
✅ `09:05:39` Anonymous request is sent to the login portal  
✅ `09:05:39` Login redirect returns to e2erestricted.test.lamaste.local, not the Host header  

## Step 9: Revoke testuser's grant → previously-allowed user 403

✅ `09:05:51` Revoked grant blocks the previously-allowed user (403)  
✅ `09:05:52` Previously-allowed user no longer receives tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `34` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `34` |

ℹ️ `09:05:52` Cleaning up test resources...  
