# Lamaste E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-11-09 12:38:04 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `12:38:05` Panel via IP:9292 returns HTTP 200  
✅ `12:38:05` Panel via IP:9292 contains React mount point  
✅ `12:38:05` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `12:38:05` Panel via panel.test.lamaste.local returns HTTP 200  
✅ `12:38:05` Panel via panel.test.lamaste.local contains React mount point  
✅ `12:38:05` Panel via panel.test.lamaste.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `12:38:05` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `12:38:05` GET /api/health returns status: ok  
✅ `12:38:06` GET /api/system/stats has cpu field  
✅ `12:38:06` GET /api/system/stats has memory field  
✅ `12:38:06` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `12:38:06` GET /api/tunnels returns tunnels array  
ℹ️ `12:38:06` Tunnels before create: 0  
✅ `12:38:07` POST /api/tunnels create returned ok: true  
✅ `12:38:07` Created tunnel has an ID  
✅ `12:38:07` Created tunnel is owned by test-agent  
ℹ️ `12:38:07` Created tunnel ID: a877949b-f9a7-4838-8950-1001f7f710ec  
✅ `12:38:07` New tunnel appears in tunnel list  
✅ `12:38:07` PATCH /api/tunnels/:id disable returned ok: true  
✅ `12:38:08` Tunnel shows as disabled after PATCH  
✅ `12:38:08` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `12:38:08` Tunnel shows as enabled after re-enable PATCH  
✅ `12:38:08` DELETE /api/tunnels/:id returned ok: true  
✅ `12:38:08` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `12:38:08` GET /api/users returns users array  
✅ `12:38:08` Users list contains at least one user (count: 2)  
✅ `12:38:09` POST /api/users create returned ok: true  
✅ `12:38:09` New user appears in users list  
✅ `12:38:09` PUT /api/users/:username update returned ok: true  
✅ `12:38:09` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `12:38:09` TOTP otpauth URI has correct scheme  
✅ `12:38:09` DELETE /api/users/:username returned ok: true  
✅ `12:38:10` User no longer appears after DELETE  

## 7. Service management via panel

✅ `12:38:10` GET /api/services returns services array  
✅ `12:38:10` Service 'nginx' is listed  
✅ `12:38:10` Service 'chisel' is listed  
✅ `12:38:10` Service 'authelia' is listed  
✅ `12:38:10` Service 'lamalibre-lamaste-serverd' is listed  

## 8. Certificate management

✅ `12:38:10` GET /api/certs returns certificate info  
ℹ️ `12:38:10` Certs response keys: certs  

## 9. Cleanup

ℹ️ `12:38:10` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `37` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `37` |

ℹ️ `12:38:10` Cleaning up test resources...  
