# Lamaste E2E: 34 — App plugin installed onto an agent from the panel (Three-VM)

> Started at `2026-11-02 16:01:24 UTC`


## Pre-flight

✅ `16:01:24` Onboarding is complete  
✅ `16:01:24` Agent test-agent is enrolled on the host  
✅ `16:01:24` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `16:01:25` The agent VM's lamaste-agent has the apphost command  
ℹ️ `16:01:25` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Stand-in Feria and the panel's registry credential

✅ `16:01:25` Fixture built: @lamalibre/e2e-apphost-server and its bundled agent package @lamalibre/e2e-apphost-agent 1.0.0  
✅ `16:01:27` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-server, @lamalibre/e2e-apphost-agent )  
✅ `16:01:27` The agent VM reaches it at http://10.13.37.1:4874  
✅ `16:01:29` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-02T16:01:29.376Z"})  
✅ `16:01:29` …through its own OIDC client  
✅ `16:01:29` The stand-in Feria publishes @lamalibre/e2e-apphost-agent@1.0.0 with a sha512 integrity  

## Install: the agent half is pinned and shown for approval

ℹ️ `16:01:29` sqlite3 on the agent VM before: absent  
✅ `16:01:31` Installed @lamalibre/e2e-apphost-server@1.0.0 from the stand-in Feria  
✅ `16:01:31` …an agent-hosted plugin  
✅ `16:01:31` Preview: the agent package Lamaste installs  
✅ `16:01:31` Preview: at the plugin's version  
✅ `16:01:31` Preview: the tarball integrity, pinned from the registry at install  
✅ `16:01:31` Preview: the system package it brings  
✅ `16:01:31` Preview: the service account  
✅ `16:01:31` Preview: the unit  
✅ `16:01:31` Preview: the service entry and its memory limit  
✅ `16:01:31` Its approval is pending  
✅ `16:01:31` GET /plugins/e2e-apphost/hooks shows the same agent half  

## Refused before approval and on an agent that cannot host it

✅ `16:01:31` Hosting an unapproved agent half is refused (409)  
✅ `16:01:31` …hooks_not_approved  
✅ `16:01:32` Approved with the digest the preview showed  
✅ `16:01:32` The relay holds the agent's current host facts  
✅ `16:01:32` Eligibility: test-agent cannot host it yet  
✅ `16:01:32` …the app host helper is not enabled  
✅ `16:01:32` Hosting on it is refused (409)  
✅ `16:01:32` …agent_not_eligible, with the reasons  

## The operator's step: lamaste-agent apphost enable

✅ `16:01:32` The relay signs with key 9bc3bdf58b3553d77f5d1858593182ed  
✅ `16:01:32` apphost enable --user root (2,"node":"22.23.4","sudoers":null,"user":"root","relays":[{"label":"e2e-agent","kid":"9bc3bdf58b3553d77f5d1858593182ed","agent":"test-agent","panelUrl":"https://10.13.37.1:9292","previousKid":null}]})  
✅ `16:01:32` …installed the helper, protocol 2  
✅ `16:01:32` …and no sudoers rule: the agent runs as root  
✅ `16:01:32` …and pinned the relay's key for e2e-agent, with the name the relay knows it by  
✅ `16:01:33` GET /api/agents/me/relay-keys, from the agent: the key the relay signs with  
✅ `16:01:33` apphost status: e2e-agent has that key pinned  
✅ `16:01:33` …in /etc/lamalibre/apphost/relays/e2e-agent.json, root:root 0644  
✅ `16:01:33` apphost status: the helper is installed  
✅ `16:01:33` …the one this lamaste-agent ships  
✅ `16:01:33` …on /usr/bin/node 22.23.4, what the agent halves run on  
✅ `16:01:33` /usr/local/sbin/lamaste-apphost is root:root 0755  
✅ `16:01:33` No /etc/sudoers.d/lamaste-apphost for a root agent  
✅ `16:01:59` The agent's sync reported the helper to the relay  
✅ `16:01:59` Host facts: Linux, systemd  
✅ `16:01:59` Host facts: helper protocol 2  
✅ `16:01:59` Host facts: the helper's Node.js  
✅ `16:01:59` Host facts: the relay key the helper verifies jobs with  
✅ `16:01:59` Host facts: a Debian-family distribution (ubuntu 24.04)  
✅ `16:02:00` Eligibility: test-agent can host it now  

## Refused by the push-install gates; the window opened

