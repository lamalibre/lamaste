# Portlama E2E: 10 — Shell Lifecycle (Three-VM)

> Started at `2026-03-24 08:13:54 UTC`


## Pre-flight: verify onboarding is complete

✅ `08:13:55` Onboarding is complete  

## 1. Shell config defaults

✅ `08:13:55` Shell disabled by default  
✅ `08:13:55` At least one default policy exists  
✅ `08:13:55` Default policy ID is 'default'  

## 2. Enable shell globally

✅ `08:13:55` Enable shell returned ok: true  
✅ `08:13:55` Shell is now enabled  

## 3. Policy CRUD

✅ `08:13:55` Policy creation returned ok: true  
✅ `08:13:55` Policy has an ID  
ℹ️ `08:13:55` Created policy: e2e-test-policy  
✅ `08:13:55` Created policy found in listing  
✅ `08:13:55` Policy update returned ok: true  
✅ `08:13:55` Policy timeout updated to 600  
✅ `08:13:55` Cannot delete default policy (400)  
✅ `08:13:55` Policy deletion returned ok: true  
✅ `08:13:56` Deleted policy no longer in listing  

## 4. Policy validation

✅ `08:13:56` Empty policy name rejected with 400  
✅ `08:13:56` Invalid CIDR /99 rejected with 400  
✅ `08:13:56` Policy name > 100 chars rejected with 400  

## 5. REST API: enable/disable shell for agent cert

✅ `08:13:57` Agent cert creation returned ok: true  
✅ `08:13:57` Extracted agent PEM cert and key  
✅ `08:13:57` Shell enable for agent returned ok: true  
✅ `08:13:57` shellEnabledUntil is set  
ℹ️ `08:13:57` Shell enabled for agent e2e-shell-agent  
✅ `08:13:57` Agent sees global shell enabled  
✅ `08:13:57` Agent sees own shell enabled  
✅ `08:13:57` Agent-status returns correct label  
✅ `08:13:57` Agent sees shellEnabledUntil  
✅ `08:13:57` Shell disable for agent returned ok: true  
✅ `08:13:57` Agent sees shell disabled after disable  
✅ `08:13:58` Shell enable rejected when globally disabled (400)  

## 6. Install portlama-agent on VMs for integration test

ℹ️ `08:13:58` Packing portlama-agent tarball...  
✅ `08:13:58` portlama-agent tarball packed: /tmp/lamalibre-portlama-agent-1.0.6.tgz  
ℹ️ `08:13:58` Installing portlama-agent on agent VM...  
✅ `08:14:57` portlama-agent installed on agent VM  
✅ `08:14:57` tmux installed on agent VM  
ℹ️ `08:14:57` Installing portlama-agent on host VM...  
✅ `08:15:02` portlama-agent installed on host VM  

## 7. Configure and start shell-server on agent VM

✅ `08:15:02` Agent config written to /root/.portlama/agent.json  
✅ `08:15:02` Shell enabled for test-agent  
ℹ️ `08:15:03` Shell-server started on agent VM (PID: 10822)  
✅ `08:15:04` Shell-server connected to panel relay  

## 8. Full integration: admin connects and executes a command

✅ `08:15:04` Admin P12 created on host VM  
✅ `08:15:04` Test client script written to host VM  
ℹ️ `08:15:04` Session count before integration test: 0  
ℹ️ `08:15:04` Running WebSocket shell test client on host VM...  
ℹ️ `08:15:07` WebSocket test output:  
ℹ️ `08:15:07`   Connecting to: wss://127.0.0.1:9292/api/shell/connect/test-agent  
ℹ️ `08:15:07`   WebSocket connected to panel relay  
ℹ️ `08:15:07`   Received message type: connected  
ℹ️ `08:15:07`   Agent connected, relay active  
ℹ️ `08:15:07`   Received message type: session-started  
ℹ️ `08:15:07`   Session started: ab5c9a28-ca63-4f98-b903-057de2f1e911  
ℹ️ `08:15:07`   Received message type: output  
ℹ️ `08:15:07`   Sending test command...  
ℹ️ `08:15:07`   Received message type: output  
ℹ️ `08:15:07`   Received message type: output  
ℹ️ `08:15:07`   SUCCESS: Marker found in shell output  
ℹ️ `08:15:07`   Test passed — shell session completed successfully  
✅ `08:15:07` Full integration: admin connected, executed command, verified output  

## 9. Verify session audit log

✅ `08:15:09` New session entry created in audit log (before: 0, after: 1)  
✅ `08:15:09` Latest session belongs to agent: test-agent  
ℹ️ `08:15:10` Shell-server stopped on agent VM  

## 10. File transfer endpoints (501)

✅ `08:15:10` File download returns 501 (not yet implemented)  
✅ `08:15:10` File upload without path returns 400  

## 11. Input validation

✅ `08:15:10` Non-existent default policy rejected (400)  
✅ `08:15:10` durationMinutes=0 rejected (400)  
✅ `08:15:10` durationMinutes=9999 rejected (400)  
✅ `08:15:10` Shell enable for non-existent agent (404)  
✅ `08:15:10` Invalid label format rejected (400)  

## 12. Cleanup

✅ `08:15:10` Shell disabled after cleanup  
ℹ️ `08:15:10` Shell test cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `48` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `48` |

ℹ️ `08:15:11` Cleaning up shell test resources...  
🔵 `08:15:12` **Running: 11-plugin-lifecycle.sh**  
