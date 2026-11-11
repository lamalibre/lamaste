# Lamaste E2E: 37 — App plugin settings and secrets (Three-VM)

> Started at `2026-11-11 11:00:32 UTC`


## Pre-flight

✅ `11:00:32` Onboarding is complete  
✅ `11:00:32` Agent test-agent is enrolled on the host  
✅ `11:00:32` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `11:00:33` The agent VM's lamaste-agent has the apphost command  
ℹ️ `11:00:33` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Fixtures, the stand-in Feria and the test secrets

✅ `11:00:33` Fixtures built: @lamalibre/e2e-apphost-cfg-server 1.0.0, 2.0.0 and 3.0.0 (settings v1, v2, v3) with their agent packages  
✅ `11:00:56` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-cfg-server, @lamalibre/e2e-apphost-cfg-agent )  
✅ `11:00:57` The agent VM reaches it at http://10.13.37.1:4874  
✅ `11:00:58` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T11:00:58.137Z"})  
✅ `11:00:58` …through its own OIDC client  
✅ `11:00:58` Test secret A: 48 hex characters, made on the host VM in a 0600 file  
✅ `11:00:58` Test secret B, for the CLI  
✅ `11:00:58` Their digests are known; the secrets never leave the host VM  
✅ `11:00:59` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  

## Install and host 1.0.0

✅ `11:01:05` Installed @lamalibre/e2e-apphost-cfg-server@1.0.0 and approved its agent half  
✅ `11:01:15` Hosted on test-agent ()  
✅ `11:01:32` The relay's health of the hosting is up  

## Before anything is configured

✅ `11:01:32` GET /api/plugins/e2e-apphost-cfg/settings answers  
✅ `11:01:32` It lists the manifest's fields  
✅ `11:01:32` …with their types  
✅ `11:01:32` …read live from the agent half  
✅ `11:01:32` …which the relay synced at 2026-11-11T11:01:32.895Z  
✅ `11:01:32` Not configured: apiKey is missing  
✅ `11:01:32` apiKey: { set: false }  
✅ `11:01:32` The other fields show their defaults (region has none)  
✅ `11:01:32` Revision 0  
✅ `11:01:33` The hosting: test-agent, up  
✅ `11:01:33` GET /api/plugins: e2e-apphost-cfg needs configuration (apiKey)  
✅ `11:01:33` GET /api/plugins/e2e-apphost-cfg says the same  
✅ `11:01:33` The agent half: schema 1, revision 0, not configured  
✅ `11:01:33` …and it holds no secret  
✅ `11:01:33` No settings.json or secrets.json yet: hosting takes no settings  

## Values that do not suit their fields are refused

✅ `11:01:34` Four values that do not suit their fields: 400  
✅ `11:01:34` A setting the schema does not know is counted under _: 1 unknown setting  
✅ `11:01:34` …never named: the errors are keyed by the schema's fields and _ alone  
✅ `11:01:34` apiKey in values: Is a secret; send it in secrets  
✅ `11:01:34` retries 987654321: Must be at most 10  
✅ `11:01:34` region: Must be one of the options  
✅ `11:01:34` The answer never repeats e2e-colour-6b1d  
✅ `11:01:34` The answer never repeats e2e-unknown-7f3a  
✅ `11:01:34` The answer never repeats e2e-misplaced-9b2e  
✅ `11:01:34` The answer never repeats 987654321  
✅ `11:01:34` The answer never repeats e2e-region-3f8a  
✅ `11:01:34` A schedule against its pattern passes the panel, which never runs a manifest's pattern, and is refused by the agent half (422)  
✅ `11:01:34` schedule: Does not match the required format  
✅ `11:01:34` …without repeating the value  
✅ `11:01:34` The agent half was asked once — for the pattern  
✅ `11:01:34` …and never for the values the panel refused  
✅ `11:01:34` Nothing changed in the agent half  

## A secret set through the API reaches the agent half alone

✅ `11:01:35` PUT /api/plugins/e2e-apphost-cfg/settings with secret A, from a 0600 file on the host VM: 200  
✅ `11:01:35` Revision 1, configured, nothing missing  
✅ `11:01:35` The answer says when apiKey was set, and nothing else about it  
✅ `11:01:35` GET: apiKey { set: true, setAt: 2026-11-11T11:01:35.165Z }  
✅ `11:01:35` GET: live, configured, region eu  
✅ `11:01:35` The agent half holds secret A: the SHA-256 of what it holds is secret A's  
✅ `11:01:35` …at revision 1, configured, region eu, retries still the default  
✅ `11:01:35` It saw the change (onChange), logged without a value  
✅ `11:01:36` GET /api/plugins: configured  
✅ `11:01:36` Audit: plugin.settings.updated with key names only (secretsSet apiKey, changed region)  

