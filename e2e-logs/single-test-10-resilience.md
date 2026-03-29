# Portlama E2E: 10 — Resilience

> Started at `2026-03-29 09:08:17 UTC`


## Pre-flight: check onboarding is complete

ℹ️ `09:08:17` Service nginx status before tests: active  
ℹ️ `09:08:17` Service chisel status before tests: active  
ℹ️ `09:08:17` Service authelia status before tests: active  
ℹ️ `09:08:17` Service portlama-panel status before tests: active  

## nginx failure and recovery

ℹ️ `09:08:17` Stopping nginx...  
✅ `09:08:20` API shows nginx as 'inactive' after stop  
✅ `09:08:20` nginx restart via API returned ok: true  
✅ `09:08:22` nginx is active after API restart  
✅ `09:08:22` API shows nginx as active after restart  

## chisel failure and recovery

ℹ️ `09:08:22` Stopping chisel...  
✅ `09:08:24` API shows chisel as 'inactive' after stop  
✅ `09:08:24` chisel restart via API returned ok: true  
✅ `09:08:26` chisel is active after API restart  

## authelia failure and recovery

ℹ️ `09:08:26` Stopping authelia...  
✅ `09:08:28` API shows authelia as 'inactive' after stop  
✅ `09:08:28` authelia restart via API returned ok: true  
✅ `09:08:30` authelia is active after API restart  

## Panel survives all service disruptions

✅ `09:08:30` Panel health is ok after all disruptions  
✅ `09:08:30` Service nginx is active at end of resilience test  
✅ `09:08:30` Service chisel is active at end of resilience test  
✅ `09:08:30` Service authelia is active at end of resilience test  
✅ `09:08:30` Service portlama-panel is active at end of resilience test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

