# Lamaste E2E: 34 — App plugin installed onto an agent from the panel (Three-VM)

> Started at `2026-11-10 17:58:24 UTC`


## Pre-flight

✅ `17:58:24` Onboarding is complete  
✅ `17:58:24` Agent test-agent is enrolled on the host  
✅ `17:58:24` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `17:58:25` The agent VM's lamaste-agent has the apphost command  
ℹ️ `17:58:25` Hosting agent: test-agent (local name e2e-agent), relay domain test.lamaste.local  

## Stand-in Feria and the panel's registry credential

✅ `17:58:25` Fixture built: @lamalibre/e2e-apphost-server and its bundled agent package @lamalibre/e2e-apphost-agent 1.0.0  
✅ `17:58:34` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-apphost-server, @lamalibre/e2e-apphost-agent )  
✅ `17:58:34` The agent VM reaches it at http://10.13.37.1:4874  
✅ `17:58:36` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T17:58:36.119Z"})  
✅ `17:58:36` …through its own OIDC client  
✅ `17:58:36` The stand-in Feria publishes @lamalibre/e2e-apphost-agent@1.0.0 with a sha512 integrity  

## Install: the agent half is pinned and shown for approval

ℹ️ `17:58:36` sqlite3 on the agent VM before: absent  
✅ `17:58:41` Installed @lamalibre/e2e-apphost-server@1.0.0 from the stand-in Feria  
✅ `17:58:41` …an agent-hosted plugin  
✅ `17:58:41` Preview: the agent package Lamaste installs  
✅ `17:58:41` Preview: at the plugin's version  
✅ `17:58:41` Preview: the tarball integrity, pinned from the registry at install  
✅ `17:58:41` Preview: the system package it brings  
✅ `17:58:41` Preview: the service account  
✅ `17:58:41` Preview: the unit  
✅ `17:58:41` Preview: the service entry and its memory limit  
✅ `17:58:41` Its approval is pending  
✅ `17:58:41` GET /plugins/e2e-apphost/hooks shows the same agent half  

## Refused before approval and on an agent that cannot host it

✅ `17:58:42` Hosting an unapproved agent half is refused (409)  
✅ `17:58:42` …hooks_not_approved  
✅ `17:58:42` Approved with the digest the preview showed  
✅ `17:58:42` The relay holds the agent's current host facts  
✅ `17:58:42` Eligibility: test-agent cannot host it yet  
✅ `17:58:42` …the app host helper is not enabled  
✅ `17:58:42` Hosting on it is refused (409)  
✅ `17:58:42` …agent_not_eligible, with the reasons  

## The operator's step: lamaste-agent apphost enable

✅ `17:58:43` The relay signs with key ac3d73ae00fc29453e60c05a17357b07  
✅ `17:58:43` apphost enable --user root (3,"node":"22.23.4","sudoers":null,"user":"root","relays":[{"label":"e2e-agent","kid":"ac3d73ae00fc29453e60c05a17357b07","agent":"test-agent","panelUrl":"https://10.13.37.1:9292","previousKid":null}]})  
✅ `17:58:43` …installed the helper, protocol 3  
✅ `17:58:43` …and no sudoers rule: the agent runs as root  
✅ `17:58:43` …and pinned the relay's key for e2e-agent, with the name the relay knows it by  
✅ `17:58:43` GET /api/agents/me/relay-keys, from the agent: the key the relay signs with  
✅ `17:58:44` apphost status: e2e-agent has that key pinned  
✅ `17:58:44` …in /etc/lamalibre/apphost/relays/e2e-agent.json, root:root 0644  
✅ `17:58:44` apphost status: the helper is installed  
✅ `17:58:44` …the one this lamaste-agent ships  
✅ `17:58:44` …on /usr/bin/node 22.23.4, what the agent halves run on  
✅ `17:58:44` /usr/local/sbin/lamaste-apphost is root:root 0755  
✅ `17:58:44` No /etc/sudoers.d/lamaste-apphost for a root agent  
✅ `17:59:07` The agent's sync reported the helper to the relay  
✅ `17:59:07` Host facts: Linux, systemd  
✅ `17:59:07` Host facts: helper protocol 3  
✅ `17:59:07` Host facts: the helper's Node.js  
✅ `17:59:07` Host facts: the relay key the helper verifies jobs with  
✅ `17:59:07` Host facts: a Debian-family distribution (ubuntu 24.04)  
✅ `17:59:07` Eligibility: test-agent can host it now  

## Refused by the push-install gates; the window opened