✅ `16:02:00` Push-install off: hosting is refused  
✅ `16:02:00` …push_install_refused (Push install is not enabled globally)  
✅ `16:02:00` Push-install on, the agent's window closed: hosting is refused  
✅ `16:02:00` …push_install_refused (Push install access not enabled for agent "test-agent")  
✅ `16:02:01` The agent's window is open, under a policy naming only @lamalibre/e2e-apphost-agent  

## Hosting: nothing more is done on the agent VM

✅ `16:02:01` Hosting on test-agent started (operation 0be7ccb8-c44f-4887-bca7-c2bd16bebf55)  
✅ `16:03:46` The hosting operation succeeded ()  
✅ `16:03:46` Step: reserve port, secret and capability  
✅ `16:03:46` Step: install the agent half  
✅ `16:03:46` Step: agent install:pre-tunnel  
✅ `16:03:46` Step: grant the tunnel and wait for the agent half  
✅ `16:03:46` Step: agent install:post-tunnel  
✅ `16:03:46` Step: activate  
✅ `16:03:46` The agent half was installed before its first hook ran  
✅ `16:03:46` The hosting is active  
✅ `16:03:46` The relay records agent half 1.0.0 on test-agent  
✅ `16:03:46` Port 21000 assigned from the internal range  
✅ `16:03:46` The push is in the push-install session log  
✅ `16:03:47` Audit: plugin.agent-half.installed, with the pinned integrity  
✅ `16:03:47` The agent's sync ran the app-install job (sync.log)  
✅ `16:03:47` …then the pre-tunnel hook job  
✅ `16:03:47` The installed service answered install:pre-tunnel (its journal)  
✅ `16:03:47` …and install:post-tunnel through the tunnel  

## On the agent VM: account, files, unit, system package

✅ `16:03:47` lamalibre-app-e2e-apphost.service is active and enabled (it starts at boot)  
✅ `16:03:47` It runs as User=lamaste-app-e2e-apphost  
✅ `16:03:47` …and its process is owned by lamaste-app-e2e-apphost  
✅ `16:03:47` The account is not root  
✅ `16:03:47` …a system account without login shell or home  
✅ `16:03:47` /opt/lamalibre/apps/e2e-apphost: root's, 0755  
✅ `16:03:47` current → 1.0.0, the version installed  
✅ `16:03:47` Every file of the code is root's and writable by root only  
✅ `16:03:47` /var/lib/lamalibre/apps/e2e-apphost: 0700, the account's  
✅ `16:03:47` …where the agent half keeps its state  
✅ `16:03:47` /etc/lamalibre/apps/e2e-apphost: 0750 root:lamaste-app-e2e-apphost  
✅ `16:03:47` /etc/lamalibre/apps/e2e-apphost/plugin-config.json: 0600, the account's  
✅ `16:03:47` …for this plugin and its port  
✅ `16:03:47` …holding the secret the agent holds (compared on the VM, never printed)  
✅ `16:03:47` The agent records the agent half it had installed  
✅ `16:03:47` sqlite3 is installed  
✅ `16:03:47` …by apt-get install --no-install-recommends during the hosting (apt history)  

## The unit: as written, and as systemd applies it

