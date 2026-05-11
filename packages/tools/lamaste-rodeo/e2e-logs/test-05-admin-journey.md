# Lamaste E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-04-30 08:57:38 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `08:57:39` Panel via IP:9292 returns HTTP 200  
✅ `08:57:39` Panel via IP:9292 contains React mount point  
✅ `08:57:39` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `08:57:39` Panel via panel.test.lamaste.local returns HTTP 200  
✅ `08:57:39` Panel via panel.test.lamaste.local contains React mount point  
✅ `08:57:39` Panel via panel.test.lamaste.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `08:57:39` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `08:57:39` GET /api/health returns status: ok  
✅ `08:57:39` GET /api/system/stats has cpu field  
✅ `08:57:39` GET /api/system/stats has memory field  
✅ `08:57:39` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `08:57:39` GET /api/tunnels returns tunnels array  
ℹ️ `08:57:39` Tunnels before create: 0  
✅ `08:57:42` POST /api/tunnels create returned ok: true  
✅ `08:57:42` Created tunnel has an ID  
ℹ️ `08:57:42` Created tunnel ID: 22d0b84c-81e8-4362-acf6-b1d540f06c39  
✅ `08:57:42` New tunnel appears in tunnel list  
✅ `08:57:45` PATCH /api/tunnels/:id disable returned ok: true  
✅ `08:57:45` Tunnel shows as disabled after PATCH  
✅ `08:57:47` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `08:57:47` Tunnel shows as enabled after re-enable PATCH  
✅ `08:57:50` DELETE /api/tunnels/:id returned ok: true  
✅ `08:57:50` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `08:57:50` GET /api/users returns users array  
✅ `08:57:50` Users list contains at least one user (count: 2)  
✅ `08:57:52` POST /api/users create returned ok: true  
✅ `08:57:52` New user appears in users list  
✅ `08:57:55` PUT /api/users/:username update returned ok: true  
✅ `08:57:55` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `08:57:55` TOTP otpauth URI has correct scheme  
✅ `08:57:57` DELETE /api/users/:username returned ok: true  
✅ `08:57:57` User no longer appears after DELETE  

## 7. Service management via panel

✅ `08:57:57` GET /api/services returns services array  
✅ `08:57:57` Service 'nginx' is listed  
✅ `08:57:57` Service 'chisel' is listed  
✅ `08:57:57` Service 'authelia' is listed  
✅ `08:57:57` Service 'lamalibre-lamaste-serverd' is listed  

## 8. Certificate management

✅ `08:57:58` GET /api/certs returns certificate info  
ℹ️ `08:57:58` Certs response keys: certs  

## 9. Cleanup

ℹ️ `08:57:58` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `36` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `36` |

ℹ️ `08:57:58` Cleaning up test resources...  
