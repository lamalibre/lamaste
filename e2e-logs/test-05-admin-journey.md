# Portlama E2E: 05 — Admin Journey (Three-VM)

> Started at `2026-03-28 16:10:48 UTC`


## Pre-flight: verify onboarding is complete


## 1. Panel accessible via IP:9292 (mTLS)

✅ `16:10:49` Panel via IP:9292 returns HTTP 200  
✅ `16:10:49` Panel via IP:9292 contains React mount point  
✅ `16:10:49` Panel via IP:9292 contains title tag  

## 2. Panel accessible via panel.DOMAIN (mTLS)

✅ `16:10:49` Panel via panel.test.portlama.local returns HTTP 200  
✅ `16:10:49` Panel via panel.test.portlama.local contains React mount point  
✅ `16:10:49` Panel via panel.test.portlama.local contains title tag  

## 3. Panel without mTLS cert rejected

✅ `16:10:49` Panel without mTLS cert rejected (HTTP 400)  

## 4. Dashboard API returns data

✅ `16:10:49` GET /api/health returns status: ok  
✅ `16:10:49` GET /api/system/stats has cpu field  
✅ `16:10:49` GET /api/system/stats has memory field  
✅ `16:10:49` GET /api/system/stats has disk field  

## 5. Tunnel management via panel

✅ `16:10:49` GET /api/tunnels returns tunnels array  
ℹ️ `16:10:49` Tunnels before create: 0  
✅ `16:10:52` POST /api/tunnels create returned ok: true  
✅ `16:10:52` Created tunnel has an ID  
ℹ️ `16:10:52` Created tunnel ID: e46292a4-5532-463d-9a40-1fd39b21c4fd  
✅ `16:10:52` New tunnel appears in tunnel list  
✅ `16:10:54` PATCH /api/tunnels/:id disable returned ok: true  
✅ `16:10:55` Tunnel shows as disabled after PATCH  
✅ `16:10:57` PATCH /api/tunnels/:id re-enable returned ok: true  
✅ `16:10:57` Tunnel shows as enabled after re-enable PATCH  
✅ `16:10:59` DELETE /api/tunnels/:id returned ok: true  
✅ `16:11:00` Tunnel no longer appears after DELETE  

## 6. User management via panel

✅ `16:11:00` GET /api/users returns users array  
✅ `16:11:00` Users list contains at least one user (count: 2)  
✅ `16:11:02` POST /api/users create returned ok: true  
✅ `16:11:02` New user appears in users list  
✅ `16:11:04` PUT /api/users/:username update returned ok: true  
✅ `16:11:05` POST /api/users/:username/reset-totp returns otpauth URI  
✅ `16:11:05` TOTP otpauth URI has correct scheme  
✅ `16:11:07` DELETE /api/users/:username returned ok: true  
✅ `16:11:07` User no longer appears after DELETE  

## 7. Service management via panel

✅ `16:11:07` GET /api/services returns services array  
✅ `16:11:07` Service 'nginx' is listed  
✅ `16:11:07` Service 'chisel' is listed  
✅ `16:11:07` Service 'authelia' is listed  
✅ `16:11:07` Service 'portlama-panel' is listed  

## 8. Certificate management

✅ `16:11:07` GET /api/certs returns certificate info  
ℹ️ `16:11:07` Certs response keys: certs  

## 9. Cleanup

ℹ️ `16:11:07` All test sections completed. EXIT trap will handle resource cleanup.  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `36` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `36` |

ℹ️ `16:11:07` Cleaning up test resources...  
🔵 `16:11:07` **Running: 06-tunnel-user-journey.sh**  