✅ `16:03:47` Unit: User=lamaste-app-e2e-apphost  
✅ `16:03:47` Unit: Group=lamaste-app-e2e-apphost  
✅ `16:03:47` Unit: Requires=lamalibre-app-e2e-apphost.socket  
✅ `16:03:47` Unit: After=lamalibre-app-e2e-apphost.socket  
✅ `16:03:47` Unit: Sockets=lamalibre-app-e2e-apphost.socket  
✅ `16:03:47` Unit: ExecStart=/usr/bin/node /opt/lamalibre/apps/e2e-apphost/current/package/dist/agentd.mjs  
✅ `16:03:47` Unit: Environment=LAMASTE_APP_CONFIG=/etc/lamalibre/apps/e2e-apphost/plugin-config.json  
✅ `16:03:47` Unit: Environment=LAMASTE_APP_DATA_DIR=/var/lib/lamalibre/apps/e2e-apphost  
✅ `16:03:47` Unit: WorkingDirectory=/var/lib/lamalibre/apps/e2e-apphost  
✅ `16:03:47` Unit: Restart=always  
✅ `16:03:47` Unit: NoNewPrivileges=yes  
✅ `16:03:47` Unit: ProtectSystem=strict  
✅ `16:03:47` Unit: ReadWritePaths=/var/lib/lamalibre/apps/e2e-apphost  
✅ `16:03:47` Unit: ProtectHome=yes  
✅ `16:03:47` Unit: PrivateTmp=yes  
✅ `16:03:47` Unit: PrivateDevices=yes  
✅ `16:03:47` Unit: ProtectKernelTunables=yes  
✅ `16:03:47` Unit: ProtectKernelModules=yes  
✅ `16:03:47` Unit: ProtectKernelLogs=yes  
✅ `16:03:47` Unit: ProtectControlGroups=yes  
✅ `16:03:47` Unit: ProtectClock=yes  
✅ `16:03:47` Unit: ProtectHostname=yes  
✅ `16:03:47` Unit: RestrictSUIDSGID=yes  
✅ `16:03:47` Unit: RestrictRealtime=yes  
✅ `16:03:47` Unit: RestrictNamespaces=yes  
✅ `16:03:47` Unit: LockPersonality=yes  
✅ `16:03:47` Unit: SystemCallArchitectures=native  
✅ `16:03:47` Unit: CapabilityBoundingSet=  
✅ `16:03:47` Unit: UMask=0077  
✅ `16:03:47` Unit: LimitCORE=0  
✅ `16:03:47` Unit: MemoryMax=256M  
✅ `16:03:47` Unit: WantedBy=multi-user.target  
✅ `16:03:47` The unit names paths, never the secret  
✅ `16:03:47` systemctl show: ProtectSystem=strict  
✅ `16:03:47` systemctl show: ProtectHome=yes  
✅ `16:03:48` systemctl show: NoNewPrivileges=yes  
✅ `16:03:48` systemctl show: PrivateTmp=yes  
✅ `16:03:48` systemctl show: PrivateDevices=yes  
✅ `16:03:48` systemctl show: RestrictSUIDSGID=yes  
✅ `16:03:48` systemctl show: LockPersonality=yes  
✅ `16:03:48` systemctl show: ReadWritePaths=/var/lib/lamalibre/apps/e2e-apphost  
✅ `16:03:48` systemctl show: MemoryMax=268435456  
✅ `16:03:48` systemctl show: CapabilityBoundingSet=  
✅ `16:03:48` systemctl show: UMask=0077  
✅ `16:03:48` systemctl show: Restart=always  
✅ `16:03:48` systemctl show: LimitCORE=0  
✅ `16:03:48` systemctl show: TriggeredBy=lamalibre-app-e2e-apphost.socket  
✅ `16:03:48` systemctl show: Requires= names lamalibre-app-e2e-apphost.socket  
✅ `16:03:48` systemctl show: After= names lamalibre-app-e2e-apphost.socket  
✅ `16:03:48` No lamalibre-app-e2e-apphost.service.d drop-in directory: the unit is all there is  

## The socket unit: systemd holds the port

✅ `16:03:48` /etc/systemd/system/lamalibre-app-e2e-apphost.socket: root:root 0644  
✅ `16:03:48` …its sections: [Unit], [Socket], [Install]  
✅ `16:03:48` …its directives: Description, ListenStream, Accept, NoDelay, Service, WantedBy — nothing else  
✅ `16:03:48` Socket unit: ListenStream=127.0.0.1:21000  
✅ `16:03:48` Socket unit: Accept=no  
✅ `16:03:48` Socket unit: NoDelay=true  
✅ `16:03:48` Socket unit: Service=lamalibre-app-e2e-apphost.service  
✅ `16:03:48` Socket unit: WantedBy=sockets.target  
✅ `16:03:48` …and no secret in it  
✅ `16:03:48` lamalibre-app-e2e-apphost.socket is active (running: its service has it) and enabled  
✅ `16:03:48` systemctl show: Listen=127.0.0.1:21000 (Stream)  
✅ `16:03:48` systemctl show: Accept=no, NoDelay=yes, Triggers=lamalibre-app-e2e-apphost.service  
✅ `16:03:48` ss: one listening socket on port 21000  
✅ `16:03:48` …on 127.0.0.1:21000  
✅ `16:03:48` …held by systemd (pid 1)…  
✅ `16:03:48` …and by the agent half (MainPID 36378), the same socket  
✅ `16:03:48` The agent half's descriptor 3 is that listening socket (inode 105216)  
✅ `16:03:48` lamaste-agent apphost status: unit active, socket active  

## Through the tunnel: the installed version answers

