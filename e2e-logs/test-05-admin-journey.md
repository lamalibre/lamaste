# Portlama E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-03-24 09:39:20 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `09:39:20` Panel via IP:9292 returns HTTP 200  
✅ `09:39:20` Panel via IP:9292 contains React mount point  
✅ `09:39:20` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `09:39:20` Panel via panel.test.portlama.local returns HTTP 200  
✅ `09:39:20` Panel via panel.test.portlama.local contains React mount point  
✅ `09:39:20` Panel via panel.test.portlama.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `09:39:20` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `09:39:20` GET /api/health returns status: ok  
✅ `09:39:21` GET /api/system/stats has cpu field  
✅ `09:39:21` GET /api/system/stats has memory field  
✅ `09:39:21` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `09:39:21` GET /api/tunnels returns tunnels array  
ℹ️ `09:39:21` Tunnels before create: 0  
✅ `09:39:23` POST /api/tunnels create returned ok: true  
✅ `09:39:23` Created tunnel has an ID  
ℹ️ `09:39:23` Created tunnel ID: 3e2b8e32-a4ed-4101-8cfe-1f00f6d812ce  
✅ `09:39:24` New tunnel appears in tunnel list  
✅ `09:39:26` PATCH /api/tunnels/:id disable returned ok: true  
✅ `09:39:26` Tunnel shows as disabled after PATCH  
✅ `09:39:28` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `09:39:28` Tunnel shows as enabled after re-enable PATCH  
✅ `09:39:31` DELETE /api/tunnels/:id returned ok: true  
✅ `09:39:31` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `09:39:31` GET /api/users returns users array  
✅ `09:39:31` Users list contains at least one user (count: 2)  
✅ `09:39:34` POST /api/users create returned ok: true  
✅ `09:39:34` New user appears in users list  
✅ `09:39:36` PUT /api/users/:username update returned ok: true  
✅ `09:39:36` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `09:39:36` TOTP otpauth URI has correct scheme  
✅ `09:39:38` DELETE /api/users/:username returned ok: true  
✅ `09:39:38` User no longer appears after DELETE  

## 7. Service management via panel

✅ `09:39:38` GET /api/services returns services array  
✅ `09:39:38` Service 'nginx' is listed  
✅ `09:39:38` Service 'chisel' is listed  
✅ `09:39:38` Service 'authelia' is listed  
✅ `09:39:38` Service 'portlama-panel' is listed  

## 8. Certificate management

✅ `09:39:39` GET /api/certs returns certificate info  
ℹ️ `09:39:39` Certs response keys: certs  

## 9. Cleanup

ℹ️ `09:39:39` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `36` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `36` |

ℹ️ `09:39:39` Cleaning up test resources...  
🔵 `09:39:39` **Running: 06-tunnel-user-journey.sh**  
