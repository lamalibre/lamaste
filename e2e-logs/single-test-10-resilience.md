# Portlama E2E: 10 — Resilience

> Started at `2026-03-16 17:21:47 UTC`


## Pre-flight: check onboarding is complete

ℹ️ `17:21:47` Service nginx status before tests: active  
ℹ️ `17:21:47` Service chisel status before tests: active  
ℹ️ `17:21:47` Service authelia status before tests: active  
ℹ️ `17:21:47` Service portlama-panel status before tests: active  

## nginx failure and recovery

ℹ️ `17:21:47` Stopping nginx...  
✅ `17:21:49` API shows nginx as 'inactive' after stop  
✅ `17:21:49` nginx restart via API returned ok: true  
✅ `17:21:52` nginx is active after API restart  
✅ `17:21:52` API shows nginx as active after restart  

## chisel failure and recovery

ℹ️ `17:21:52` Stopping chisel...  
✅ `17:21:54` API shows chisel as 'inactive' after stop  
✅ `17:21:54` chisel restart via API returned ok: true  
✅ `17:21:56` chisel is active after API restart  

## authelia failure and recovery

ℹ️ `17:21:56` Stopping authelia...  
✅ `17:21:58` API shows authelia as 'inactive' after stop  
✅ `17:21:58` authelia restart via API returned ok: true  
✅ `17:22:00` authelia is active after API restart  

## Panel survives all service disruptions

✅ `17:22:00` Panel health is ok after all disruptions  
✅ `17:22:00` Service nginx is active at end of resilience test  
✅ `17:22:00` Service chisel is active at end of resilience test  
✅ `17:22:00` Service authelia is active at end of resilience test  
✅ `17:22:00` Service portlama-panel is active at end of resilience test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

