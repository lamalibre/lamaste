# Lamaste E2E: 37 — App plugin settings and secrets (Three-VM)

> Started at `2026-11-10 18:13:16 UTC`


## Pre-flight

✅ `18:13:16` Onboarding is complete  
✅ `18:13:17` Agent test-agent is enrolled on the host  
✅ `18:13:17` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `18:13:17` The agent VM's lamaste-agent has the apphost command  
ℹ️ `18:13:17` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Fixtures, the stand-in Feria and the test secrets

✅ `18:13:18` Fixtures built: @lamalibre/e2e-apphost-cfg-server 1.0.0, 2.0.0 and 3.0.0 (settings v1, v2, v3) with their agent packages  
✅ `18:13:40` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-cfg-server, @lamalibre/e2e-apphost-cfg-agent )  
✅ `18:13:41` The agent VM reaches it at http://10.13.37.1:4874  
✅ `18:13:42` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T18:13:42.165Z"})  
✅ `18:13:42` …through its own OIDC client  
✅ `18:13:42` Test secret A: 48 hex characters, made on the host VM in a 0600 file  
✅ `18:13:42` Test secret B, for the CLI  
✅ `18:13:42` Their digests are known; the secrets never leave the host VM  
✅ `18:13:43` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  

## Install and host 1.0.0

✅ `18:13:48` Installed @lamalibre/e2e-apphost-cfg-server@1.0.0 and approved its agent half  
✅ `18:13:59` Hosted on test-agent ()  
✅ `18:14:16` The relay's health of the hosting is up  

## Before anything is configured

✅ `18:14:16` GET /api/plugins/e2e-apphost-cfg/settings answers  
✅ `18:14:16` It lists the manifest's fields  
✅ `18:14:16` …with their types  
✅ `18:14:16` …read live from the agent half  
✅ `18:14:16` …which the relay synced at 2026-11-10T18:14:16.860Z  
✅ `18:14:16` Not configured: apiKey is missing  
✅ `18:14:16` apiKey: { set: false }  
✅ `18:14:16` The other fields show their defaults (region has none)  
✅ `18:14:16` Revision 0  
✅ `18:14:16` The hosting: test-agent, up  
✅ `18:14:17` GET /api/plugins: e2e-apphost-cfg needs configuration (apiKey)  
✅ `18:14:17` GET /api/plugins/e2e-apphost-cfg says the same  
✅ `18:14:17` The agent half: schema 1, revision 0, not configured  
✅ `18:14:17` …and it holds no secret  
✅ `18:14:17` No settings.json or secrets.json yet: hosting takes no settings  

## Values that do not suit their fields are refused

✅ `18:14:18` Four values that do not suit their fields: 400  
✅ `18:14:18` A setting the schema does not know is counted under _: 1 unknown setting  
✅ `18:14:18` …never named: the errors are keyed by the schema's fields and _ alone  
✅ `18:14:18` apiKey in values: Is a secret; send it in secrets  
✅ `18:14:18` retries 987654321: Must be at most 10  
✅ `18:14:18` region: Must be one of the options  
✅ `18:14:18` The answer never repeats e2e-colour-6b1d  
✅ `18:14:18` The answer never repeats e2e-unknown-7f3a  
✅ `18:14:18` The answer never repeats e2e-misplaced-9b2e  
✅ `18:14:18` The answer never repeats 987654321  
✅ `18:14:18` The answer never repeats e2e-region-3f8a  
✅ `18:14:18` A schedule against its pattern passes the panel, which never runs a manifest's pattern, and is refused by the agent half (422)  
✅ `18:14:18` schedule: Does not match the required format  
✅ `18:14:18` …without repeating the value  
✅ `18:14:18` The agent half was asked once — for the pattern  
✅ `18:14:18` …and never for the values the panel refused  
✅ `18:14:18` Nothing changed in the agent half  

## A secret set through the API reaches the agent half alone

✅ `18:14:19` PUT /api/plugins/e2e-apphost-cfg/settings with secret A, from a 0600 file on the host VM: 200  
✅ `18:14:19` Revision 1, configured, nothing missing  
✅ `18:14:19` The answer says when apiKey was set, and nothing else about it  
✅ `18:14:19` GET: apiKey { set: true, setAt: 2026-11-10T18:14:19.166Z }  
✅ `18:14:19` GET: live, configured, region eu  
✅ `18:14:19` The agent half holds secret A: the SHA-256 of what it holds is secret A's  
✅ `18:14:19` …at revision 1, configured, region eu, retries still the default  
✅ `18:14:19` It saw the change (onChange), logged without a value  
✅ `18:14:20` GET /api/plugins: configured  
✅ `18:14:20` Audit: plugin.settings.updated with key names only (secretsSet apiKey, changed region)  

