# Portlama E2E: 10 — Resilience

> Started at `2026-03-26 10:46:37 UTC`


## Pre-flight: check onboarding is complete

ℹ️ `10:46:37` Service nginx status before tests: active  
ℹ️ `10:46:37` Service chisel status before tests: active  
ℹ️ `10:46:37` Service authelia status before tests: active  
ℹ️ `10:46:37` Service portlama-panel status before tests: active  

## nginx failure and recovery

ℹ️ `10:46:37` Stopping nginx...  
✅ `10:46:39` API shows nginx as 'inactive' after stop  
✅ `10:46:39` nginx restart via API returned ok: true  
✅ `10:46:41` nginx is active after API restart  
✅ `10:46:41` API shows nginx as active after restart  

## chisel failure and recovery

ℹ️ `10:46:41` Stopping chisel...  
✅ `10:46:43` API shows chisel as 'inactive' after stop  
✅ `10:46:43` chisel restart via API returned ok: true  
✅ `10:46:45` chisel is active after API restart  

## authelia failure and recovery

ℹ️ `10:46:45` Stopping authelia...  
✅ `10:46:48` API shows authelia as 'inactive' after stop  
✅ `10:46:48` authelia restart via API returned ok: true  
✅ `10:46:50` authelia is active after API restart  

## Panel survives all service disruptions

✅ `10:46:50` Panel health is ok after all disruptions  
✅ `10:46:50` Service nginx is active at end of resilience test  
✅ `10:46:50` Service chisel is active at end of resilience test  
✅ `10:46:50` Service authelia is active at end of resilience test  
✅ `10:46:50` Service portlama-panel is active at end of resilience test  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `15` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `15` |