## A stale revision is refused; /admin/settings is not forwarded

✅ `11:01:36` An update edited at revision 0, now 1: 409  
✅ `11:01:36` …revision_mismatch, with the current revision  
✅ `11:01:37` GET /api/e2e-apphost-cfg/settings through the forwarder: 404  
✅ `11:01:37` GET /api/e2e-apphost-cfg/settings/reload through the forwarder: 404  
✅ `11:01:37` GET /api/e2e-apphost-cfg/Settings through the forwarder: 404  
✅ `11:01:37` GET /api/e2e-apphost-cfg/%73ettings through the forwarder: 404  
✅ `11:01:38` PUT /api/e2e-apphost-cfg/settings: 404 — no admin writes around the panel's checks  
✅ `11:01:38` POST /api/e2e-apphost-cfg/settings/reload: 404  
✅ `11:01:38` The agent half saw none of them  
✅ `11:01:38` …and nothing changed  

## lamaste-server plugins configure --secrets-stdin, its arguments sampled

✅ `11:01:39` plugins configure e2e-apphost-cfg --secrets-stdin --set retries=7 --set region=us, secret B on stdin (s
  verbose   boolean  false                         Verbose logging · default false

  Configured
  Read from the agent half
  Hosted on agent test-agent, up since 2026-11-11T11:01:30.086Z (9s ago))  
✅ `11:01:39` Its output holds no secret  
✅ `11:01:39` apiKey was set again (2026-11-11T11:01:39.264Z)  
✅ `11:01:39` …in one update with retries 7 and region us (revision 2)  
✅ `11:01:39` The agent half holds secret B  
✅ `11:01:40` plugins configure e2e-apphost-cfg --clear region (
  verbose   boolean  false                         Verbose logging · default false

  Configured
  Read from the agent half
  Hosted on agent test-agent, up since 2026-11-11T11:01:30.086Z (10s ago))  
✅ `11:01:41` region is unset again, it has no default (revision 3)  
✅ `11:01:42` --set apiKey=… is refused: a secret is never taken from the command line  
✅ `11:01:42` …the refusal points to --secrets-stdin  
✅ `11:01:42` …without repeating the value  
✅ `11:01:42` …and nothing changed  
✅ `11:01:43` plugins settings e2e-apphost-cfg --json  
✅ `11:01:43` …shows apiKey set  
✅ `11:01:43` …and no secret  
✅ `11:01:43` Every process's arguments were sampled throughout (44 samples)…  
✅ `11:01:43` …while lamaste-server configured the plugin (11 lines)  
✅ `11:01:43` No process had a test secret in its arguments — the CLI's curl included  
✅ `11:01:43` …or in its environment  
✅ `11:01:43` Audit: the CLI's update is recorded like the API's  

## On the agent VM: settings.json and secrets.json

✅ `11:01:43` settings.json: 0600, the account's  
✅ `11:01:43` secrets.json: 0600, the account's  
✅ `11:01:43` secrets.json holds apiKey…  
✅ `11:01:43` …whose value is secret B (by digest)  
✅ `11:01:43` settings.json: revision 3, the values set — retries; region was cleared — and no apiKey  
✅ `11:01:43` …retries recorded with its type: integer 7  
✅ `11:01:43` The secret is in no other file of the data directory, settings.json included  
✅ `11:01:43` …nor in the agent half's config or code  
✅ `11:01:44` …nor in the agent's own state and logs: it never went through the agent's sync  
✅ `11:01:44` …nor in the agent VM's journal  

## Update to 2.0.0: the schema change previewed, a retyped value dropped