## A stale revision is refused; /admin/settings is not forwarded

✅ `18:14:20` An update edited at revision 0, now 1: 409  
✅ `18:14:20` …revision_mismatch, with the current revision  
✅ `18:14:21` GET /api/e2e-apphost-cfg/settings through the forwarder: 404  
✅ `18:14:21` GET /api/e2e-apphost-cfg/settings/reload through the forwarder: 404  
✅ `18:14:21` GET /api/e2e-apphost-cfg/Settings through the forwarder: 404  
✅ `18:14:21` GET /api/e2e-apphost-cfg/%73ettings through the forwarder: 404  
✅ `18:14:21` PUT /api/e2e-apphost-cfg/settings: 404 — no admin writes around the panel's checks  
✅ `18:14:21` POST /api/e2e-apphost-cfg/settings/reload: 404  
✅ `18:14:22` The agent half saw none of them  
✅ `18:14:22` …and nothing changed  

## lamaste-server plugins configure --secrets-stdin, its arguments sampled

✅ `18:14:23` plugins configure e2e-apphost-cfg --secrets-stdin --set retries=7 --set region=us, secret B on stdin (s
  verbose   boolean  false                         Verbose logging · default false

  Configured
  Read from the agent half
  Hosted on agent test-agent, up since 2026-11-10T18:14:14.192Z (8s ago))  
✅ `18:14:23` Its output holds no secret  
✅ `18:14:23` apiKey was set again (2026-11-10T18:14:23.000Z)  
✅ `18:14:23` …in one update with retries 7 and region us (revision 2)  
✅ `18:14:23` The agent half holds secret B  
✅ `18:14:24` plugins configure e2e-apphost-cfg --clear region (
  verbose   boolean  false                         Verbose logging · default false

  Configured
  Read from the agent half
  Hosted on agent test-agent, up since 2026-11-10T18:14:14.192Z (10s ago))  
✅ `18:14:24` region is unset again, it has no default (revision 3)  
✅ `18:14:25` --set apiKey=… is refused: a secret is never taken from the command line  
✅ `18:14:25` …the refusal points to --secrets-stdin  
✅ `18:14:25` …without repeating the value  
✅ `18:14:26` …and nothing changed  
✅ `18:14:26` plugins settings e2e-apphost-cfg --json  
✅ `18:14:26` …shows apiKey set  
✅ `18:14:26` …and no secret  
✅ `18:14:27` Every process's arguments were sampled throughout (46 samples)…  
✅ `18:14:27` …while lamaste-server configured the plugin (11 lines)  
✅ `18:14:27` No process had a test secret in its arguments — the CLI's curl included  
✅ `18:14:27` …or in its environment  
✅ `18:14:27` Audit: the CLI's update is recorded like the API's  

## On the agent VM: settings.json and secrets.json

✅ `18:14:27` settings.json: 0600, the account's  
✅ `18:14:27` secrets.json: 0600, the account's  
✅ `18:14:27` secrets.json holds apiKey…  
✅ `18:14:27` …whose value is secret B (by digest)  
✅ `18:14:27` settings.json: revision 3, the values set — retries; region was cleared — and no apiKey  
✅ `18:14:27` …retries recorded with its type: integer 7  
✅ `18:14:27` The secret is in no other file of the data directory, settings.json included  
✅ `18:14:27` …nor in the agent half's config or code  
✅ `18:14:27` …nor in the agent's own state and logs: it never went through the agent's sync  
✅ `18:14:27` …nor in the agent VM's journal  

## Update to 2.0.0: the schema change previewed, a retyped value dropped

