# Portlama E2E: 10 — Shell Lifecycle (Three-VM)

> Started at `2026-03-20 14:36:57 UTC`


## Pre-flight: verify onboarding is complete

✅ `14:36:57` Onboarding is complete  

## 1. Shell config defaults

✅ `14:36:57` Shell disabled by default  
✅ `14:36:57` At least one default policy exists  
✅ `14:36:57` Default policy ID is 'default'  

## 2. Enable shell globally

✅ `14:36:57` Enable shell returned ok: true  
✅ `14:36:57` Shell is now enabled  

## 3. Policy CRUD

✅ `14:36:57` Policy creation returned ok: true  
✅ `14:36:57` Policy has an ID  
ℹ️ `14:36:57` Created policy: e2e-test-policy  
✅ `14:36:57` Created policy found in listing  
✅ `14:36:57` Policy update returned ok: true  
✅ `14:36:57` Policy timeout updated to 600  
✅ `14:36:58` Cannot delete default policy (400)  
✅ `14:36:58` Policy deletion returned ok: true  
✅ `14:36:58` Deleted policy no longer in listing  

## 4. Policy validation

✅ `14:36:58` Empty policy name rejected with 400  
✅ `14:36:58` Invalid CIDR /99 rejected with 400  
✅ `14:36:58` Policy name > 100 chars rejected with 400  

## 5. REST API: enable/disable shell for agent cert

✅ `14:37:01` Agent cert creation returned ok: true  
✅ `14:37:01` Extracted agent PEM cert and key  
✅ `14:37:01` Shell enable for agent returned ok: true  
✅ `14:37:01` shellEnabledUntil is set  
ℹ️ `14:37:01` Shell enabled for agent e2e-shell-agent  
✅ `14:37:01` Agent sees global shell enabled  
✅ `14:37:01` Agent sees own shell enabled  
✅ `14:37:01` Agent-status returns correct label  
✅ `14:37:01` Agent sees shellEnabledUntil  
✅ `14:37:01` Shell disable for agent returned ok: true  
✅ `14:37:01` Agent sees shell disabled after disable  
✅ `14:37:01` Shell enable rejected when globally disabled (400)  

## 6. Install portlama-agent on VMs for integration test

ℹ️ `14:37:02` Packing portlama-agent tarball...  
✅ `14:37:02` portlama-agent tarball packed: /tmp/lamalibre-portlama-agent-1.0.4.tgz  
ℹ️ `14:37:02` Installing portlama-agent on agent VM...  
✅ `14:38:01` portlama-agent installed on agent VM  
✅ `14:38:01` tmux installed on agent VM  
ℹ️ `14:38:01` Installing portlama-agent on host VM...  
✅ `14:38:06` portlama-agent installed on host VM  

## 7. Configure and start shell-server on agent VM

✅ `14:38:07` Agent config written to /root/.portlama/agent.json  
✅ `14:38:07` Shell enabled for test-agent  
ℹ️ `14:38:07` Shell-server started on agent VM (PID: 10628)  
✅ `14:38:09` Shell-server connected to panel relay  

## 8. Full integration: admin connects and executes a command

✅ `14:38:09` Admin P12 created on host VM  
✅ `14:38:09` Test client script written to host VM  
ℹ️ `14:38:09` Session count before integration test: 0  
ℹ️ `14:38:09` Running WebSocket shell test client on host VM...  
ℹ️ `14:38:12` WebSocket test output:  
ℹ️ `14:38:12`   Connecting to: wss://127.0.0.1:9292/api/shell/connect/test-agent  
ℹ️ `14:38:12`   WebSocket connected to panel relay  
ℹ️ `14:38:12`   Received message type: connected  
ℹ️ `14:38:12`   Agent connected, relay active  
ℹ️ `14:38:12`   Received message type: session-started  
ℹ️ `14:38:12`   Session started: 2a1c3d09-1408-49b4-b218-c2bf8c70f070  
ℹ️ `14:38:12`   Received message type: output  
ℹ️ `14:38:12`   Sending test command...  
ℹ️ `14:38:12`   Received message type: output  
ℹ️ `14:38:12`   Received message type: output  
ℹ️ `14:38:12`   SUCCESS: Marker found in shell output  
ℹ️ `14:38:12`   Test passed — shell session completed successfully  
✅ `14:38:12` Full integration: admin connected, executed command, verified output  

## 9. Verify session audit log

✅ `14:38:14` New session entry created in audit log (before: 0, after: 1)  
✅ `14:38:14` Latest session belongs to agent: test-agent  
ℹ️ `14:38:14` Shell-server stopped on agent VM  

## 10. File transfer endpoints (501)

✅ `14:38:14` File download returns 501 (not yet implemented)  
✅ `14:38:15` File upload without path returns 400  

## 11. Input validation

✅ `14:38:15` Non-existent default policy rejected (400)  
✅ `14:38:15` durationMinutes=0 rejected (400)  
✅ `14:38:15` durationMinutes=9999 rejected (400)  
✅ `14:38:15` Shell enable for non-existent agent (404)  
✅ `14:38:15` Invalid label format rejected (400)  

## 12. Cleanup

✅ `14:38:15` Shell disabled after cleanup  
ℹ️ `14:38:15` Shell test cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `48` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `48` |

ℹ️ `14:38:15` Cleaning up shell test resources...  
