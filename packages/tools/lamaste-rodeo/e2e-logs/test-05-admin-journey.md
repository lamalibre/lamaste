# Lamaste E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-11-10 17:43:05 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `17:43:06` Panel via IP:9292 returns HTTP 200  
✅ `17:43:06` Panel via IP:9292 contains React mount point  
✅ `17:43:06` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `17:43:06` Panel via panel.test.lamaste.local returns HTTP 200  
✅ `17:43:06` Panel via panel.test.lamaste.local contains React mount point  
✅ `17:43:06` Panel via panel.test.lamaste.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `17:43:06` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `17:43:06` GET /api/health returns status: ok  
✅ `17:43:07` GET /api/system/stats has cpu field  
✅ `17:43:07` GET /api/system/stats has memory field  
✅ `17:43:07` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `17:43:07` GET /api/tunnels returns tunnels array  
ℹ️ `17:43:07` Tunnels before create: 0  
✅ `17:43:08` POST /api/tunnels create returned ok: true  
✅ `17:43:08` Created tunnel has an ID  
✅ `17:43:08` Created tunnel is owned by test-agent  
ℹ️ `17:43:08` Created tunnel ID: 021d78c2-40a0-4408-9bb8-302bd0ea506e  
✅ `17:43:08` New tunnel appears in tunnel list  
✅ `17:43:09` PATCH /api/tunnels/:id disable returned ok: true  
✅ `17:43:09` Tunnel shows as disabled after PATCH  
✅ `17:43:10` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `17:43:10` Tunnel shows as enabled after re-enable PATCH  
✅ `17:43:11` DELETE /api/tunnels/:id returned ok: true  
✅ `17:43:11` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `17:43:12` GET /api/users returns users array  
✅ `17:43:12` Users list contains at least one user (count: 2)  
✅ `17:43:12` POST /api/users create returned ok: true  
✅ `17:43:12` New user appears in users list  
✅ `17:43:12` PUT /api/users/:username update returned ok: true  
✅ `17:43:13` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `17:43:13` TOTP otpauth URI has correct scheme  
✅ `17:43:13` DELETE /api/users/:username returned ok: true  
✅ `17:43:13` User no longer appears after DELETE  

## 7. Service management via panel

✅ `17:43:13` GET /api/services returns services array  
✅ `17:43:13` Service 'nginx' is listed  
✅ `17:43:13` Service 'chisel' is listed  
✅ `17:43:13` Service 'authelia' is listed  
✅ `17:43:13` Service 'lamalibre-lamaste-serverd' is listed  

## 8. Certificate management

✅ `17:43:14` GET /api/certs returns certificate info  
ℹ️ `17:43:14` Certs response keys: certs  

## 9. Cleanup

ℹ️ `17:43:14` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `37` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `37` |

ℹ️ `17:43:14` Cleaning up test resources...  
