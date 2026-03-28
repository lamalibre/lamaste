# Portlama E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-03-28 22:41:25 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `22:41:26` Panel via IP:9292 returns HTTP 200  
✅ `22:41:26` Panel via IP:9292 contains React mount point  
✅ `22:41:26` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `22:41:26` Panel via panel.test.portlama.local returns HTTP 200  
✅ `22:41:26` Panel via panel.test.portlama.local contains React mount point  
✅ `22:41:26` Panel via panel.test.portlama.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `22:41:26` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `22:41:26` GET /api/health returns status: ok  
✅ `22:41:26` GET /api/system/stats has cpu field  
✅ `22:41:26` GET /api/system/stats has memory field  
✅ `22:41:26` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `22:41:26` GET /api/tunnels returns tunnels array  
ℹ️ `22:41:26` Tunnels before create: 0  
✅ `22:41:29` POST /api/tunnels create returned ok: true  
✅ `22:41:29` Created tunnel has an ID  
ℹ️ `22:41:29` Created tunnel ID: 95a4ea6a-2c94-4ce1-ad58-4ffc7d1c33dd  
✅ `22:41:29` New tunnel appears in tunnel list  
✅ `22:41:32` PATCH /api/tunnels/:id disable returned ok: true  
✅ `22:41:32` Tunnel shows as disabled after PATCH  
✅ `22:41:34` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `22:41:34` Tunnel shows as enabled after re-enable PATCH  
✅ `22:41:37` DELETE /api/tunnels/:id returned ok: true  
✅ `22:41:37` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `22:41:37` GET /api/users returns users array  
✅ `22:41:37` Users list contains at least one user (count: 2)  
✅ `22:41:39` POST /api/users create returned ok: true  
✅ `22:41:40` New user appears in users list  
✅ `22:41:42` PUT /api/users/:username update returned ok: true  
✅ `22:41:42` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `22:41:42` TOTP otpauth URI has correct scheme  
✅ `22:41:44` DELETE /api/users/:username returned ok: true  
✅ `22:41:44` User no longer appears after DELETE  

## 7. Service management via panel

✅ `22:41:44` GET /api/services returns services array  
✅ `22:41:44` Service 'nginx' is listed  
✅ `22:41:44` Service 'chisel' is listed  
✅ `22:41:44` Service 'authelia' is listed  
✅ `22:41:44` Service 'portlama-panel' is listed  

## 8. Certificate management

✅ `22:41:45` GET /api/certs returns certificate info  
ℹ️ `22:41:45` Certs response keys: certs  

## 9. Cleanup

ℹ️ `22:41:45` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `36` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `36` |

ℹ️ `22:41:45` Cleaning up test resources...  
🔵 `22:41:45` **Running: 06-tunnel-user-journey.sh**  
