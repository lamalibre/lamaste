# Portlama E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-03-26 10:49:19 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `10:49:19` Panel via IP:9292 returns HTTP 200  
✅ `10:49:19` Panel via IP:9292 contains React mount point  
✅ `10:49:19` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `10:49:19` Panel via panel.test.portlama.local returns HTTP 200  
✅ `10:49:19` Panel via panel.test.portlama.local contains React mount point  
✅ `10:49:19` Panel via panel.test.portlama.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `10:49:19` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `10:49:19` GET /api/health returns status: ok  
✅ `10:49:20` GET /api/system/stats has cpu field  
✅ `10:49:20` GET /api/system/stats has memory field  
✅ `10:49:20` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `10:49:20` GET /api/tunnels returns tunnels array  
ℹ️ `10:49:20` Tunnels before create: 0  
✅ `10:49:22` POST /api/tunnels create returned ok: true  
✅ `10:49:22` Created tunnel has an ID  
ℹ️ `10:49:22` Created tunnel ID: 56de8e07-3f19-420d-b898-c5520c400733  
✅ `10:49:23` New tunnel appears in tunnel list  
✅ `10:49:25` PATCH /api/tunnels/:id disable returned ok: true  
✅ `10:49:25` Tunnel shows as disabled after PATCH  
✅ `10:49:27` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `10:49:27` Tunnel shows as enabled after re-enable PATCH  
✅ `10:49:30` DELETE /api/tunnels/:id returned ok: true  
✅ `10:49:30` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `10:49:30` GET /api/users returns users array  
✅ `10:49:30` Users list contains at least one user (count: 2)  
✅ `10:49:32` POST /api/users create returned ok: true  
✅ `10:49:33` New user appears in users list  
✅ `10:49:35` PUT /api/users/:username update returned ok: true  
✅ `10:49:35` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `10:49:35` TOTP otpauth URI has correct scheme  
✅ `10:49:37` DELETE /api/users/:username returned ok: true  
✅ `10:49:37` User no longer appears after DELETE  

## 7. Service management via panel

✅ `10:49:37` GET /api/services returns services array  
✅ `10:49:37` Service 'nginx' is listed  
✅ `10:49:37` Service 'chisel' is listed  
✅ `10:49:37` Service 'authelia' is listed  
✅ `10:49:37` Service 'portlama-panel' is listed  

## 8. Certificate management

✅ `10:49:38` GET /api/certs returns certificate info  
ℹ️ `10:49:38` Certs response keys: certs  

## 9. Cleanup

ℹ️ `10:49:38` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `36` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `36` |

ℹ️ `10:49:38` Cleaning up test resources...  
🔵 `10:49:38` **Running: 06-tunnel-user-journey.sh**  
