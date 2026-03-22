# Portlama E2E: 10 — Resilience

> Started at `2026-03-22 18:24:58 UTC`


## Pre-flight: check onboarding is complete

ℹ️ `18:24:58` Service nginx status before tests: active  
ℹ️ `18:24:58` Service chisel status before tests: active  
ℹ️ `18:24:58` Service authelia status before tests: active  
ℹ️ `18:24:58` Service portlama-panel status before tests: active  

## nginx failure and recovery

ℹ️ `18:24:58` Stopping nginx...  
✅ `18:25:00` API shows nginx as 'inactive' after stop  
✅ `18:25:00` nginx restart via API returned ok: true  
✅ `18:25:02` nginx is active after API restart  
✅ `18:25:03` API shows nginx as active after restart  

## chisel failure and recovery

ℹ️ `18:25:03` Stopping chisel...  
✅ `18:25:05` API shows chisel as 'inactive' after stop  
✅ `18:25:05` chisel restart via API returned ok: true  
✅ `18:25:07` chisel is active after API restart  

## authelia failure and recovery

ℹ️ `18:25:07` Stopping authelia...  
✅ `18:25:10` API shows authelia as 'inactive' after stop  
✅ `18:25:10` authelia restart via API returned ok: true  
✅ `18:25:12` authelia is active after API restart  

## Panel survives all service disruptions

✅ `18:25:12` Panel health is ok after all disruptions  
✅ `18:25:12` Service nginx is active at end of resilience test  
✅ `18:25:12` Service chisel is active at end of resilience test  
✅ `18:25:12` Service authelia is active at end of resilience test  
✅ `18:25:12` Service portlama-panel is active at end of resilience test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

