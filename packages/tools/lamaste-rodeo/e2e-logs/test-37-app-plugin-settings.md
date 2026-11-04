# Lamaste E2E: 37 — App plugin settings and secrets (Three-VM)

> Started at `2026-11-04 14:00:46 UTC`


## Pre-flight

✅ `14:00:46` Onboarding is complete  
✅ `14:00:46` Agent test-agent is enrolled on the host  
✅ `14:00:47` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:00:47` The agent VM's lamaste-agent has the apphost command  
ℹ️ `14:00:47` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Fixtures, the stand-in Feria and the test secrets

✅ `14:00:48` Fixtures built: @lamalibre/e2e-apphost-cfg-server 1.0.0, 2.0.0 and 3.0.0 (settings v1, v2, v3) with their agent packages  
✅ `14:00:55` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-cfg-server, @lamalibre/e2e-apphost-cfg-agent )  
✅ `14:00:55` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:00:57` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T14:00:57.344Z"})  
✅ `14:00:57` …through its own OIDC client  
✅ `14:00:57` Test secret A: 48 hex characters, made on the host VM in a 0600 file  
✅ `14:00:58` Test secret B, for the CLI  
✅ `14:00:58` Their digests are known; the secrets never leave the host VM  
✅ `14:01:00` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  

## Install and host 1.0.0

✅ `14:01:03` Installed @lamalibre/e2e-apphost-cfg-server@1.0.0 and approved its agent half  
✅ `14:01:14` Hosted on test-agent ()  
✅ `14:01:34` The relay's health of the hosting is up  

## Before anything is configured

✅ `14:01:34` GET /api/plugins/e2e-apphost-cfg/settings answers  
✅ `14:01:34` It lists the manifest's fields  
✅ `14:01:34` …with their types  
✅ `14:01:34` …read live from the agent half  
✅ `14:01:34` …which the relay synced at 2026-11-04T14:01:34.634Z  
✅ `14:01:34` Not configured: apiKey is missing  
✅ `14:01:34` apiKey: { set: false }  
✅ `14:01:34` The other fields show their defaults (region has none)  
✅ `14:01:34` Revision 0  
✅ `14:01:34` The hosting: test-agent, up  
✅ `14:01:34` GET /api/plugins: e2e-apphost-cfg needs configuration (apiKey)  
✅ `14:01:35` GET /api/plugins/e2e-apphost-cfg says the same  
✅ `14:01:35` The agent half: schema 1, revision 0, not configured  
✅ `14:01:35` …and it holds no secret  
✅ `14:01:35` No settings.json or secrets.json yet: hosting takes no settings  

## Values that do not suit their fields are refused

✅ `14:01:35` Four values that do not suit their fields: 400  
✅ `14:01:35` A setting the schema does not know is counted under _: 1 unknown setting  
✅ `14:01:35` …never named: the errors are keyed by the schema's fields and _ alone  
✅ `14:01:35` apiKey in values: Is a secret; send it in secrets  
✅ `14:01:35` retries 987654321: Must be at most 10  
✅ `14:01:35` region: Must be one of the options  
✅ `14:01:35` The answer never repeats e2e-colour-6b1d  
✅ `14:01:35` The answer never repeats e2e-unknown-7f3a  
✅ `14:01:35` The answer never repeats e2e-misplaced-9b2e  
✅ `14:01:35` The answer never repeats 987654321  
✅ `14:01:35` The answer never repeats e2e-region-3f8a  
✅ `14:01:35` A schedule against its pattern passes the panel, which never runs a manifest's pattern, and is refused by the agent half (422)  
✅ `14:01:35` schedule: Does not match the required format  
✅ `14:01:35` …without repeating the value  
✅ `14:01:36` The agent half was asked once — for the pattern  
✅ `14:01:36` …and never for the values the panel refused  
✅ `14:01:36` Nothing changed in the agent half  

## A secret set through the API reaches the agent half alone

✅ `14:01:36` PUT /api/plugins/e2e-apphost-cfg/settings with secret A, from a 0600 file on the host VM: 200  
✅ `14:01:36` Revision 1, configured, nothing missing  
✅ `14:01:36` The answer says when apiKey was set, and nothing else about it  
✅ `14:01:36` GET: apiKey { set: true, setAt: 2026-11-04T14:01:36.817Z }  
✅ `14:01:36` GET: live, configured, region eu  
✅ `14:01:37` The agent half holds secret A: the SHA-256 of what it holds is secret A's  
✅ `14:01:37` …at revision 1, configured, region eu, retries still the default  
✅ `14:01:37` It saw the change (onChange), logged without a value  
✅ `14:01:37` GET /api/plugins: configured  
✅ `14:01:37` Audit: plugin.settings.updated with key names only (secretsSet apiKey, changed region)  

