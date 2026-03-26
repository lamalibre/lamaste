# Portlama E2E: 03 — Onboarding Flow

> Started at `2026-03-26 10:46:06 UTC`


## Initial onboarding status

ℹ️ `10:46:06` Current onboarding status: COMPLETED  
ℹ️ `10:46:06` Onboarding already completed — testing post-completion behavior  
✅ `10:46:06` POST /onboarding/domain returns 410 after completion  
✅ `10:46:06` POST /onboarding/verify-dns returns 410 after completion  
✅ `10:46:07` POST /onboarding/provision returns 410 after completion  
✅ `10:46:07` GET /onboarding/status still returns 200  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `4` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `4` |

