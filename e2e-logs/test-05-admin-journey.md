# Portlama E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-03-19 12:19:00 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `12:19:00` Panel via IP:9292 returns HTTP 200  
✅ `12:19:00` Panel via IP:9292 contains React mount point  
✅ `12:19:00` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `12:19:00` Panel via panel.test.portlama.local returns HTTP 200  
✅ `12:19:00` Panel via panel.test.portlama.local contains React mount point  
✅ `12:19:00` Panel via panel.test.portlama.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `12:19:00` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `12:19:00` GET /api/health returns status: ok  
✅ `12:19:00` GET /api/system/stats has cpu field  
✅ `12:19:00` GET /api/system/stats has memory field  
✅ `12:19:00` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `12:19:01` GET /api/tunnels returns tunnels array  
ℹ️ `12:19:01` Tunnels before create: 0  
✅ `12:19:03` POST /api/tunnels create returned ok: true  
✅ `12:19:03` Created tunnel has an ID  
ℹ️ `12:19:03` Created tunnel ID: 7738012d-b96a-46f0-9168-97f46e031d6d  
✅ `12:19:03` New tunnel appears in tunnel list  
✅ `12:19:06` PATCH /api/tunnels/:id disable returned ok: true  
✅ `12:19:06` Tunnel shows as disabled after PATCH  
✅ `12:19:08` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `12:19:08` Tunnel shows as enabled after re-enable PATCH  
✅ `12:19:11` DELETE /api/tunnels/:id returned ok: true  
✅ `12:19:11` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `12:19:11` GET /api/users returns users array  
✅ `12:19:11` Users list contains at least one user (count: 2)  
✅ `12:19:13` POST /api/users create returned ok: true  
✅ `12:19:14` New user appears in users list  
✅ `12:19:16` PUT /api/users/:username update returned ok: true  
✅ `12:19:16` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `12:19:16` TOTP otpauth URI has correct scheme  
✅ `12:19:18` DELETE /api/users/:username returned ok: true  
✅ `12:19:18` User no longer appears after DELETE  

## 7. Service management via panel

✅ `12:19:18` GET /api/services returns services array  
✅ `12:19:18` Service 'nginx' is listed  
✅ `12:19:19` Service 'chisel' is listed  
✅ `12:19:19` Service 'authelia' is listed  
✅ `12:19:19` Service 'portlama-panel' is listed  

## 8. Certificate management

✅ `12:19:19` GET /api/certs returns certificate info  
ℹ️ `12:19:19` Certs response keys: certs  

## 9. Cleanup

ℹ️ `12:19:19` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `36` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `36` |

ℹ️ `12:19:19` Cleaning up test resources...  
🔵 `12:19:19` **Running: 06-tunnel-user-journey.sh**  
