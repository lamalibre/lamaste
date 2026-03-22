# setup-agent

> Started at `2026-03-22 18:24:11 UTC` — log level **1**


---

# Portlama E2E — Agent VM Setup


| Key | Value |
|-----|-------|
| **Host IP** | `192.168.2.154` |
| **Test Domain** | `test.portlama.local` |

🔵 `18:24:11` **[1/5] Configuring /etc/hosts...**  
✅ `18:24:11` /etc/hosts configured with test.portlama.local entries  
🔵 `18:24:11` **[2/5] Installing Chisel...**  
ℹ️ `18:24:11` Downloading Chisel v1.11.5...  
<details>
<summary>✅ <code>18:24:12</code> Download Chisel v1.11.5</summary>

```
$ curl -sL -o /tmp/chisel-O5XMrJ.gz https://github.com/jpillora/chisel/releases/download/v1.11.5/chisel_1.11.5_linux_arm64.gz

```
</details>

<details>
<summary>✅ <code>18:24:12</code> Extract Chisel archive</summary>

```
$ gunzip -f /tmp/chisel-O5XMrJ.gz

```
</details>

✅ `18:24:12` Chisel installed: 1.11.5  
🔵 `18:24:12` **[3/5] Setting up agent P12 certificate...**  
✅ `18:24:12` Agent P12 installed at ~/.portlama/client.p12  
✅ `18:24:12` PEM files extracted to ~/.portlama/  
🔵 `18:24:12` **[4/5] Verifying panel connectivity...**  
✅ `18:24:12` Panel is reachable via agent P12 certificate  
✅ `18:24:12` Panel is reachable via domain: panel.test.portlama.local  
🔵 `18:24:12` **[5/5] Installing Python 3...**  
✅ `18:24:12` Python 3 already installed: Python 3.12.3  

---

# Agent VM Setup Summary


| Key | Value |
|-----|-------|
| **Host IP** | `192.168.2.154` |
| **Test Domain** | `test.portlama.local` |
| **Chisel** | `1.11.5` |
| **Python** | `Python 3.12.3` |
| **Agent P12** | `~/.portlama/client.p12` |
| **Agent PEM Cert** | `~/.portlama/client.crt` |
| **Agent PEM Key** | `~/.portlama/client.key` |
| **Panel reachable** | `yes` |

✅ `18:24:12` The agent VM is ready for E2E tests.  
