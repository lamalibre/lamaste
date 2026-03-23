# Portlama E2E: 10 — Resilience

> Started at `2026-03-23 12:09:25 UTC`


## Pre-flight: check onboarding is complete

ℹ️ `12:09:25` Service nginx status before tests: active  
ℹ️ `12:09:25` Service chisel status before tests: active  
ℹ️ `12:09:25` Service authelia status before tests: active  
ℹ️ `12:09:25` Service portlama-panel status before tests: active  

## nginx failure and recovery

ℹ️ `12:09:25` Stopping nginx...  
✅ `12:09:28` API shows nginx as 'inactive' after stop  
✅ `12:09:28` nginx restart via API returned ok: true  
✅ `12:09:30` nginx is active after API restart  
✅ `12:09:30` API shows nginx as active after restart  

## chisel failure and recovery

ℹ️ `12:09:30` Stopping chisel...  
✅ `12:09:32` API shows chisel as 'inactive' after stop  
✅ `12:09:32` chisel restart via API returned ok: true  
✅ `12:09:34` chisel is active after API restart  

## authelia failure and recovery

ℹ️ `12:09:34` Stopping authelia...  
✅ `12:09:36` API shows authelia as 'inactive' after stop  
✅ `12:09:36` authelia restart via API returned ok: true  
✅ `12:09:38` authelia is active after API restart  

## Panel survives all service disruptions

✅ `12:09:38` Panel health is ok after all disruptions  
✅ `12:09:38` Service nginx is active at end of resilience test  
✅ `12:09:38` Service chisel is active at end of resilience test  
✅ `12:09:38` Service authelia is active at end of resilience test  
✅ `12:09:38` Service portlama-panel is active at end of resilience test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

