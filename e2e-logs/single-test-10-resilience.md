# Portlama E2E: 10 — Resilience

> Started at `2026-03-28 16:08:30 UTC`


## Pre-flight: check onboarding is complete

ℹ️ `16:08:30` Service nginx status before tests: active  
ℹ️ `16:08:30` Service chisel status before tests: active  
ℹ️ `16:08:30` Service authelia status before tests: active  
ℹ️ `16:08:30` Service portlama-panel status before tests: active  

## nginx failure and recovery

ℹ️ `16:08:30` Stopping nginx...  
✅ `16:08:32` API shows nginx as 'inactive' after stop  
✅ `16:08:32` nginx restart via API returned ok: true  
✅ `16:08:35` nginx is active after API restart  
✅ `16:08:35` API shows nginx as active after restart  

## chisel failure and recovery

ℹ️ `16:08:35` Stopping chisel...  
✅ `16:08:37` API shows chisel as 'inactive' after stop  
✅ `16:08:37` chisel restart via API returned ok: true  
✅ `16:08:39` chisel is active after API restart  

## authelia failure and recovery

ℹ️ `16:08:39` Stopping authelia...  
✅ `16:08:41` API shows authelia as 'inactive' after stop  
✅ `16:08:41` authelia restart via API returned ok: true  
✅ `16:08:43` authelia is active after API restart  

## Panel survives all service disruptions

✅ `16:08:43` Panel health is ok after all disruptions  
✅ `16:08:43` Service nginx is active at end of resilience test  
✅ `16:08:43` Service chisel is active at end of resilience test  
✅ `16:08:43` Service authelia is active at end of resilience test  
✅ `16:08:43` Service portlama-panel is active at end of resilience test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

