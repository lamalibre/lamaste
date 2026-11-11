# Lamaste E2E: 68 — Lamaste's packages came from Feria, never npmjs (Three-VM)

> Started at `2026-11-11 11:30:53 UTC`


## The rule, as the host's core resolves it

ℹ️ `11:30:54` root http://192.168.2.1:4873/;lamaste http://192.168.2.1:4873/;unconfigured https://feria.codelama.com.tr/;npmjs refused:lamalibre_registry_refused  
✅ `11:30:54` root: the development Feria npm's configuration names (http://192.168.2.1:4873/)  
✅ `11:30:54` the lamaste account: the same, from npm's global configuration (http://192.168.2.1:4873/)  
✅ `11:30:54` npm with no configuration: the hosted Feria  
✅ `11:30:54` npm naming npmjs for @lamalibre: refused  

## The evidence: npm's caches and logs on every VM

ℹ️ `11:30:57` host: 10 @lamalibre URLs in npm's caches and logs, 2 from the development Feria  
✅ `11:30:57` host: npm's caches hold @lamalibre requests to the development Feria (the evidence is there to read)  
✅ `11:30:57` host: no @lamalibre request to npmjs, its mirrors or the hosted Feria  
ℹ️ `11:31:02` agent: 75 @lamalibre URLs in npm's caches and logs, 4 from the development Feria  
✅ `11:31:02` agent: npm's caches hold @lamalibre requests to the development Feria (the evidence is there to read)  
✅ `11:31:02` agent: no @lamalibre request to npmjs, its mirrors or the hosted Feria  
ℹ️ `11:31:03` visitor: 9 @lamalibre URLs in npm's caches and logs, 6 from the development Feria  
✅ `11:31:03` visitor: no @lamalibre request to npmjs, its mirrors or the hosted Feria  

## The root helper's self-update names the registry

✅ `11:31:03` lamaste-priv self-update: npx --@lamalibre:registry=<registry> create-lamaste@<version>  
✅ `11:31:03` …and refuses a root npmrc naming npmjs  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `11` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `11` |