✅ `16:03:48` GET /api/e2e-apphost/ping reaches the service on the agent VM  
✅ `16:03:48` …the installed version, 1.0.0  
✅ `16:03:48` …running as lamaste-app-e2e-apphost  
✅ `16:03:48` …which sees the admin as its caller  
✅ `16:03:48` …listening on systemd's socket, descriptor 3, with LISTEN_* cleared from its environment  
✅ `16:03:48` The admin page's bundle comes from the agent half  
✅ `16:03:49` Sandbox: the service is lamaste-app-e2e-apphost, not root  
✅ `16:03:49` Sandbox: it writes its data directory  
✅ `16:03:49` Sandbox: no write to etc (EROFS)  
✅ `16:03:49` Sandbox: no write to code (EROFS)  
✅ `16:03:49` Sandbox: no write to appsDir (EROFS)  
✅ `16:03:49` Sandbox: no write to configDir (EROFS)  
✅ `16:03:49` Sandbox: no write to usrLocal (EROFS)  
✅ `16:03:49` Sandbox: no write to root (EACCES)  
✅ `16:03:49` Sandbox: no write to home (EACCES)  
✅ `16:03:49` Sandbox: no write to runLock (EROFS)  
✅ `16:03:49` Sandbox: no write to run (EROFS)  
✅ `16:03:49` Sandbox: no write to varCrash (EROFS)  
✅ `16:03:49` Sandbox: /run/lock, writable by every user, is read-only to it (ReadOnlyPaths=/run)  
✅ `16:03:49` Sandbox: it has a /tmp…  
✅ `16:03:49` …of its own (PrivateTmp): nothing appears in the machine's /tmp  
✅ `16:03:49` Sandbox: it has a /var/tmp…  
✅ `16:03:49` …of its own: nothing appears in the machine's /var/tmp  
✅ `16:03:49` Sandbox: its /dev/shm is an empty one it cannot write (TemporaryFileSystem)… (EACCES)  
✅ `16:03:49` …and nothing appears in the machine's /dev/shm  
✅ `16:03:49` Sandbox: no new privileges, no capabilities  
✅ `16:03:49` Sandbox: the agent's own state (its keys) is out of reach (EACCES)  
✅ `16:03:49` Sandbox: /etc/shadow is out of reach (EACCES)  
✅ `16:03:49` Sandbox: it sends UDP (dgram binds a port of its own): holding its TCP port took nothing else from it  

## Feria's record: the panel installed as itself, the agent pulled the package itself

✅ `16:03:49` The packument of @lamalibre/e2e-apphost-server was read  
✅ `16:03:49` …by the panel's own identity, ci:auth.test.lamaste.local/lamaste-server  
✅ `16:03:49` …which also pulled @lamalibre/e2e-apphost-server-1.0.0.tgz, and nobody else did  
✅ `16:03:49` No package was served to a request the stand-in Feria could not attribute  
✅ `16:03:49` The packument of @lamalibre/e2e-apphost-agent was read by the panel as itself: the pin came from the panel's own credential  
✅ `16:03:49` …and by nobody but the panel, the hosting agent and this spec's own read  
✅ `16:03:49` agent:test-agent downloaded @lamalibre/e2e-apphost-agent-1.0.0.tgz  
✅ `16:03:49` …and nobody else did: the relay pinned it from the packument alone  
✅ `16:03:49` Its token: an agent token, read scope  
✅ `16:03:49` …brokered by the panel's OIDC identity  

## Uninstall with purge leaves nothing

✅ `16:03:56` The uninstall operation succeeded ()  
✅ `16:03:56` Step: agent uninstall:pre-teardown  
✅ `16:03:56` Step: remove the tunnel  
✅ `16:03:56` Step: agent uninstall:post-teardown  
✅ `16:03:56` Step: remove the agent half  
✅ `16:03:56` Step: revoke the secret and the capability  
✅ `16:03:56` Step: remove the package  
✅ `16:03:56` The agent half went before the secret it runs with  
✅ `16:03:56` The plugin is gone from the relay  
✅ `16:03:56` Uninstalled: no hosting record (no secret)  
✅ `16:03:56` Uninstalled: no internal tunnel  
✅ `16:03:56` Uninstalled: no plugin:e2e-apphost:host on the agent's certificate  
✅ `16:03:57` Audit: plugin.agent-half.removed, purge  
✅ `16:03:57` No unit on the agent VM  
✅ `16:03:57` No socket unit  
✅ `16:03:57` No drop-in directory  
✅ `16:03:57` Nothing listens on port 21000 any more: the socket let go of it  
✅ `16:03:57` No code, config or data directory  
✅ `16:03:57` No lamaste-app-e2e-apphost account or group  
✅ `16:03:57` The agent's record no longer lists it  
✅ `16:03:57` The agent's own copy of the plugin config is gone  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `217` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `217` |

ℹ️ `16:03:57` Cleaning up test resources...  
