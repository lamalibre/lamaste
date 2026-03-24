# Portlama E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-03-24 08:12:29 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `08:12:30` Panel via IP:9292 returns HTTP 200  
✅ `08:12:30` Panel via IP:9292 contains React mount point  
✅ `08:12:30` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `08:12:30` Panel via panel.test.portlama.local returns HTTP 200  
✅ `08:12:30` Panel via panel.test.portlama.local contains React mount point  
✅ `08:12:30` Panel via panel.test.portlama.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `08:12:30` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `08:12:30` GET /api/health returns status: ok  
✅ `08:12:30` GET /api/system/stats has cpu field  
✅ `08:12:30` GET /api/system/stats has memory field  
✅ `08:12:30` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `08:12:31` GET /api/tunnels returns tunnels array  
ℹ️ `08:12:31` Tunnels before create: 0  
✅ `08:12:33` POST /api/tunnels create returned ok: true  
✅ `08:12:33` Created tunnel has an ID  
ℹ️ `08:12:33` Created tunnel ID: 1ff41eea-d517-435e-9b6e-9de49f0bd79a  
✅ `08:12:34` New tunnel appears in tunnel list  
✅ `08:12:36` PATCH /api/tunnels/:id disable returned ok: true  
✅ `08:12:36` Tunnel shows as disabled after PATCH  
✅ `08:12:39` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `08:12:39` Tunnel shows as enabled after re-enable PATCH  
✅ `08:12:41` DELETE /api/tunnels/:id returned ok: true  
✅ `08:12:41` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `08:12:41` GET /api/users returns users array  
✅ `08:12:41` Users list contains at least one user (count: 2)  
✅ `08:12:44` POST /api/users create returned ok: true  
✅ `08:12:44` New user appears in users list  
✅ `08:12:46` PUT /api/users/:username update returned ok: true  
✅ `08:12:46` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `08:12:46` TOTP otpauth URI has correct scheme  
✅ `08:12:48` DELETE /api/users/:username returned ok: true  
✅ `08:12:49` User no longer appears after DELETE  

## 7. Service management via panel

✅ `08:12:49` GET /api/services returns services array  
✅ `08:12:49` Service 'nginx' is listed  
✅ `08:12:49` Service 'chisel' is listed  
✅ `08:12:49` Service 'authelia' is listed  
✅ `08:12:49` Service 'portlama-panel' is listed  

## 8. Certificate management

✅ `08:12:49` GET /api/certs returns certificate info  
ℹ️ `08:12:49` Certs response keys: certs  

## 9. Cleanup

ℹ️ `08:12:49` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `36` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `36` |

ℹ️ `08:12:49` Cleaning up test resources...  
🔵 `08:12:49` **Running: 06-tunnel-user-journey.sh**  
