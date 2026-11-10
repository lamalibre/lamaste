# Lamaste E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-11-10 13:00:05 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `13:00:06` Panel via IP:9292 returns HTTP 200  
✅ `13:00:06` Panel via IP:9292 contains React mount point  
✅ `13:00:06` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `13:00:06` Panel via panel.test.lamaste.local returns HTTP 200  
✅ `13:00:06` Panel via panel.test.lamaste.local contains React mount point  
✅ `13:00:06` Panel via panel.test.lamaste.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `13:00:06` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `13:00:06` GET /api/health returns status: ok  
✅ `13:00:07` GET /api/system/stats has cpu field  
✅ `13:00:07` GET /api/system/stats has memory field  
✅ `13:00:07` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `13:00:07` GET /api/tunnels returns tunnels array  
ℹ️ `13:00:07` Tunnels before create: 0  
✅ `13:00:08` POST /api/tunnels create returned ok: true  
✅ `13:00:08` Created tunnel has an ID  
✅ `13:00:08` Created tunnel is owned by test-agent  
ℹ️ `13:00:08` Created tunnel ID: 7b03cc94-d862-4d5e-9694-b4996c35658a  
✅ `13:00:08` New tunnel appears in tunnel list  
✅ `13:00:09` PATCH /api/tunnels/:id disable returned ok: true  
✅ `13:00:09` Tunnel shows as disabled after PATCH  
✅ `13:00:09` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `13:00:09` Tunnel shows as enabled after re-enable PATCH  
✅ `13:00:10` DELETE /api/tunnels/:id returned ok: true  
✅ `13:00:10` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `13:00:10` GET /api/users returns users array  
✅ `13:00:10` Users list contains at least one user (count: 2)  
✅ `13:00:11` POST /api/users create returned ok: true  
✅ `13:00:11` New user appears in users list  
✅ `13:00:11` PUT /api/users/:username update returned ok: true  
✅ `13:00:11` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `13:00:11` TOTP otpauth URI has correct scheme  
✅ `13:00:12` DELETE /api/users/:username returned ok: true  
✅ `13:00:12` User no longer appears after DELETE  

## 7. Service management via panel

✅ `13:00:12` GET /api/services returns services array  
✅ `13:00:12` Service 'nginx' is listed  
✅ `13:00:12` Service 'chisel' is listed  
✅ `13:00:12` Service 'authelia' is listed  
✅ `13:00:12` Service 'lamalibre-lamaste-serverd' is listed  

## 8. Certificate management

✅ `13:00:13` GET /api/certs returns certificate info  
ℹ️ `13:00:13` Certs response keys: certs  

## 9. Cleanup

ℹ️ `13:00:13` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `37` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `37` |

ℹ️ `13:00:13` Cleaning up test resources...  
