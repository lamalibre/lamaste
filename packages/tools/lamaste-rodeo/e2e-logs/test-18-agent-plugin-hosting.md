# Lamaste E2E: 18 — Agent Plugin Hosting

> Started at `2026-11-02 15:51:41 UTC`


## Pre-flight: check onboarding is complete

✅ `15:51:41` Onboarding is complete  

## Create agent cert for plugin reporting

✅ `15:51:41` Agent cert created for plugin reporting  
✅ `15:51:42` Agent PEM cert extracted  

## Agent reports plugin capabilities

✅ `15:51:42` Plugin report accepted  
✅ `15:51:42` Two capabilities merged  

## Capability prefix scoping

✅ `15:51:42` Only plugin:myplugin:action merged (plugin:other:action rejected)  

## Invalid capability format rejected

✅ `15:51:42` Capability without colon rejected with 400  
✅ `15:51:42` Capability claiming a core namespace rejected with 400  

## Admin can also report

✅ `15:51:42` Admin can report plugin capabilities  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `9` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `9` |

