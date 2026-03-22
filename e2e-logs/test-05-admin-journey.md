# Portlama E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-03-22 18:26:37 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `18:26:38` Panel via IP:9292 returns HTTP 200  
✅ `18:26:38` Panel via IP:9292 contains React mount point  
✅ `18:26:38` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `18:26:38` Panel via panel.test.portlama.local returns HTTP 200  
✅ `18:26:38` Panel via panel.test.portlama.local contains React mount point  
✅ `18:26:38` Panel via panel.test.portlama.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `18:26:38` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `18:26:38` GET /api/health returns status: ok  
✅ `18:26:39` GET /api/system/stats has cpu field  
✅ `18:26:39` GET /api/system/stats has memory field  
✅ `18:26:39` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `18:26:40` GET /api/tunnels returns tunnels array  
ℹ️ `18:26:40` Tunnels before create: 0  
✅ `18:26:43` POST /api/tunnels create returned ok: true  
✅ `18:26:43` Created tunnel has an ID  
ℹ️ `18:26:43` Created tunnel ID: 3a3cb327-9ca5-4290-96eb-68f60754d862  
✅ `18:26:44` New tunnel appears in tunnel list  
✅ `18:26:47` PATCH /api/tunnels/:id disable returned ok: true  
✅ `18:26:47` Tunnel shows as disabled after PATCH  
✅ `18:26:49` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `18:26:49` Tunnel shows as enabled after re-enable PATCH  
✅ `18:26:52` DELETE /api/tunnels/:id returned ok: true  
✅ `18:26:52` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `18:26:52` GET /api/users returns users array  
✅ `18:26:52` Users list contains at least one user (count: 2)  
✅ `18:26:55` POST /api/users create returned ok: true  
✅ `18:26:55` New user appears in users list  
✅ `18:26:58` PUT /api/users/:username update returned ok: true  
✅ `18:26:58` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `18:26:58` TOTP otpauth URI has correct scheme  
✅ `18:27:00` DELETE /api/users/:username returned ok: true  
✅ `18:27:00` User no longer appears after DELETE  

## 7. Service management via panel

✅ `18:27:00` GET /api/services returns services array  
✅ `18:27:00` Service 'nginx' is listed  
✅ `18:27:00` Service 'chisel' is listed  
✅ `18:27:00` Service 'authelia' is listed  
✅ `18:27:00` Service 'portlama-panel' is listed  

## 8. Certificate management

✅ `18:27:01` GET /api/certs returns certificate info  
ℹ️ `18:27:01` Certs response keys: certs  

## 9. Cleanup

ℹ️ `18:27:01` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `36` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `36` |

ℹ️ `18:27:01` Cleaning up test resources...  
🔵 `18:27:02` **Running: 06-tunnel-user-journey.sh**  