✅ `17:59:08` Push-install off: hosting is refused  
✅ `17:59:08` …push_install_refused (Push install is not enabled globally)  
✅ `17:59:08` Push-install on, the agent's window closed: hosting is refused  
✅ `17:59:08` …push_install_refused (Push install access not enabled for agent "test-agent")  
✅ `17:59:09` The agent's window is open, under a policy naming only @lamalibre/e2e-apphost-agent  

## Hosting: nothing more is done on the agent VM

✅ `17:59:09` Hosting on test-agent started (operation 09518d0e-46ca-4601-a6b4-6dbe99838be1)  
✅ `18:00:59` The hosting operation succeeded ()  
✅ `18:00:59` Step: reserve port, secret and capability  
✅ `18:00:59` Step: install the agent half  
✅ `18:00:59` Step: agent install:pre-tunnel  
✅ `18:00:59` Step: grant the tunnel and wait for the agent half  
✅ `18:00:59` Step: agent install:post-tunnel  
✅ `18:00:59` Step: activate  
✅ `18:00:59` The agent half was installed before its first hook ran  
✅ `18:00:59` The hosting is active  
✅ `18:00:59` The relay records agent half 1.0.0 on test-agent  
✅ `18:00:59` Port 21000 assigned from the internal range  
✅ `18:00:59` The push is in the push-install session log  
✅ `18:00:59` Audit: plugin.agent-half.installed, with the pinned integrity  
✅ `18:01:00` The agent's sync ran the app-install job (sync.log)  
✅ `18:01:00` …then the pre-tunnel hook job  
✅ `18:01:00` The installed service answered install:pre-tunnel (its journal)  
✅ `18:01:00` …and install:post-tunnel through the tunnel  

## On the agent VM: account, files, unit, system package

✅ `18:01:00` lamalibre-app-e2e-apphost.service is active and enabled (it starts at boot)  
✅ `18:01:00` It runs as User=lamaste-app-e2e-apphost  
✅ `18:01:00` …and its process is owned by lamaste-app-e2e-apphost  
✅ `18:01:00` The account is not root  
✅ `18:01:00` …a system account without login shell or home  
✅ `18:01:00` /opt/lamalibre/apps/e2e-apphost: root's, 0755  
✅ `18:01:00` current → 1.0.0, the version installed  
✅ `18:01:00` Every file of the code is root's and writable by root only  
✅ `18:01:00` /var/lib/lamalibre/apps/e2e-apphost: 0700, the account's  
✅ `18:01:00` …where the agent half keeps its state  
✅ `18:01:00` /etc/lamalibre/apps/e2e-apphost: 0750 root:lamaste-app-e2e-apphost  
✅ `18:01:00` /etc/lamalibre/apps/e2e-apphost/plugin-config.json: 0600, the account's  
✅ `18:01:00` …for this plugin and its port  
✅ `18:01:00` …holding the secret the agent holds (compared on the VM, never printed)  
✅ `18:01:00` The agent records the agent half it had installed  
✅ `18:01:00` sqlite3 is installed  
✅ `18:01:00` …by apt-get install --no-install-recommends during the hosting (apt history)  

## The unit: as written, and as systemd applies it

