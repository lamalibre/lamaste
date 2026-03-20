# setup-agent

> Started at `2026-03-20 14:33:17 UTC` — log level **1**


---

# Portlama E2E — Agent VM Setup


| Key | Value |
|-----|-------|
| **Host IP** | `192.168.2.100` |
| **Test Domain** | `test.portlama.local` |

🔵 `14:33:17` **[1/5] Configuring /etc/hosts...**  
✅ `14:33:17` /etc/hosts configured with test.portlama.local entries  
🔵 `14:33:17` **[2/5] Installing Chisel...**  
ℹ️ `14:33:18` Downloading Chisel v1.11.5...  
<details>
<summary>✅ <code>14:33:18</code> Download Chisel v1.11.5</summary>

```
$ curl -sL -o /tmp/chisel-IvDJhn.gz https://github.com/jpillora/chisel/releases/download/v1.11.5/chisel_1.11.5_linux_arm64.gz

```
</details>

<details>
<summary>✅ <code>14:33:18</code> Extract Chisel archive</summary>

```
$ gunzip -f /tmp/chisel-IvDJhn.gz

```
</details>

✅ `14:33:18` Chisel installed: 1.11.5  
🔵 `14:33:18` **[3/5] Setting up agent P12 certificate...**  
✅ `14:33:18` Agent P12 installed at ~/.portlama/client.p12  
✅ `14:33:18` PEM files extracted to ~/.portlama/  
🔵 `14:33:18` **[4/5] Verifying panel connectivity...**  
✅ `14:33:18` Panel is reachable via agent P12 certificate  
✅ `14:33:18` Panel is reachable via domain: panel.test.portlama.local  
🔵 `14:33:18` **[5/5] Installing Python 3...**  
✅ `14:33:18` Python 3 already installed: Python 3.12.3  

---

# Agent VM Setup Summary


| Key | Value |
|-----|-------|
| **Host IP** | `192.168.2.100` |
| **Test Domain** | `test.portlama.local` |
| **Chisel** | `1.11.5` |
| **Python** | `Python 3.12.3` |
| **Agent P12** | `~/.portlama/client.p12` |
| **Agent PEM Cert** | `~/.portlama/client.crt` |
| **Agent PEM Key** | `~/.portlama/client.key` |
| **Panel reachable** | `yes` |

✅ `14:33:18` The agent VM is ready for E2E tests.  
