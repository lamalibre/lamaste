# Lamaste E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-11-11 08:59:05 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `08:59:06` Panel via IP:9292 returns HTTP 200  
✅ `08:59:06` Panel via IP:9292 contains React mount point  
✅ `08:59:06` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `08:59:06` Panel via panel.test.lamaste.local returns HTTP 200  
✅ `08:59:06` Panel via panel.test.lamaste.local contains React mount point  
✅ `08:59:06` Panel via panel.test.lamaste.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `08:59:06` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `08:59:06` GET /api/health returns status: ok  
✅ `08:59:07` GET /api/system/stats has cpu field  
✅ `08:59:07` GET /api/system/stats has memory field  
✅ `08:59:07` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `08:59:07` GET /api/tunnels returns tunnels array  
ℹ️ `08:59:07` Tunnels before create: 0  
✅ `08:59:08` POST /api/tunnels create returned ok: true  
✅ `08:59:08` Created tunnel has an ID  
✅ `08:59:08` Created tunnel is owned by test-agent  
ℹ️ `08:59:08` Created tunnel ID: cb1c1c5c-c3b6-4f11-bdb3-9d2fe39b3d76  
✅ `08:59:08` New tunnel appears in tunnel list  
✅ `08:59:09` PATCH /api/tunnels/:id disable returned ok: true  
✅ `08:59:09` Tunnel shows as disabled after PATCH  
✅ `08:59:10` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `08:59:10` Tunnel shows as enabled after re-enable PATCH  
✅ `08:59:11` DELETE /api/tunnels/:id returned ok: true  
✅ `08:59:11` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `08:59:11` GET /api/users returns users array  
✅ `08:59:11` Users list contains at least one user (count: 2)  
✅ `08:59:12` POST /api/users create returned ok: true  
✅ `08:59:12` New user appears in users list  
✅ `08:59:12` PUT /api/users/:username update returned ok: true  
✅ `08:59:13` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `08:59:13` TOTP otpauth URI has correct scheme  
✅ `08:59:13` DELETE /api/users/:username returned ok: true  
✅ `08:59:13` User no longer appears after DELETE  

## 7. Service management via panel

✅ `08:59:13` GET /api/services returns services array  
✅ `08:59:13` Service 'nginx' is listed  
✅ `08:59:13` Service 'chisel' is listed  
✅ `08:59:13` Service 'authelia' is listed  
✅ `08:59:13` Service 'lamalibre-lamaste-serverd' is listed  

## 8. Certificate management

✅ `08:59:14` GET /api/certs returns certificate info  
ℹ️ `08:59:14` Certs response keys: certs  

## 9. Cleanup

ℹ️ `08:59:14` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `37` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `37` |

ℹ️ `08:59:14` Cleaning up test resources...  
