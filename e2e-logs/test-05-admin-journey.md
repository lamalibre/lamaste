# Lamaste E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-03-30 13:10:08 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `13:10:08` Panel via IP:9292 returns HTTP 200  
✅ `13:10:08` Panel via IP:9292 contains React mount point  
✅ `13:10:08` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `13:10:09` Panel via panel.test.lamaste.local returns HTTP 200  
✅ `13:10:09` Panel via panel.test.lamaste.local contains React mount point  
✅ `13:10:09` Panel via panel.test.lamaste.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `13:10:09` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `13:10:09` GET /api/health returns status: ok  
✅ `13:10:09` GET /api/system/stats has cpu field  
✅ `13:10:09` GET /api/system/stats has memory field  
✅ `13:10:09` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `13:10:09` GET /api/tunnels returns tunnels array  
ℹ️ `13:10:09` Tunnels before create: 0  
✅ `13:10:12` POST /api/tunnels create returned ok: true  
✅ `13:10:12` Created tunnel has an ID  
ℹ️ `13:10:12` Created tunnel ID: fd6e9150-ca7f-4800-8f57-006c94c4ca34  
✅ `13:10:12` New tunnel appears in tunnel list  
✅ `13:10:14` PATCH /api/tunnels/:id disable returned ok: true  
✅ `13:10:15` Tunnel shows as disabled after PATCH  
✅ `13:10:17` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `13:10:17` Tunnel shows as enabled after re-enable PATCH  
✅ `13:10:19` DELETE /api/tunnels/:id returned ok: true  
✅ `13:10:19` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `13:10:20` GET /api/users returns users array  
✅ `13:10:20` Users list contains at least one user (count: 2)  
✅ `13:10:22` POST /api/users create returned ok: true  
✅ `13:10:22` New user appears in users list  
✅ `13:10:24` PUT /api/users/:username update returned ok: true  
✅ `13:10:25` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `13:10:25` TOTP otpauth URI has correct scheme  
✅ `13:10:27` DELETE /api/users/:username returned ok: true  
✅ `13:10:27` User no longer appears after DELETE  

## 7. Service management via panel

✅ `13:10:27` GET /api/services returns services array  
✅ `13:10:27` Service 'nginx' is listed  
✅ `13:10:27` Service 'chisel' is listed  
✅ `13:10:27` Service 'authelia' is listed  
✅ `13:10:27` Service 'lamaste-panel' is listed  

## 8. Certificate management

✅ `13:10:27` GET /api/certs returns certificate info  
ℹ️ `13:10:27` Certs response keys: certs  

## 9. Cleanup

ℹ️ `13:10:27` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `36` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `36` |

ℹ️ `13:10:27` Cleaning up test resources...  
🔵 `13:10:27` **Running: 06-tunnel-user-journey.sh**  
