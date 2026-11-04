# Lamaste E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-11-04 13:30:35 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `13:30:35` Panel via IP:9292 returns HTTP 200  
✅ `13:30:35` Panel via IP:9292 contains React mount point  
✅ `13:30:35` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `13:30:35` Panel via panel.test.lamaste.local returns HTTP 200  
✅ `13:30:35` Panel via panel.test.lamaste.local contains React mount point  
✅ `13:30:36` Panel via panel.test.lamaste.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `13:30:36` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `13:30:36` GET /api/health returns status: ok  
✅ `13:30:37` GET /api/system/stats has cpu field  
✅ `13:30:37` GET /api/system/stats has memory field  
✅ `13:30:37` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `13:30:37` GET /api/tunnels returns tunnels array  
ℹ️ `13:30:37` Tunnels before create: 0  
✅ `13:30:38` POST /api/tunnels create returned ok: true  
✅ `13:30:38` Created tunnel has an ID  
✅ `13:30:38` Created tunnel is owned by test-agent  
ℹ️ `13:30:38` Created tunnel ID: 571deb44-5280-4d0b-bc95-3428b04196c8  
✅ `13:30:38` New tunnel appears in tunnel list  
✅ `13:30:38` PATCH /api/tunnels/:id disable returned ok: true  
✅ `13:30:38` Tunnel shows as disabled after PATCH  
✅ `13:30:38` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `13:30:38` Tunnel shows as enabled after re-enable PATCH  
✅ `13:30:39` DELETE /api/tunnels/:id returned ok: true  
✅ `13:30:39` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `13:30:39` GET /api/users returns users array  
✅ `13:30:39` Users list contains at least one user (count: 2)  
✅ `13:30:40` POST /api/users create returned ok: true  
✅ `13:30:40` New user appears in users list  
✅ `13:30:40` PUT /api/users/:username update returned ok: true  
✅ `13:30:40` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `13:30:40` TOTP otpauth URI has correct scheme  
✅ `13:30:40` DELETE /api/users/:username returned ok: true  
✅ `13:30:41` User no longer appears after DELETE  

## 7. Service management via panel

✅ `13:30:41` GET /api/services returns services array  
✅ `13:30:41` Service 'nginx' is listed  
✅ `13:30:41` Service 'chisel' is listed  
✅ `13:30:41` Service 'authelia' is listed  
✅ `13:30:41` Service 'lamalibre-lamaste-serverd' is listed  

## 8. Certificate management

✅ `13:30:41` GET /api/certs returns certificate info  
ℹ️ `13:30:41` Certs response keys: certs  

## 9. Cleanup

ℹ️ `13:30:41` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `37` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `37` |

ℹ️ `13:30:41` Cleaning up test resources...  