## A stale revision is refused; /admin/settings is not forwarded

✅ `14:01:37` An update edited at revision 0, now 1: 409  
✅ `14:01:37` …revision_mismatch, with the current revision  
✅ `14:01:38` GET /api/e2e-apphost-cfg/settings through the forwarder: 404  
✅ `14:01:38` GET /api/e2e-apphost-cfg/settings/reload through the forwarder: 404  
✅ `14:01:38` GET /api/e2e-apphost-cfg/Settings through the forwarder: 404  
✅ `14:01:38` GET /api/e2e-apphost-cfg/%73ettings through the forwarder: 404  
✅ `14:01:38` PUT /api/e2e-apphost-cfg/settings: 404 — no admin writes around the panel's checks  
✅ `14:01:38` POST /api/e2e-apphost-cfg/settings/reload: 404  
✅ `14:01:39` The agent half saw none of them  
✅ `14:01:39` …and nothing changed  

## lamaste-server plugins configure --secrets-stdin, its arguments sampled

✅ `14:01:40` plugins configure e2e-apphost-cfg --secrets-stdin --set retries=7 --set region=us, secret B on stdin (s
  verbose   boolean  false                         Verbose logging · default false

  Configured
  Read from the agent half
  Hosted on agent test-agent, up since 2026-11-04T14:01:31.824Z (8s ago))  
✅ `14:01:40` Its output holds no secret  
✅ `14:01:40` apiKey was set again (2026-11-04T14:01:40.307Z)  
✅ `14:01:40` …in one update with retries 7 and region us (revision 2)  
✅ `14:01:41` The agent half holds secret B  
✅ `14:01:42` plugins configure e2e-apphost-cfg --clear region (
  verbose   boolean  false                         Verbose logging · default false

  Configured
  Read from the agent half
  Hosted on agent test-agent, up since 2026-11-04T14:01:31.824Z (10s ago))  
✅ `14:01:42` region is unset again, it has no default (revision 3)  
✅ `14:01:43` --set apiKey=… is refused: a secret is never taken from the command line  
✅ `14:01:43` …the refusal points to --secrets-stdin  
✅ `14:01:43` …without repeating the value  
✅ `14:01:44` …and nothing changed  
✅ `14:01:45` plugins settings e2e-apphost-cfg --json  
✅ `14:01:45` …shows apiKey set  
✅ `14:01:45` …and no secret  
✅ `14:01:45` Every process's arguments were sampled throughout (42 samples)…  
✅ `14:01:45` …while lamaste-server configured the plugin (13 lines)  
✅ `14:01:45` No process had a test secret in its arguments — the CLI's curl included  
✅ `14:01:45` …or in its environment  
✅ `14:01:45` Audit: the CLI's update is recorded like the API's  

## On the agent VM: settings.json and secrets.json

✅ `14:01:45` settings.json: 0600, the account's  
✅ `14:01:45` secrets.json: 0600, the account's  
✅ `14:01:45` secrets.json holds apiKey…  
✅ `14:01:45` …whose value is secret B (by digest)  
✅ `14:01:45` settings.json: revision 3, the values set — retries; region was cleared — and no apiKey  
✅ `14:01:45` …retries recorded with its type: integer 7  
✅ `14:01:45` The secret is in no other file of the data directory, settings.json included  
✅ `14:01:45` …nor in the agent half's config or code  
✅ `14:01:45` …nor in the agent's own state and logs: it never went through the agent's sync  
✅ `14:01:45` …nor in the agent VM's journal  

## Update to 2.0.0: the schema change previewed, a retyped value dropped