✅ `18:01:00` Unit: User=lamaste-app-e2e-apphost  
✅ `18:01:00` Unit: Group=lamaste-app-e2e-apphost  
✅ `18:01:00` Unit: Requires=lamalibre-app-e2e-apphost.socket  
✅ `18:01:00` Unit: After=lamalibre-app-e2e-apphost.socket  
✅ `18:01:00` Unit: Sockets=lamalibre-app-e2e-apphost.socket  
✅ `18:01:00` Unit: ExecStart=/usr/bin/node /opt/lamalibre/apps/e2e-apphost/current/package/dist/agentd.mjs  
✅ `18:01:00` Unit: Environment=LAMASTE_APP_CONFIG=/etc/lamalibre/apps/e2e-apphost/plugin-config.json  
✅ `18:01:00` Unit: Environment=LAMASTE_APP_DATA_DIR=/var/lib/lamalibre/apps/e2e-apphost  
✅ `18:01:00` Unit: WorkingDirectory=/var/lib/lamalibre/apps/e2e-apphost  
✅ `18:01:00` Unit: Restart=always  
✅ `18:01:00` Unit: NoNewPrivileges=yes  
✅ `18:01:00` Unit: ProtectSystem=strict  
✅ `18:01:00` Unit: ReadWritePaths=/var/lib/lamalibre/apps/e2e-apphost  
✅ `18:01:00` Unit: ProtectHome=yes  
✅ `18:01:00` Unit: PrivateTmp=yes  
✅ `18:01:00` Unit: PrivateDevices=yes  
✅ `18:01:00` Unit: ProtectKernelTunables=yes  
✅ `18:01:00` Unit: ProtectKernelModules=yes  
✅ `18:01:00` Unit: ProtectKernelLogs=yes  
✅ `18:01:00` Unit: ProtectControlGroups=yes  
✅ `18:01:00` Unit: ProtectClock=yes  
✅ `18:01:00` Unit: ProtectHostname=yes  
✅ `18:01:00` Unit: RestrictSUIDSGID=yes  
✅ `18:01:00` Unit: RestrictRealtime=yes  
✅ `18:01:00` Unit: RestrictNamespaces=yes  
✅ `18:01:00` Unit: LockPersonality=yes  
✅ `18:01:00` Unit: SystemCallArchitectures=native  
✅ `18:01:00` Unit: CapabilityBoundingSet=  
✅ `18:01:00` Unit: UMask=0077  
✅ `18:01:00` Unit: LimitCORE=0  
✅ `18:01:00` Unit: MemoryMax=256M  
✅ `18:01:00` Unit: WantedBy=multi-user.target  
✅ `18:01:00` The unit names paths, never the secret  
✅ `18:01:00` systemctl show: ProtectSystem=strict  
✅ `18:01:00` systemctl show: ProtectHome=yes  
✅ `18:01:00` systemctl show: NoNewPrivileges=yes  
✅ `18:01:00` systemctl show: PrivateTmp=yes  
✅ `18:01:00` systemctl show: PrivateDevices=yes  
✅ `18:01:00` systemctl show: RestrictSUIDSGID=yes  
✅ `18:01:00` systemctl show: LockPersonality=yes  
✅ `18:01:00` systemctl show: ReadWritePaths=/var/lib/lamalibre/apps/e2e-apphost  
✅ `18:01:00` systemctl show: MemoryMax=268435456  
✅ `18:01:00` systemctl show: CapabilityBoundingSet=  
✅ `18:01:00` systemctl show: UMask=0077  
✅ `18:01:00` systemctl show: Restart=always  
✅ `18:01:01` systemctl show: LimitCORE=0  
✅ `18:01:01` systemctl show: TriggeredBy=lamalibre-app-e2e-apphost.socket  
✅ `18:01:01` systemctl show: Requires= names lamalibre-app-e2e-apphost.socket  
✅ `18:01:01` systemctl show: After= names lamalibre-app-e2e-apphost.socket  
✅ `18:01:01` No lamalibre-app-e2e-apphost.service.d drop-in directory: the unit is all there is  

## The socket unit: systemd holds the port

✅ `18:01:01` /etc/systemd/system/lamalibre-app-e2e-apphost.socket: root:root 0644  
✅ `18:01:01` …its sections: [Unit], [Socket], [Install]  
✅ `18:01:01` …its directives: Description, ListenStream, Accept, NoDelay, Service, WantedBy — nothing else  
✅ `18:01:01` Socket unit: ListenStream=127.0.0.1:21000  
✅ `18:01:01` Socket unit: Accept=no  
✅ `18:01:01` Socket unit: NoDelay=true  
✅ `18:01:01` Socket unit: Service=lamalibre-app-e2e-apphost.service  
✅ `18:01:01` Socket unit: WantedBy=sockets.target  
✅ `18:01:01` …and no secret in it  
✅ `18:01:01` lamalibre-app-e2e-apphost.socket is active (running: its service has it) and enabled  
✅ `18:01:01` systemctl show: Listen=127.0.0.1:21000 (Stream)  
✅ `18:01:01` systemctl show: Accept=no, NoDelay=yes, Triggers=lamalibre-app-e2e-apphost.service  
✅ `18:01:01` ss: one listening socket on port 21000  
✅ `18:01:01` …on 127.0.0.1:21000  
✅ `18:01:01` …held by systemd (pid 1)…  
✅ `18:01:01` …and by the agent half (MainPID 36048), the same socket  
✅ `18:01:01` The agent half's descriptor 3 is that listening socket (inode 105909)  
✅ `18:01:01` lamaste-agent apphost status: unit active, socket active  

## Through the tunnel: the installed version answers

