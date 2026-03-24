# Portlama E2E: 10 — Resilience

> Started at `2026-03-24 08:10:53 UTC`


## Pre-flight: check onboarding is complete

ℹ️ `08:10:53` Service nginx status before tests: active  
ℹ️ `08:10:53` Service chisel status before tests: active  
ℹ️ `08:10:53` Service authelia status before tests: active  
ℹ️ `08:10:53` Service portlama-panel status before tests: active  

## nginx failure and recovery

ℹ️ `08:10:53` Stopping nginx...  
✅ `08:10:55` API shows nginx as 'inactive' after stop  
✅ `08:10:55` nginx restart via API returned ok: true  
✅ `08:10:57` nginx is active after API restart  
✅ `08:10:57` API shows nginx as active after restart  

## chisel failure and recovery

ℹ️ `08:10:57` Stopping chisel...  
✅ `08:10:59` API shows chisel as 'inactive' after stop  
✅ `08:10:59` chisel restart via API returned ok: true  
✅ `08:11:01` chisel is active after API restart  

## authelia failure and recovery

ℹ️ `08:11:01` Stopping authelia...  
✅ `08:11:03` API shows authelia as 'inactive' after stop  
✅ `08:11:03` authelia restart via API returned ok: true  
✅ `08:11:05` authelia is active after API restart  

## Panel survives all service disruptions

✅ `08:11:05` Panel health is ok after all disruptions  
✅ `08:11:05` Service nginx is active at end of resilience test  
✅ `08:11:05` Service chisel is active at end of resilience test  
✅ `08:11:05` Service authelia is active at end of resilience test  
✅ `08:11:05` Service portlama-panel is active at end of resilience test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

