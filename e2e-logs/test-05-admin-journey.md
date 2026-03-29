# Portlama E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-03-29 09:11:01 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `09:11:01` Panel via IP:9292 returns HTTP 200  
✅ `09:11:01` Panel via IP:9292 contains React mount point  
✅ `09:11:01` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `09:11:02` Panel via panel.test.portlama.local returns HTTP 200  
✅ `09:11:02` Panel via panel.test.portlama.local contains React mount point  
✅ `09:11:02` Panel via panel.test.portlama.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `09:11:02` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `09:11:02` GET /api/health returns status: ok  
✅ `09:11:02` GET /api/system/stats has cpu field  
✅ `09:11:02` GET /api/system/stats has memory field  
✅ `09:11:02` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `09:11:02` GET /api/tunnels returns tunnels array  
ℹ️ `09:11:02` Tunnels before create: 0  
✅ `09:11:05` POST /api/tunnels create returned ok: true  
✅ `09:11:05` Created tunnel has an ID  
ℹ️ `09:11:05` Created tunnel ID: acde6662-d59d-4997-ae35-5f3e022c1dc3  
✅ `09:11:05` New tunnel appears in tunnel list  
✅ `09:11:07` PATCH /api/tunnels/:id disable returned ok: true  
✅ `09:11:07` Tunnel shows as disabled after PATCH  
✅ `09:11:10` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `09:11:10` Tunnel shows as enabled after re-enable PATCH  
✅ `09:11:12` DELETE /api/tunnels/:id returned ok: true  
✅ `09:11:12` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `09:11:12` GET /api/users returns users array  
✅ `09:11:12` Users list contains at least one user (count: 2)  
✅ `09:11:15` POST /api/users create returned ok: true  
✅ `09:11:15` New user appears in users list  
✅ `09:11:17` PUT /api/users/:username update returned ok: true  
✅ `09:11:17` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `09:11:17` TOTP otpauth URI has correct scheme  
✅ `09:11:19` DELETE /api/users/:username returned ok: true  
✅ `09:11:20` User no longer appears after DELETE  

## 7. Service management via panel

✅ `09:11:20` GET /api/services returns services array  
✅ `09:11:20` Service 'nginx' is listed  
✅ `09:11:20` Service 'chisel' is listed  
✅ `09:11:20` Service 'authelia' is listed  
✅ `09:11:20` Service 'portlama-panel' is listed  

## 8. Certificate management

✅ `09:11:20` GET /api/certs returns certificate info  
ℹ️ `09:11:20` Certs response keys: certs  

## 9. Cleanup

ℹ️ `09:11:20` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `36` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `36` |

ℹ️ `09:11:20` Cleaning up test resources...  
🔵 `09:11:20` **Running: 06-tunnel-user-journey.sh**  