✅ `11:01:44` 2.0.0 waits for approval: its agent half changed  
✅ `11:01:44` Preview: retries is retyped, integer to string — its value will be dropped  
✅ `11:01:44` Preview: endpoint becomes required  
✅ `11:01:44` Preview: endpoint added (a string), nothing removed  
✅ `11:01:44` Preview: no secret becomes a plain field  
✅ `11:01:44` GET /api/plugins/e2e-apphost-cfg/hooks shows the same preview  
✅ `11:01:52` The update succeeded ()  
✅ `11:01:52` The hosting is up on 2.0.0  
✅ `11:01:53` GET: the fields of 2.0.0  
✅ `11:01:53` It needs configuration again: endpoint is missing  
✅ `11:01:53` retries is the string "3", 2.0.0's default: the stored 7 was dropped, not converted  
✅ `11:01:53` The secret stays set, as it was  
✅ `11:01:53` GET /api/plugins: needs configuration (endpoint)  
✅ `11:01:53` The agent half: schema 2, revision 3 — the update changed no value an admin set  
✅ `11:01:53` It dropped the retyped value from its store  
✅ `11:01:53` …and kept secret B  
✅ `11:01:53` settings.json on the agent VM: schema 2, no retries  
✅ `11:01:53` endpoint filled in  
✅ `11:01:53` …configured again (revision 4)  

## Unhosting keeps the settings; hosting again brings them back

✅ `11:02:04` Unhosted, the data kept ()  
✅ `11:02:05` settings.json and secrets.json stay in the kept data directory  
✅ `11:02:05` …secret B with them  
✅ `11:02:05` Not hosted: a change is refused (503)  
✅ `11:02:05` …hosting_offline  
✅ `11:02:16` Hosted again ()  
✅ `11:02:32` The hosting is up again  
✅ `11:02:33` Read live: revision 4, configured — the settings came back  
✅ `11:02:33` …the same values, the same secret  
✅ `11:02:33` The agent half holds secret B again  

## The test secrets are nowhere on the relay

✅ `11:02:34` No file under /etc/lamalibre, /var/lib/lamalibre, /opt/lamalibre, /var/log, /tmp or /run holds one  
✅ `11:02:34` …a search that finds what is there (31 files under /etc/lamalibre name the plugin)  
✅ `11:02:34` state.db, dumped, holds none  
✅ `11:02:34` …a dump of 1929 lines, plugin_settings in it  
✅ `11:02:34` The host's journal since the spec started holds none (1523 lines)  
✅ `11:02:34` No API answer the spec read holds one (35 answers: settings, plugins, hosting, hooks, operations, audit log, agents, notifications)  
✅ `11:02:34` The relay's cache (plugin_settings): revision 4, configured  
✅ `11:02:34` …which keeps when apiKey was set, a timestamp  
✅ `11:02:34` …and no apiKey among its values  

## Update to 3.0.0: a secret turned plain waits for the admin, auto-approve or not

✅ `11:02:34` Auto-approve is on for e2e-apphost-cfg  
✅ `11:02:35` 3.0.0 is staged and waits for approval, auto-approve on  
✅ `11:02:35` Preview: apiKey turns from a secret into a plain field (secretToPlain)  
✅ `11:02:35` …retyped secret to string  
✅ `11:02:35` It waits for approval because a secret turns plain (approvalRequired: settings.secret-to-plain)  
✅ `11:02:35` Auto-approve withheld: it turns secret settings into plain ones (apiKey) — what is typed into them next is kept on the relay and shown in clear  
✅ `11:02:35` Audit: hooks.auto-approve.withheld, settings.secret-to-plain  
✅ `11:02:35` GET /api/plugins/e2e-apphost-cfg/hooks shows it pending  
✅ `11:02:35` Until it is approved, 2.0.0 stays…  
✅ `11:02:36` …and the agent half holds secret B, schema 2  
✅ `11:02:43` Approved by the admin, the update to 3.0.0 succeeded ()  
✅ `11:02:44` The hosting is up on 3.0.0  
✅ `11:02:44` The agent half, schema 3, dropped the secret: no apiKey secret, no apiKey value — never moved into its settings  
✅ `11:02:44` On the agent VM: settings.json (schema 3) has no apiKey, secrets.json no longer holds it  
✅ `11:02:44` GET settings: apiKey is a plain string field…  
✅ `11:02:44` …without a value  
✅ `11:02:44` …and the plugin needs configuration: apiKey is missing  
✅ `11:02:44` GET /api/plugins: needs configuration (apiKey)  
✅ `11:02:44` The relay's cache: schema 3, no secret, no apiKey value  
✅ `11:02:45` Secret B (and A) is on no relay file, in no state.db row, journal line or answer after the update  

## Uninstalling with purge removes the settings on both sides

✅ `11:02:57` Uninstalled with purge ()  
✅ `11:02:57` GET settings: 404, the plugin is gone  
✅ `11:02:57` No plugin_settings row left on the relay  
✅ `11:02:57` No data directory on the agent VM: settings.json and secrets.json are gone  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `159` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `159` |

ℹ️ `11:02:57` Cleaning up test resources...  
