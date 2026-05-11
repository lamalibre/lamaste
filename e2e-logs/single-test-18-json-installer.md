# Lamaste E2E: 18 — JSON Installer Output

> Started at `2026-03-30 13:07:44 UTC`


## create-lamaste --json (redeploy mode)


## NDJSON line validation

✅ `13:07:58` All 5 lines are valid JSON  
✅ `13:07:58` Step events emitted: 4  

## Complete event validation

✅ `13:07:58` Exactly one complete event emitted  
✅ `13:07:58` Server IP present: 192.168.2.9  
✅ `13:07:58` Panel URL present and uses HTTPS: https://192.168.2.9:9292  
✅ `13:07:58` P12 path within expected directory: /etc/lamaste/pki/client.p12  
✅ `13:07:58` P12 password path within expected directory: /etc/lamaste/pki/.p12-password  

## Step status validation

✅ `13:07:58` check_environment step present  
✅ `13:07:58` All step events have valid status values  

## Panel health after redeploy

✅ `13:07:58` Panel healthy after --json redeploy  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `10` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `10` |

