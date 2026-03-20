# Portlama E2E: 10 — Resilience

> Started at `2026-03-20 14:33:59 UTC`


## Pre-flight: check onboarding is complete

ℹ️ `14:33:59` Service nginx status before tests: active  
ℹ️ `14:33:59` Service chisel status before tests: active  
ℹ️ `14:33:59` Service authelia status before tests: active  
ℹ️ `14:33:59` Service portlama-panel status before tests: active  

## nginx failure and recovery

ℹ️ `14:33:59` Stopping nginx...  
✅ `14:34:02` API shows nginx as 'inactive' after stop  
✅ `14:34:02` nginx restart via API returned ok: true  
✅ `14:34:04` nginx is active after API restart  
✅ `14:34:04` API shows nginx as active after restart  

## chisel failure and recovery

ℹ️ `14:34:04` Stopping chisel...  
✅ `14:34:06` API shows chisel as 'inactive' after stop  
✅ `14:34:06` chisel restart via API returned ok: true  
✅ `14:34:08` chisel is active after API restart  

## authelia failure and recovery

ℹ️ `14:34:08` Stopping authelia...  
✅ `14:34:10` API shows authelia as 'inactive' after stop  
✅ `14:34:10` authelia restart via API returned ok: true  
✅ `14:34:12` authelia is active after API restart  

## Panel survives all service disruptions

✅ `14:34:12` Panel health is ok after all disruptions  
✅ `14:34:12` Service nginx is active at end of resilience test  
✅ `14:34:12` Service chisel is active at end of resilience test  
✅ `14:34:12` Service authelia is active at end of resilience test  
✅ `14:34:12` Service portlama-panel is active at end of resilience test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

