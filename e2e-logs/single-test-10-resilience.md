# Portlama E2E: 10 — Resilience

> Started at `2026-03-19 12:17:30 UTC`


## Pre-flight: check onboarding is complete

ℹ️ `12:17:30` Service nginx status before tests: active  
ℹ️ `12:17:30` Service chisel status before tests: active  
ℹ️ `12:17:30` Service authelia status before tests: active  
ℹ️ `12:17:30` Service portlama-panel status before tests: active  

## nginx failure and recovery

ℹ️ `12:17:30` Stopping nginx...  
✅ `12:17:32` API shows nginx as 'inactive' after stop  
✅ `12:17:32` nginx restart via API returned ok: true  
✅ `12:17:34` nginx is active after API restart  
✅ `12:17:34` API shows nginx as active after restart  

## chisel failure and recovery

ℹ️ `12:17:34` Stopping chisel...  
✅ `12:17:37` API shows chisel as 'inactive' after stop  
✅ `12:17:37` chisel restart via API returned ok: true  
✅ `12:17:39` chisel is active after API restart  

## authelia failure and recovery

ℹ️ `12:17:39` Stopping authelia...  
✅ `12:17:41` API shows authelia as 'inactive' after stop  
✅ `12:17:41` authelia restart via API returned ok: true  
✅ `12:17:43` authelia is active after API restart  

## Panel survives all service disruptions

✅ `12:17:43` Panel health is ok after all disruptions  
✅ `12:17:43` Service nginx is active at end of resilience test  
✅ `12:17:43` Service chisel is active at end of resilience test  
✅ `12:17:43` Service authelia is active at end of resilience test  
✅ `12:17:43` Service portlama-panel is active at end of resilience test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

