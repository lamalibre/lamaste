# Lamaste E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-11-02 15:46:04 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `15:46:05` Panel via IP:9292 returns HTTP 200  
✅ `15:46:05` Panel via IP:9292 contains React mount point  
✅ `15:46:05` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `15:46:05` Panel via panel.test.lamaste.local returns HTTP 200  
✅ `15:46:05` Panel via panel.test.lamaste.local contains React mount point  
✅ `15:46:05` Panel via panel.test.lamaste.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `15:46:05` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `15:46:05` GET /api/health returns status: ok  
✅ `15:46:06` GET /api/system/stats has cpu field  
✅ `15:46:06` GET /api/system/stats has memory field  
✅ `15:46:06` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `15:46:06` GET /api/tunnels returns tunnels array  
ℹ️ `15:46:06` Tunnels before create: 0  
✅ `15:46:07` POST /api/tunnels create returned ok: true  
✅ `15:46:07` Created tunnel has an ID  
✅ `15:46:07` Created tunnel is owned by test-agent  
ℹ️ `15:46:07` Created tunnel ID: 6c02bf82-9e0d-426a-8deb-6719994cf0f1  
✅ `15:46:07` New tunnel appears in tunnel list  
✅ `15:46:07` PATCH /api/tunnels/:id disable returned ok: true  
✅ `15:46:07` Tunnel shows as disabled after PATCH  
✅ `15:46:07` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `15:46:08` Tunnel shows as enabled after re-enable PATCH  
✅ `15:46:08` DELETE /api/tunnels/:id returned ok: true  
✅ `15:46:08` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `15:46:08` GET /api/users returns users array  
✅ `15:46:08` Users list contains at least one user (count: 2)  
✅ `15:46:08` POST /api/users create returned ok: true  
✅ `15:46:09` New user appears in users list  
✅ `15:46:09` PUT /api/users/:username update returned ok: true  
✅ `15:46:09` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `15:46:09` TOTP otpauth URI has correct scheme  
✅ `15:46:09` DELETE /api/users/:username returned ok: true  
✅ `15:46:09` User no longer appears after DELETE  

## 7. Service management via panel

✅ `15:46:09` GET /api/services returns services array  
✅ `15:46:09` Service 'nginx' is listed  
✅ `15:46:09` Service 'chisel' is listed  
✅ `15:46:09` Service 'authelia' is listed  
✅ `15:46:09` Service 'lamalibre-lamaste-serverd' is listed  

## 8. Certificate management

✅ `15:46:10` GET /api/certs returns certificate info  
ℹ️ `15:46:10` Certs response keys: certs  

## 9. Cleanup

ℹ️ `15:46:10` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `37` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `37` |

ℹ️ `15:46:10` Cleaning up test resources...  
