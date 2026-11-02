# Lamaste E2E: 22 — Restricted Tunnel + Per-User Grant (Three-VM)

> Started at `2026-11-02 15:51:50 UTC`


## Pre-flight

✅ `15:51:50` Onboarding is complete  

## Step 1: Create tunnel using the default accessMode

✅ `15:51:52` Tunnel creation returned ok: true  
✅ `15:51:52` Tunnel has an ID  
✅ `15:51:52` Tunnel is owned by test-agent  
✅ `15:51:52` Default accessMode is 'restricted' (security posture)  
ℹ️ `15:51:52` Created restricted tunnel: e2erestricted.test.lamaste.local (ID: a64b01f1-09ae-4353-b334-ee34f9ad4c0d)  
✅ `15:51:53` Second tunnel e2ehostconfusion.test.lamaste.local is 'authenticated' (any Authelia user)  

## Step 2: Wire up host entries and start a marker HTTP server

✅ `15:51:55` Marker HTTP server running on agent at port 18090  

## Step 3: Create a second Authelia user without a grant

✅ `15:52:02` Created second Authelia user (e2eoutsider) for no-grant case  

## Step 4: Authenticate as testuser (will have the grant)

✅ `15:52:03` TOTP reset returned otpauth URI for testuser  
✅ `15:52:33` testuser first factor OK  
✅ `15:52:33` testuser TOTP OK  

## Step 5: testuser WITHOUT a grant is denied (403)

✅ `15:52:33` Restricted tunnel denies authenticated user without grant (403)  

## Step 6: Admin creates a grant for testuser

✅ `15:52:33` Grant created (19d1b828-c7c4-4457-994b-a959cfa87be8)  

## Step 7: testuser WITH a grant is allowed (200 + marker)

✅ `15:52:34` Grantee receives tunnel marker content  
✅ `15:52:34` Grantee reaches tunnel (HTTP 200)  

## Step 8: Outsider authenticates but has no grant → 403

✅ `15:53:02` outsider first factor OK  
✅ `15:53:02` outsider TOTP OK  
✅ `15:53:02` Outsider authenticated but ungranted receives 403  
✅ `15:53:02` Outsider does not see tunnel content (restricted mode holds)  

## Step 8b: Another tunnel's Host header does not open this tunnel

✅ `15:53:03` Restricted tunnel vhost set back to the old form  
✅ `15:53:04` A vhost written the old way closes its tunnel (grantee gets 403)  
✅ `15:53:04` Old vhost: the outsider does not get in with Host e2ehostconfusion.test.lamaste.local  
✅ `15:53:07` Panel startup rewrote the vhost: the subrequest path names e2erestricted.test.lamaste.local  
✅ `15:53:07` Panel startup rewrote the vhost: X-Original-URL names e2erestricted.test.lamaste.local  
✅ `15:53:07` Panel startup rewrote the vhost: Host names e2erestricted.test.lamaste.local  
✅ `15:53:07` The rewritten vhost names no client Host header  
✅ `15:53:08` Rewritten vhost: the grantee gets in again  
✅ `15:53:08` Control: the grantee's request line for e2erestricted.test.lamaste.local with Host e2ehostconfusion.test.lamaste.local is served  
✅ `15:53:09` Outsider with Host e2ehostconfusion.test.lamaste.local is denied this tunnel (403)  
✅ `15:53:09` Outsider with another tunnel's Host does not see tunnel content  
✅ `15:53:09` Anonymous request is sent to the login portal  
✅ `15:53:09` Login redirect returns to e2erestricted.test.lamaste.local, not the Host header  

## Step 9: Revoke testuser's grant → previously-allowed user 403

✅ `15:53:21` Revoked grant blocks the previously-allowed user (403)  
✅ `15:53:21` Previously-allowed user no longer receives tunnel content  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `34` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `34` |

ℹ️ `15:53:21` Cleaning up test resources...  
