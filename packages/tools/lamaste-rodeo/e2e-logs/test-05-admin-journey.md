# Lamaste E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-11-03 09:26:04 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `09:26:04` Panel via IP:9292 returns HTTP 200  
✅ `09:26:04` Panel via IP:9292 contains React mount point  
✅ `09:26:04` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `09:26:04` Panel via panel.test.lamaste.local returns HTTP 200  
✅ `09:26:04` Panel via panel.test.lamaste.local contains React mount point  
✅ `09:26:04` Panel via panel.test.lamaste.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `09:26:04` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `09:26:04` GET /api/health returns status: ok  
✅ `09:26:05` GET /api/system/stats has cpu field  
✅ `09:26:05` GET /api/system/stats has memory field  
✅ `09:26:05` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `09:26:05` GET /api/tunnels returns tunnels array  
ℹ️ `09:26:05` Tunnels before create: 0  
✅ `09:26:06` POST /api/tunnels create returned ok: true  
✅ `09:26:06` Created tunnel has an ID  
✅ `09:26:06` Created tunnel is owned by test-agent  
ℹ️ `09:26:06` Created tunnel ID: c5cce032-08a3-488f-af0f-a1aa92c9d066  
✅ `09:26:06` New tunnel appears in tunnel list  
✅ `09:26:06` PATCH /api/tunnels/:id disable returned ok: true  
✅ `09:26:06` Tunnel shows as disabled after PATCH  
✅ `09:26:07` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `09:26:07` Tunnel shows as enabled after re-enable PATCH  
✅ `09:26:07` DELETE /api/tunnels/:id returned ok: true  
✅ `09:26:07` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `09:26:07` GET /api/users returns users array  
✅ `09:26:07` Users list contains at least one user (count: 2)  
✅ `09:26:08` POST /api/users create returned ok: true  
✅ `09:26:08` New user appears in users list  
✅ `09:26:08` PUT /api/users/:username update returned ok: true  
✅ `09:26:08` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `09:26:08` TOTP otpauth URI has correct scheme  
✅ `09:26:08` DELETE /api/users/:username returned ok: true  
✅ `09:26:08` User no longer appears after DELETE  

## 7. Service management via panel

✅ `09:26:09` GET /api/services returns services array  
✅ `09:26:09` Service 'nginx' is listed  
✅ `09:26:09` Service 'chisel' is listed  
✅ `09:26:09` Service 'authelia' is listed  
✅ `09:26:09` Service 'lamalibre-lamaste-serverd' is listed  

## 8. Certificate management

✅ `09:26:09` GET /api/certs returns certificate info  
ℹ️ `09:26:09` Certs response keys: certs  

## 9. Cleanup

ℹ️ `09:26:09` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `37` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `37` |

ℹ️ `09:26:09` Cleaning up test resources...  