✅ `14:01:46` 2.0.0 waits for approval: its agent half changed  
✅ `14:01:46` Preview: retries is retyped, integer to string — its value will be dropped  
✅ `14:01:46` Preview: endpoint becomes required  
✅ `14:01:46` Preview: endpoint added (a string), nothing removed  
✅ `14:01:46` Preview: no secret becomes a plain field  
✅ `14:01:46` GET /api/plugins/e2e-apphost-cfg/hooks shows the same preview  
✅ `14:01:51` The update succeeded ()  
✅ `14:01:51` The hosting is up on 2.0.0  
✅ `14:01:51` GET: the fields of 2.0.0  
✅ `14:01:51` It needs configuration again: endpoint is missing  
✅ `14:01:51` retries is the string "3", 2.0.0's default: the stored 7 was dropped, not converted  
✅ `14:01:51` The secret stays set, as it was  
✅ `14:01:51` GET /api/plugins: needs configuration (endpoint)  
✅ `14:01:51` The agent half: schema 2, revision 3 — the update changed no value an admin set  
✅ `14:01:51` It dropped the retyped value from its store  
✅ `14:01:51` …and kept secret B  
✅ `14:01:51` settings.json on the agent VM: schema 2, no retries  
✅ `14:01:52` endpoint filled in  
✅ `14:01:52` …configured again (revision 4)  

## Unhosting keeps the settings; hosting again brings them back

✅ `14:01:59` Unhosted, the data kept ()  
✅ `14:01:59` settings.json and secrets.json stay in the kept data directory  
✅ `14:01:59` …secret B with them  
✅ `14:02:00` Not hosted: a change is refused (503)  
✅ `14:02:00` …hosting_offline  
✅ `14:02:10` Hosted again ()  
✅ `14:02:23` The hosting is up again  
✅ `14:02:23` Read live: revision 4, configured — the settings came back  
✅ `14:02:23` …the same values, the same secret  
✅ `14:02:23` The agent half holds secret B again  

## The test secrets are nowhere on the relay

✅ `14:02:24` No file under /etc/lamalibre, /var/lib/lamalibre, /opt/lamalibre, /var/log, /tmp or /run holds one  
✅ `14:02:24` …a search that finds what is there (31 files under /etc/lamalibre name the plugin)  
✅ `14:02:24` state.db, dumped, holds none  
✅ `14:02:24` …a dump of 653 lines, plugin_settings in it  
✅ `14:02:24` The host's journal since the spec started holds none (1331 lines)  
✅ `14:02:24` No API answer the spec read holds one (35 answers: settings, plugins, hosting, hooks, operations, audit log, agents, notifications)  
✅ `14:02:24` The relay's cache (plugin_settings): revision 4, configured  
✅ `14:02:24` …which keeps when apiKey was set, a timestamp  
✅ `14:02:24` …and no apiKey among its values  

## Update to 3.0.0: a secret turned plain waits for the admin, auto-approve or not

✅ `14:02:24` Auto-approve is on for e2e-apphost-cfg  
✅ `14:02:25` 3.0.0 is staged and waits for approval, auto-approve on  
✅ `14:02:25` Preview: apiKey turns from a secret into a plain field (secretToPlain)  
✅ `14:02:25` …retyped secret to string  
✅ `14:02:25` It waits for approval because a secret turns plain (approvalRequired: settings.secret-to-plain)  
✅ `14:02:25` Auto-approve withheld: it turns secret settings into plain ones (apiKey) — what is typed into them next is kept on the relay and shown in clear  
✅ `14:02:25` Audit: hooks.auto-approve.withheld, settings.secret-to-plain  
✅ `14:02:25` GET /api/plugins/e2e-apphost-cfg/hooks shows it pending  
✅ `14:02:25` Until it is approved, 2.0.0 stays…  
✅ `14:02:25` …and the agent half holds secret B, schema 2  
✅ `14:02:33` Approved by the admin, the update to 3.0.0 succeeded ()  
✅ `14:02:33` The hosting is up on 3.0.0  
✅ `14:02:33` The agent half, schema 3, dropped the secret: no apiKey secret, no apiKey value — never moved into its settings  
✅ `14:02:33` On the agent VM: settings.json (schema 3) has no apiKey, secrets.json no longer holds it  
✅ `14:02:34` GET settings: apiKey is a plain string field…  
✅ `14:02:34` …without a value  
✅ `14:02:34` …and the plugin needs configuration: apiKey is missing  
✅ `14:02:34` GET /api/plugins: needs configuration (apiKey)  
✅ `14:02:34` The relay's cache: schema 3, no secret, no apiKey value  
✅ `14:02:35` Secret B (and A) is on no relay file, in no state.db row, journal line or answer after the update  

## Uninstalling with purge removes the settings on both sides

✅ `14:02:43` Uninstalled with purge ()  
✅ `14:02:43` GET settings: 404, the plugin is gone  
✅ `14:02:43` No plugin_settings row left on the relay  
✅ `14:02:43` No data directory on the agent VM: settings.json and secrets.json are gone  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `159` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `159` |

ℹ️ `14:02:43` Cleaning up test resources...  
