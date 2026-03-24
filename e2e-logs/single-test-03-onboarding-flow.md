# Portlama E2E: 03 — Onboarding Flow

> Started at `2026-03-24 08:10:23 UTC`


## Initial onboarding status

ℹ️ `08:10:23` Current onboarding status: COMPLETED  
ℹ️ `08:10:23` Onboarding already completed — testing post-completion behavior  
✅ `08:10:23` POST /onboarding/domain returns 410 after completion  
✅ `08:10:23` POST /onboarding/verify-dns returns 410 after completion  
✅ `08:10:23` POST /onboarding/provision returns 410 after completion  
✅ `08:10:23` GET /onboarding/status still returns 200  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `4` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `4` |

