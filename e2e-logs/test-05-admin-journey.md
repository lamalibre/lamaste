# Portlama E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-03-23 12:11:07 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `12:11:07` Panel via IP:9292 returns HTTP 200  
✅ `12:11:07` Panel via IP:9292 contains React mount point  
✅ `12:11:07` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `12:11:08` Panel via panel.test.portlama.local returns HTTP 200  
✅ `12:11:08` Panel via panel.test.portlama.local contains React mount point  
✅ `12:11:08` Panel via panel.test.portlama.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `12:11:08` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `12:11:08` GET /api/health returns status: ok  
✅ `12:11:08` GET /api/system/stats has cpu field  
✅ `12:11:08` GET /api/system/stats has memory field  
✅ `12:11:08` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `12:11:08` GET /api/tunnels returns tunnels array  
ℹ️ `12:11:08` Tunnels before create: 0  
✅ `12:11:11` POST /api/tunnels create returned ok: true  
✅ `12:11:11` Created tunnel has an ID  
ℹ️ `12:11:11` Created tunnel ID: b30c8b79-03de-4634-9d40-c156d0468f11  
✅ `12:11:11` New tunnel appears in tunnel list  
✅ `12:11:14` PATCH /api/tunnels/:id disable returned ok: true  
✅ `12:11:14` Tunnel shows as disabled after PATCH  
✅ `12:11:16` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `12:11:16` Tunnel shows as enabled after re-enable PATCH  
✅ `12:11:19` DELETE /api/tunnels/:id returned ok: true  
✅ `12:11:19` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `12:11:19` GET /api/users returns users array  
✅ `12:11:19` Users list contains at least one user (count: 2)  
✅ `12:11:22` POST /api/users create returned ok: true  
✅ `12:11:22` New user appears in users list  
✅ `12:11:24` PUT /api/users/:username update returned ok: true  
✅ `12:11:24` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `12:11:25` TOTP otpauth URI has correct scheme  
✅ `12:11:27` DELETE /api/users/:username returned ok: true  
✅ `12:11:27` User no longer appears after DELETE  

## 7. Service management via panel

✅ `12:11:27` GET /api/services returns services array  
✅ `12:11:27` Service 'nginx' is listed  
✅ `12:11:27` Service 'chisel' is listed  
✅ `12:11:27` Service 'authelia' is listed  
✅ `12:11:27` Service 'portlama-panel' is listed  

## 8. Certificate management

✅ `12:11:27` GET /api/certs returns certificate info  
ℹ️ `12:11:27` Certs response keys: certs  

## 9. Cleanup

ℹ️ `12:11:27` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `36` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `36` |

ℹ️ `12:11:27` Cleaning up test resources...  
🔵 `12:11:28` **Running: 06-tunnel-user-journey.sh**  
