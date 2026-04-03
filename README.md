# WhatsBridge

WhatsApp REST API server with a web dashboard. Run multiple instances on the same server, each on its own port.

---

## Getting Started

### Option A — One-line install (no Node.js required)

Run this in the directory where you want to use WhatsBridge:

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/kdrcetintas/whatsbridge/main/scripts/install.sh | bash
```

**Windows (PowerShell):**
```powershell
iex (iwr "https://raw.githubusercontent.com/kdrcetintas/whatsbridge/main/scripts/install.ps1").Content
```

Downloads the correct binary for your platform into the current directory.

### Option B — Manual download

Download the binary for your platform from [Releases](https://github.com/kdrcetintas/whatsbridge/releases/latest):

| Platform | File |
|---|---|
| Windows | `whatsbridge-vX.X.X-win-x64.exe` |
| Linux | `whatsbridge-vX.X.X-linux-x64` |
| macOS (Apple Silicon) | `whatsbridge-vX.X.X-macos-arm64` |

On Linux/macOS, make it executable: `chmod +x whatsbridge-*`

### Option C — Build from source (requires Node.js 20+)

```bash
git clone https://github.com/kdrcetintas/whatsbridge.git
cd whatsbridge
npm install
npm run package        # → bin/whatsbridge-vX.X.X-<platform>-<arch>
```

---

## Usage

### 1. Initialize

```bash
whatsbridge init
```

Prompts for port, username, password. Creates `whatsbridge.config.json` in the current directory. Run once per instance.

### 2. Start

```bash
whatsbridge start
```

Starts the server and opens the dashboard in your browser. Scan the QR code with WhatsApp to connect.

Runtime data is stored in a `data/` subfolder next to the config:

```
my-instance/
├── whatsbridge.config.json
└── data/
    ├── auth_info/        ← WhatsApp session
    ├── whatsbridge.db    ← message database
    └── logs/             ← daily log files
```

### 3. Install as a system service (optional)

```bash
# Windows (run as Administrator)
whatsbridge service install

# Linux (requires sudo)
sudo whatsbridge service install
```

Runs WhatsBridge in the background and starts automatically on boot.

---

## REST API

All endpoints require `?api_key=YOUR_KEY` as a query parameter.

### GET `/api/status`

Returns the current connection status.

```bash
curl "http://localhost:3000/api/status?api_key=YOUR_KEY"
```

```json
{ "status": "connected", "hasQR": false, "queue": { "length": 0, "nextSendDelay": 0 } }
```

### POST `/api/send`

Sends a text message.

```bash
curl -X POST "http://localhost:3000/api/send?api_key=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone":"905xxxxxxxxx","message":"Hello!"}'
```

| Field | Type | Description |
|---|---|---|
| `phone` | string | Phone number with country code, no `+` |
| `message` | string | Text message |
| `allowQueuing` | boolean | Queue and return immediately instead of waiting |

### POST `/api/send-image`

Sends an image from a URL.

```bash
curl -X POST "http://localhost:3000/api/send-image?api_key=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone":"905xxxxxxxxx","imageUrl":"https://example.com/photo.jpg","caption":"Hi"}'
```

| Field | Type | Description |
|---|---|---|
| `phone` | string | Phone number with country code, no `+` |
| `imageUrl` | string | Publicly accessible image URL |
| `caption` | string | Optional caption |
| `allowQueuing` | boolean | Same as `/api/send` |

### GET `/api/messages`

Lists sent/received messages.

```bash
curl "http://localhost:3000/api/messages?api_key=YOUR_KEY&limit=50&offset=0"
```

Query params: `limit`, `offset`, `status` (`queued`/`sending`/`sent`/`failed`), `phone`.

### GET `/api/messages/:id`

Returns a single message by internal ID.

### GET `/api/stats`

Returns message counts.

```json
{ "sent": 42, "received": 10, "queued": 0, "failed": 1 }
```

---

## Message Queue

By default (`allowQueuing: false`) the API waits for WhatsApp to confirm delivery before responding. Pass `allowQueuing: true` to queue the message and return immediately — useful for bulk sends.

A rate limit of 5 seconds between sends is enforced to avoid bans. Pending messages survive restarts.

---

## Multiple Instances

Each instance runs in its own directory with its own config and WhatsApp session.

```bash
mkdir account-1 && cd account-1 && whatsbridge init   # port 3000
mkdir account-2 && cd account-2 && whatsbridge init   # port 3001
```

---

## Web Dashboard

Available at `http://localhost:PORT` after starting. Log in with the username and password set during `init`.

Tabs: **Status** — **Send Message** — **Logs** — **API Docs**

---

## License

ISC
