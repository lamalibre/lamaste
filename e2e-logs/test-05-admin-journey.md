# Portlama E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-03-20 14:35:31 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `14:35:32` Panel via IP:9292 returns HTTP 200  
✅ `14:35:32` Panel via IP:9292 contains React mount point  
✅ `14:35:32` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `14:35:32` Panel via panel.test.portlama.local returns HTTP 200  
✅ `14:35:32` Panel via panel.test.portlama.local contains React mount point  
✅ `14:35:32` Panel via panel.test.portlama.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `14:35:32` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `14:35:32` GET /api/health returns status: ok  
✅ `14:35:32` GET /api/system/stats has cpu field  
✅ `14:35:32` GET /api/system/stats has memory field  
✅ `14:35:32` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `14:35:32` GET /api/tunnels returns tunnels array  
ℹ️ `14:35:32` Tunnels before create: 0  
✅ `14:35:35` POST /api/tunnels create returned ok: true  
✅ `14:35:35` Created tunnel has an ID  
ℹ️ `14:35:35` Created tunnel ID: ca1f2ffe-de87-41e2-acb2-32a07bc1db6a  
✅ `14:35:35` New tunnel appears in tunnel list  
✅ `14:35:38` PATCH /api/tunnels/:id disable returned ok: true  
✅ `14:35:38` Tunnel shows as disabled after PATCH  
✅ `14:35:40` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `14:35:40` Tunnel shows as enabled after re-enable PATCH  
✅ `14:35:43` DELETE /api/tunnels/:id returned ok: true  
✅ `14:35:43` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `14:35:43` GET /api/users returns users array  
✅ `14:35:43` Users list contains at least one user (count: 2)  
✅ `14:35:46` POST /api/users create returned ok: true  
✅ `14:35:46` New user appears in users list  
✅ `14:35:48` PUT /api/users/:username update returned ok: true  
✅ `14:35:48` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `14:35:48` TOTP otpauth URI has correct scheme  
✅ `14:35:50` DELETE /api/users/:username returned ok: true  
✅ `14:35:50` User no longer appears after DELETE  

## 7. Service management via panel

✅ `14:35:51` GET /api/services returns services array  
✅ `14:35:51` Service 'nginx' is listed  
✅ `14:35:51` Service 'chisel' is listed  
✅ `14:35:51` Service 'authelia' is listed  
✅ `14:35:51` Service 'portlama-panel' is listed  

## 8. Certificate management

✅ `14:35:51` GET /api/certs returns certificate info  
ℹ️ `14:35:51` Certs response keys: certs  

## 9. Cleanup

ℹ️ `14:35:51` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `36` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `36` |

ℹ️ `14:35:51` Cleaning up test resources...  
🔵 `14:35:51` **Running: 06-tunnel-user-journey.sh**  
