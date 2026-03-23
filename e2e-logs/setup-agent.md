# setup-agent

> Started at `2026-03-23 12:08:43 UTC` — log level **1**


---

# Portlama E2E — Agent VM Setup


| Key | Value |
|-----|-------|
| **Host IP** | `192.168.2.187` |
| **Test Domain** | `test.portlama.local` |

🔵 `12:08:43` **[1/5] Configuring /etc/hosts...**  
✅ `12:08:43` /etc/hosts configured with test.portlama.local entries  
🔵 `12:08:43` **[2/5] Installing Chisel...**  
ℹ️ `12:08:43` Downloading Chisel v1.11.5...  
<details>
<summary>✅ <code>12:08:44</code> Download Chisel v1.11.5</summary>

```
$ curl -sL -o /tmp/chisel-U4viD7.gz https://github.com/jpillora/chisel/releases/download/v1.11.5/chisel_1.11.5_linux_arm64.gz

```
</details>

<details>
<summary>✅ <code>12:08:44</code> Extract Chisel archive</summary>

```
$ gunzip -f /tmp/chisel-U4viD7.gz

```
</details>

✅ `12:08:44` Chisel installed: 1.11.5  
🔵 `12:08:44` **[3/5] Setting up agent P12 certificate...**  
✅ `12:08:44` Agent P12 installed at ~/.portlama/client.p12  
✅ `12:08:44` PEM files extracted to ~/.portlama/  
🔵 `12:08:44` **[4/5] Verifying panel connectivity...**  
✅ `12:08:44` Panel is reachable via agent P12 certificate  
✅ `12:08:44` Panel is reachable via domain: panel.test.portlama.local  
🔵 `12:08:44` **[5/5] Installing Python 3...**  
✅ `12:08:44` Python 3 already installed: Python 3.12.3  

---

# Agent VM Setup Summary


| Key | Value |
|-----|-------|
| **Host IP** | `192.168.2.187` |
| **Test Domain** | `test.portlama.local` |
| **Chisel** | `1.11.5` |
| **Python** | `Python 3.12.3` |
| **Agent P12** | `~/.portlama/client.p12` |
| **Agent PEM Cert** | `~/.portlama/client.crt` |
| **Agent PEM Key** | `~/.portlama/client.key` |
| **Panel reachable** | `yes` |

✅ `12:08:44` The agent VM is ready for E2E tests.  
