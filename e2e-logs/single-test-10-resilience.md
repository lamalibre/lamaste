# Lamaste E2E: 10 — Resilience

> Started at `2026-03-30 13:06:46 UTC`


## Pre-flight: check onboarding is complete

ℹ️ `13:06:46` Service nginx status before tests: active  
ℹ️ `13:06:46` Service chisel status before tests: active  
ℹ️ `13:06:46` Service authelia status before tests: active  
ℹ️ `13:06:46` Service lamaste-panel status before tests: active  

## nginx failure and recovery

ℹ️ `13:06:46` Stopping nginx...  
✅ `13:06:49` API shows nginx as 'inactive' after stop  
✅ `13:06:49` nginx restart via API returned ok: true  
✅ `13:06:51` nginx is active after API restart  
✅ `13:06:51` API shows nginx as active after restart  

## chisel failure and recovery

ℹ️ `13:06:51` Stopping chisel...  
✅ `13:06:53` API shows chisel as 'inactive' after stop  
✅ `13:06:53` chisel restart via API returned ok: true  
✅ `13:06:55` chisel is active after API restart  

## authelia failure and recovery

ℹ️ `13:06:55` Stopping authelia...  
✅ `13:06:57` API shows authelia as 'inactive' after stop  
✅ `13:06:57` authelia restart via API returned ok: true  
✅ `13:06:59` authelia is active after API restart  

## Panel survives all service disruptions

✅ `13:06:59` Panel health is ok after all disruptions  
✅ `13:06:59` Service nginx is active at end of resilience test  
✅ `13:06:59` Service chisel is active at end of resilience test  
✅ `13:06:59` Service authelia is active at end of resilience test  
✅ `13:06:59` Service lamaste-panel is active at end of resilience test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

