# Portlama E2E: 10 — Resilience

> Started at `2026-03-28 22:38:53 UTC`


## Pre-flight: check onboarding is complete

ℹ️ `22:38:53` Service nginx status before tests: active  
ℹ️ `22:38:53` Service chisel status before tests: active  
ℹ️ `22:38:53` Service authelia status before tests: active  
ℹ️ `22:38:53` Service portlama-panel status before tests: active  

## nginx failure and recovery

ℹ️ `22:38:53` Stopping nginx...  
✅ `22:38:55` API shows nginx as 'inactive' after stop  
✅ `22:38:55` nginx restart via API returned ok: true  
✅ `22:38:57` nginx is active after API restart  
✅ `22:38:57` API shows nginx as active after restart  

## chisel failure and recovery

ℹ️ `22:38:57` Stopping chisel...  
✅ `22:39:00` API shows chisel as 'inactive' after stop  
✅ `22:39:00` chisel restart via API returned ok: true  
✅ `22:39:02` chisel is active after API restart  

## authelia failure and recovery

ℹ️ `22:39:02` Stopping authelia...  
✅ `22:39:04` API shows authelia as 'inactive' after stop  
✅ `22:39:04` authelia restart via API returned ok: true  
✅ `22:39:06` authelia is active after API restart  

## Panel survives all service disruptions

✅ `22:39:06` Panel health is ok after all disruptions  
✅ `22:39:06` Service nginx is active at end of resilience test  
✅ `22:39:06` Service chisel is active at end of resilience test  
✅ `22:39:06` Service authelia is active at end of resilience test  
✅ `22:39:06` Service portlama-panel is active at end of resilience test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

