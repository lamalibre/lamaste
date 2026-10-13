# Lamaste E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-10-13 11:45:04 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `11:45:04` Panel via IP:9292 returns HTTP 200  
✅ `11:45:04` Panel via IP:9292 contains React mount point  
✅ `11:45:04` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `11:45:05` Panel via panel.test.lamaste.local returns HTTP 200  
✅ `11:45:05` Panel via panel.test.lamaste.local contains React mount point  
✅ `11:45:05` Panel via panel.test.lamaste.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `11:45:05` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `11:45:05` GET /api/health returns status: ok  
✅ `11:45:06` GET /api/system/stats has cpu field  
✅ `11:45:06` GET /api/system/stats has memory field  
✅ `11:45:06` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `11:45:06` GET /api/tunnels returns tunnels array  
ℹ️ `11:45:06` Tunnels before create: 0  
✅ `11:45:06` POST /api/tunnels create returned ok: true  
✅ `11:45:06` Created tunnel has an ID  
✅ `11:45:06` Created tunnel is owned by test-agent  
ℹ️ `11:45:06` Created tunnel ID: ea379fb7-5f15-4e54-a909-5ad4db0697e0  
✅ `11:45:06` New tunnel appears in tunnel list  
✅ `11:45:07` PATCH /api/tunnels/:id disable returned ok: true  
✅ `11:45:07` Tunnel shows as disabled after PATCH  
✅ `11:45:07` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `11:45:07` Tunnel shows as enabled after re-enable PATCH  
✅ `11:45:07` DELETE /api/tunnels/:id returned ok: true  
✅ `11:45:07` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `11:45:07` GET /api/users returns users array  
✅ `11:45:07` Users list contains at least one user (count: 2)  
✅ `11:45:10` POST /api/users create returned ok: true  
✅ `11:45:10` New user appears in users list  
✅ `11:45:12` PUT /api/users/:username update returned ok: true  
✅ `11:45:12` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `11:45:12` TOTP otpauth URI has correct scheme  
✅ `11:45:15` DELETE /api/users/:username returned ok: true  
✅ `11:45:15` User no longer appears after DELETE  

## 7. Service management via panel

✅ `11:45:15` GET /api/services returns services array  
✅ `11:45:15` Service 'nginx' is listed  
✅ `11:45:15` Service 'chisel' is listed  
✅ `11:45:15` Service 'authelia' is listed  
✅ `11:45:15` Service 'lamalibre-lamaste-serverd' is listed  

## 8. Certificate management

✅ `11:45:15` GET /api/certs returns certificate info  
ℹ️ `11:45:15` Certs response keys: certs  

## 9. Cleanup

ℹ️ `11:45:15` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `37` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `37` |

ℹ️ `11:45:15` Cleaning up test resources...  