✅ `18:14:28` 2.0.0 waits for approval: its agent half changed  
✅ `18:14:28` Preview: retries is retyped, integer to string — its value will be dropped  
✅ `18:14:28` Preview: endpoint becomes required  
✅ `18:14:28` Preview: endpoint added (a string), nothing removed  
✅ `18:14:28` Preview: no secret becomes a plain field  
✅ `18:14:28` GET /api/plugins/e2e-apphost-cfg/hooks shows the same preview  
✅ `18:14:36` The update succeeded ()  
✅ `18:14:36` The hosting is up on 2.0.0  
✅ `18:14:36` GET: the fields of 2.0.0  
✅ `18:14:36` It needs configuration again: endpoint is missing  
✅ `18:14:36` retries is the string "3", 2.0.0's default: the stored 7 was dropped, not converted  
✅ `18:14:36` The secret stays set, as it was  
✅ `18:14:36` GET /api/plugins: needs configuration (endpoint)  
✅ `18:14:36` The agent half: schema 2, revision 3 — the update changed no value an admin set  
✅ `18:14:36` It dropped the retyped value from its store  
✅ `18:14:36` …and kept secret B  
✅ `18:14:36` settings.json on the agent VM: schema 2, no retries  
✅ `18:14:37` endpoint filled in  
✅ `18:14:37` …configured again (revision 4)  

## Unhosting keeps the settings; hosting again brings them back

✅ `18:14:47` Unhosted, the data kept ()  
✅ `18:14:47` settings.json and secrets.json stay in the kept data directory  
✅ `18:14:48` …secret B with them  
✅ `18:14:48` Not hosted: a change is refused (503)  
✅ `18:14:48` …hosting_offline  
✅ `18:14:58` Hosted again ()  
✅ `18:15:15` The hosting is up again  
✅ `18:15:15` Read live: revision 4, configured — the settings came back  
✅ `18:15:15` …the same values, the same secret  
✅ `18:15:15` The agent half holds secret B again  

## The test secrets are nowhere on the relay

✅ `18:15:16` No file under /etc/lamalibre, /var/lib/lamalibre, /opt/lamalibre, /var/log, /tmp or /run holds one  
✅ `18:15:16` …a search that finds what is there (31 files under /etc/lamalibre name the plugin)  
✅ `18:15:16` state.db, dumped, holds none  
✅ `18:15:16` …a dump of 688 lines, plugin_settings in it  
✅ `18:15:16` The host's journal since the spec started holds none (1527 lines)  
✅ `18:15:16` No API answer the spec read holds one (35 answers: settings, plugins, hosting, hooks, operations, audit log, agents, notifications)  
✅ `18:15:17` The relay's cache (plugin_settings): revision 4, configured  
✅ `18:15:17` …which keeps when apiKey was set, a timestamp  
✅ `18:15:17` …and no apiKey among its values  

## Update to 3.0.0: a secret turned plain waits for the admin, auto-approve or not

✅ `18:15:17` Auto-approve is on for e2e-apphost-cfg  
✅ `18:15:17` 3.0.0 is staged and waits for approval, auto-approve on  
✅ `18:15:17` Preview: apiKey turns from a secret into a plain field (secretToPlain)  
✅ `18:15:17` …retyped secret to string  
✅ `18:15:17` It waits for approval because a secret turns plain (approvalRequired: settings.secret-to-plain)  
✅ `18:15:17` Auto-approve withheld: it turns secret settings into plain ones (apiKey) — what is typed into them next is kept on the relay and shown in clear  
✅ `18:15:18` Audit: hooks.auto-approve.withheld, settings.secret-to-plain  
✅ `18:15:18` GET /api/plugins/e2e-apphost-cfg/hooks shows it pending  
✅ `18:15:18` Until it is approved, 2.0.0 stays…  
✅ `18:15:18` …and the agent half holds secret B, schema 2  
✅ `18:15:26` Approved by the admin, the update to 3.0.0 succeeded ()  
✅ `18:15:26` The hosting is up on 3.0.0  
✅ `18:15:26` The agent half, schema 3, dropped the secret: no apiKey secret, no apiKey value — never moved into its settings  
✅ `18:15:26` On the agent VM: settings.json (schema 3) has no apiKey, secrets.json no longer holds it  
✅ `18:15:27` GET settings: apiKey is a plain string field…  
✅ `18:15:27` …without a value  
✅ `18:15:27` …and the plugin needs configuration: apiKey is missing  
✅ `18:15:27` GET /api/plugins: needs configuration (apiKey)  
✅ `18:15:27` The relay's cache: schema 3, no secret, no apiKey value  
✅ `18:15:28` Secret B (and A) is on no relay file, in no state.db row, journal line or answer after the update  

## Uninstalling with purge removes the settings on both sides

✅ `18:15:39` Uninstalled with purge ()  
✅ `18:15:39` GET settings: 404, the plugin is gone  
✅ `18:15:39` No plugin_settings row left on the relay  
✅ `18:15:39` No data directory on the agent VM: settings.json and secrets.json are gone  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `159` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `159` |

ℹ️ `18:15:39` Cleaning up test resources...  
