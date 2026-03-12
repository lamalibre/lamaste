# Portlama E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-03-16 17:23:14 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `17:23:14` Panel via IP:9292 returns HTTP 200  
✅ `17:23:14` Panel via IP:9292 contains React mount point  
✅ `17:23:14` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `17:23:14` Panel via panel.test.portlama.local returns HTTP 200  
✅ `17:23:14` Panel via panel.test.portlama.local contains React mount point  
✅ `17:23:14` Panel via panel.test.portlama.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `17:23:14` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `17:23:15` GET /api/health returns status: ok  
✅ `17:23:15` GET /api/system/stats has cpu field  
✅ `17:23:15` GET /api/system/stats has memory field  
✅ `17:23:15` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `17:23:15` GET /api/tunnels returns tunnels array  
ℹ️ `17:23:15` Tunnels before create: 0  
✅ `17:23:17` POST /api/tunnels create returned ok: true  
✅ `17:23:17` Created tunnel has an ID  
ℹ️ `17:23:17` Created tunnel ID: 8c358c4b-d56e-4bbb-a611-ca0399e54e83  
✅ `17:23:17` New tunnel appears in tunnel list  
✅ `17:23:20` PATCH /api/tunnels/:id disable returned ok: true  
✅ `17:23:20` Tunnel shows as disabled after PATCH  
✅ `17:23:22` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `17:23:22` Tunnel shows as enabled after re-enable PATCH  
✅ `17:23:25` DELETE /api/tunnels/:id returned ok: true  
✅ `17:23:25` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `17:23:25` GET /api/users returns users array  
✅ `17:23:25` Users list contains at least one user (count: 2)  
✅ `17:23:27` POST /api/users create returned ok: true  
✅ `17:23:28` New user appears in users list  
✅ `17:23:30` PUT /api/users/:username update returned ok: true  
✅ `17:23:30` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `17:23:30` TOTP otpauth URI has correct scheme  
✅ `17:23:32` DELETE /api/users/:username returned ok: true  
✅ `17:23:32` User no longer appears after DELETE  

## 7. Service management via panel

✅ `17:23:32` GET /api/services returns services array  
✅ `17:23:32` Service 'nginx' is listed  
✅ `17:23:32` Service 'chisel' is listed  
✅ `17:23:32` Service 'authelia' is listed  
✅ `17:23:32` Service 'portlama-panel' is listed  

## 8. Certificate management

✅ `17:23:32` GET /api/certs returns certificate info  
ℹ️ `17:23:32` Certs response keys: certs  

## 9. Cleanup

ℹ️ `17:23:32` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `36` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `36` |

ℹ️ `17:23:32` Cleaning up test resources...  
🔵 `17:23:33` **Running: 06-tunnel-user-journey.sh**  
