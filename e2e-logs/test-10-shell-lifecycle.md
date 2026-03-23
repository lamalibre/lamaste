# Portlama E2E: 10 — Shell Lifecycle (Three-VM)

> Started at `2026-03-23 12:12:37 UTC`


## Pre-flight: verify onboarding is complete

✅ `12:12:37` Onboarding is complete  

## 1. Shell config defaults

✅ `12:12:37` Shell disabled by default  
✅ `12:12:37` At least one default policy exists  
✅ `12:12:37` Default policy ID is 'default'  

## 2. Enable shell globally

✅ `12:12:37` Enable shell returned ok: true  
✅ `12:12:38` Shell is now enabled  

## 3. Policy CRUD

✅ `12:12:38` Policy creation returned ok: true  
✅ `12:12:38` Policy has an ID  
ℹ️ `12:12:38` Created policy: e2e-test-policy  
✅ `12:12:38` Created policy found in listing  
✅ `12:12:38` Policy update returned ok: true  
✅ `12:12:38` Policy timeout updated to 600  
✅ `12:12:38` Cannot delete default policy (400)  
✅ `12:12:38` Policy deletion returned ok: true  
✅ `12:12:38` Deleted policy no longer in listing  

## 4. Policy validation

✅ `12:12:38` Empty policy name rejected with 400  
✅ `12:12:39` Invalid CIDR /99 rejected with 400  
✅ `12:12:39` Policy name > 100 chars rejected with 400  

## 5. REST API: enable/disable shell for agent cert

✅ `12:12:40` Agent cert creation returned ok: true  
✅ `12:12:40` Extracted agent PEM cert and key  
✅ `12:12:41` Shell enable for agent returned ok: true  
✅ `12:12:41` shellEnabledUntil is set  
ℹ️ `12:12:41` Shell enabled for agent e2e-shell-agent  
✅ `12:12:41` Agent sees global shell enabled  
✅ `12:12:41` Agent sees own shell enabled  
✅ `12:12:41` Agent-status returns correct label  
✅ `12:12:41` Agent sees shellEnabledUntil  
✅ `12:12:41` Shell disable for agent returned ok: true  
✅ `12:12:41` Agent sees shell disabled after disable  
✅ `12:12:41` Shell enable rejected when globally disabled (400)  

## 6. Install portlama-agent on VMs for integration test

ℹ️ `12:12:41` Packing portlama-agent tarball...  
✅ `12:12:42` portlama-agent tarball packed: /tmp/lamalibre-portlama-agent-1.0.6.tgz  
ℹ️ `12:12:42` Installing portlama-agent on agent VM...  
✅ `12:13:49` portlama-agent installed on agent VM  
✅ `12:13:49` tmux installed on agent VM  
ℹ️ `12:13:49` Installing portlama-agent on host VM...  
✅ `12:13:55` portlama-agent installed on host VM  

## 7. Configure and start shell-server on agent VM

✅ `12:13:55` Agent config written to /root/.portlama/agent.json  
✅ `12:13:55` Shell enabled for test-agent  
ℹ️ `12:13:55` Shell-server started on agent VM (PID: 10819)  
✅ `12:13:57` Shell-server connected to panel relay  

## 8. Full integration: admin connects and executes a command

✅ `12:13:57` Admin P12 created on host VM  
✅ `12:13:57` Test client script written to host VM  
ℹ️ `12:13:57` Session count before integration test: 0  
ℹ️ `12:13:57` Running WebSocket shell test client on host VM...  
ℹ️ `12:14:00` WebSocket test output:  
ℹ️ `12:14:00`   Connecting to: wss://127.0.0.1:9292/api/shell/connect/test-agent  
ℹ️ `12:14:00`   WebSocket connected to panel relay  
ℹ️ `12:14:00`   Received message type: connected  
ℹ️ `12:14:00`   Agent connected, relay active  
ℹ️ `12:14:00`   Received message type: session-started  
ℹ️ `12:14:00`   Session started: 69097eaa-271b-4f37-a17c-0d036f45fc48  
ℹ️ `12:14:00`   Received message type: output  
ℹ️ `12:14:00`   Sending test command...  
ℹ️ `12:14:00`   Received message type: output  
ℹ️ `12:14:00`   Received message type: output  
ℹ️ `12:14:00`   SUCCESS: Marker found in shell output  
ℹ️ `12:14:00`   Test passed — shell session completed successfully  
✅ `12:14:00` Full integration: admin connected, executed command, verified output  

## 9. Verify session audit log

✅ `12:14:02` New session entry created in audit log (before: 0, after: 1)  
✅ `12:14:02` Latest session belongs to agent: test-agent  
ℹ️ `12:14:02` Shell-server stopped on agent VM  

## 10. File transfer endpoints (501)

✅ `12:14:03` File download returns 501 (not yet implemented)  
✅ `12:14:03` File upload without path returns 400  

## 11. Input validation

✅ `12:14:03` Non-existent default policy rejected (400)  
✅ `12:14:03` durationMinutes=0 rejected (400)  
✅ `12:14:03` durationMinutes=9999 rejected (400)  
✅ `12:14:03` Shell enable for non-existent agent (404)  
✅ `12:14:03` Invalid label format rejected (400)  

## 12. Cleanup

✅ `12:14:04` Shell disabled after cleanup  
ℹ️ `12:14:04` Shell test cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `48` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `48` |

ℹ️ `12:14:04` Cleaning up shell test resources...  
🔵 `12:14:04` **Running: 11-plugin-lifecycle.sh**  
