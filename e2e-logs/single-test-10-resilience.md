# Portlama E2E: 10 — Resilience

> Started at `2026-03-24 09:37:46 UTC`


## Pre-flight: check onboarding is complete

ℹ️ `09:37:46` Service nginx status before tests: active  
ℹ️ `09:37:46` Service chisel status before tests: active  
ℹ️ `09:37:46` Service authelia status before tests: active  
ℹ️ `09:37:46` Service portlama-panel status before tests: active  

## nginx failure and recovery

ℹ️ `09:37:46` Stopping nginx...  
✅ `09:37:48` API shows nginx as 'inactive' after stop  
✅ `09:37:49` nginx restart via API returned ok: true  
✅ `09:37:51` nginx is active after API restart  
✅ `09:37:51` API shows nginx as active after restart  

## chisel failure and recovery

ℹ️ `09:37:51` Stopping chisel...  
✅ `09:37:53` API shows chisel as 'inactive' after stop  
✅ `09:37:53` chisel restart via API returned ok: true  
✅ `09:37:55` chisel is active after API restart  

## authelia failure and recovery

ℹ️ `09:37:55` Stopping authelia...  
✅ `09:37:57` API shows authelia as 'inactive' after stop  
✅ `09:37:57` authelia restart via API returned ok: true  
✅ `09:37:59` authelia is active after API restart  

## Panel survives all service disruptions

✅ `09:37:59` Panel health is ok after all disruptions  
✅ `09:37:59` Service nginx is active at end of resilience test  
✅ `09:37:59` Service chisel is active at end of resilience test  
✅ `09:37:59` Service authelia is active at end of resilience test  
✅ `09:37:59` Service portlama-panel is active at end of resilience test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

