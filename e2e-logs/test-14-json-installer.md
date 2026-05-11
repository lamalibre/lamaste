# Lamaste E2E: 14 — JSON Installer Output (Three-VM)

> Started at `2026-03-30 13:11:54 UTC`


## create-lamaste --json on host VM (redeploy mode)


## NDJSON line validation

✅ `13:12:00` All 5 NDJSON lines are valid JSON  
✅ `13:12:00` Step events emitted: 4  

## Complete event

✅ `13:12:00` Exactly one complete event emitted  
✅ `13:12:00` Server IP present: 192.168.2.9  
✅ `13:12:00` Panel URL present and uses HTTPS  

## Panel health after redeploy

⏭️ `13:12:16` Panel health check timed out after --json redeploy (non-critical)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `5` |
| **Failed** | `0` |
| **Skipped** | `1` |
| **Total** | `6` |

🔵 `13:12:16` **Running: 15-panel-expose.sh**  