✅ `18:01:01` GET /api/e2e-apphost/ping reaches the service on the agent VM  
✅ `18:01:01` …the installed version, 1.0.0  
✅ `18:01:01` …running as lamaste-app-e2e-apphost  
✅ `18:01:01` …which sees the admin as its caller  
✅ `18:01:01` …listening on systemd's socket, descriptor 3, with LISTEN_* cleared from its environment  
✅ `18:01:01` The admin page's bundle comes from the agent half  
✅ `18:01:02` Sandbox: the service is lamaste-app-e2e-apphost, not root  
✅ `18:01:02` Sandbox: it writes its data directory  
✅ `18:01:02` Sandbox: no write to etc (EROFS)  
✅ `18:01:02` Sandbox: no write to code (EROFS)  
✅ `18:01:02` Sandbox: no write to appsDir (EROFS)  
✅ `18:01:02` Sandbox: no write to configDir (EROFS)  
✅ `18:01:02` Sandbox: no write to usrLocal (EROFS)  
✅ `18:01:02` Sandbox: no write to root (EACCES)  
✅ `18:01:02` Sandbox: no write to home (EACCES)  
✅ `18:01:02` Sandbox: no write to runLock (EROFS)  
✅ `18:01:02` Sandbox: no write to run (EROFS)  
✅ `18:01:02` Sandbox: no write to varCrash (EROFS)  
✅ `18:01:02` Sandbox: /run/lock, writable by every user, is read-only to it (ReadOnlyPaths=/run)  
✅ `18:01:02` Sandbox: it has a /tmp…  
✅ `18:01:02` …of its own (PrivateTmp): nothing appears in the machine's /tmp  
✅ `18:01:02` Sandbox: it has a /var/tmp…  
✅ `18:01:02` …of its own: nothing appears in the machine's /var/tmp  
✅ `18:01:02` Sandbox: its /dev/shm is an empty one it cannot write (TemporaryFileSystem)… (EACCES)  
✅ `18:01:02` …and nothing appears in the machine's /dev/shm  
✅ `18:01:02` Sandbox: no new privileges, no capabilities  
✅ `18:01:02` Sandbox: the agent's own state (its keys) is out of reach (EACCES)  
✅ `18:01:02` Sandbox: /etc/shadow is out of reach (EACCES)  
✅ `18:01:02` Sandbox: it sends UDP (dgram binds a port of its own): holding its TCP port took nothing else from it  

## Feria's record: the panel installed as itself, the agent pulled the package itself

✅ `18:01:02` The packument of @lamalibre/e2e-apphost-server was read  
✅ `18:01:02` …by the panel's own identity, ci:auth.test.lamaste.local/lamaste-server  
✅ `18:01:02` …which also pulled @lamalibre/e2e-apphost-server-1.0.0.tgz, and nobody else did  
✅ `18:01:02` No package was served to a request the stand-in Feria could not attribute  
✅ `18:01:02` The packument of @lamalibre/e2e-apphost-agent was read by the panel as itself: the pin came from the panel's own credential  
✅ `18:01:02` …and by nobody but the panel, the hosting agent and this spec's own read  
✅ `18:01:02` agent:test-agent downloaded @lamalibre/e2e-apphost-agent-1.0.0.tgz  
✅ `18:01:02` …and nobody else did: the relay pinned it from the packument alone  
✅ `18:01:02` Its token: an agent token, read scope  
✅ `18:01:02` …brokered by the panel's OIDC identity  

## Uninstall with purge leaves nothing

✅ `18:01:13` The uninstall operation succeeded ()  
✅ `18:01:13` Step: agent uninstall:pre-teardown  
✅ `18:01:13` Step: remove the tunnel  
✅ `18:01:13` Step: agent uninstall:post-teardown  
✅ `18:01:13` Step: remove the agent half  
✅ `18:01:13` Step: revoke the secret and the capability  
✅ `18:01:13` Step: remove the package  
✅ `18:01:13` The agent half went before the secret it runs with  
✅ `18:01:14` The plugin is gone from the relay  
✅ `18:01:14` Uninstalled: no hosting record (no secret)  
✅ `18:01:14` Uninstalled: no internal tunnel  
✅ `18:01:14` Uninstalled: no plugin:e2e-apphost:host on the agent's certificate  
✅ `18:01:14` Audit: plugin.agent-half.removed, purge  
✅ `18:01:14` No unit on the agent VM  
✅ `18:01:14` No socket unit  
✅ `18:01:14` No drop-in directory  
✅ `18:01:14` Nothing listens on port 21000 any more: the socket let go of it  
✅ `18:01:14` No code, config or data directory  
✅ `18:01:14` No lamaste-app-e2e-apphost account or group  
✅ `18:01:14` The agent's record no longer lists it  
✅ `18:01:14` The agent's own copy of the plugin config is gone  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `217` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `217` |

ℹ️ `18:01:14` Cleaning up test resources...  
