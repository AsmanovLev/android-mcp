# Android MCP — Hermes Agent Bridge

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Android device automation MCP server for [Hermes Agent](https://hermes-agent.nousresearch.com). Provides ADB-based tools for controlling Android devices — tap, swipe, text input, screenshot, UI dump, app management, and more.

Built for AI agents that need to interact with Android devices programmatically.

## Features

- **Device Management** — list, connect, disconnect devices; check connection state
- **Gestures** — tap, swipe, long press, pinch, multi-touch
- **Input** — text typing, key events, clipboard
- **Screenshots** — capture device screen as PNG
- **UI Analysis** — dump view hierarchy via `uiautomator`
- **App Control** — launch, stop, list installed apps
- **Password Manager** — store and retrieve app credentials locally
- **System Actions** — unlock, lock, volume, power, airplane mode

## Prerequisites

- [Node.js](https://nodejs.org) 18+
- [ADB](https://developer.android.com/studio/command-line/adb) — Android Debug Bridge
- Android device with USB debugging enabled

## Installation

```bash
# Clone the repository
git clone git@github.com:AsmanovLev/android-mcp.git
cd android-mcp

# Install dependencies
npm install

# Build
npm run build
```

## Configuration

Add to your `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  android:
    command: node
    args:
      - /path/to/android-mcp/build/index.js
```

Then restart Hermes Agent. The tools will be available with the `mcp_android_*` prefix.

## Usage

### List connected devices

```json
{
  "tool": "mcp_android_list_devices"
}
```

### Take a screenshot

```json
{
  "tool": "mcp_android_screenshot",
  "arguments": { "save_to": "/tmp/screen.png" }
}
```

### Tap on screen

```json
{
  "tool": "mcp_android_tap",
  "arguments": { "x": 500, "y": 800 }
}
```

### Unlock device

```json
{
  "tool": "mcp_android_unlock",
  "arguments": { "pin": "1234" }
}
```

## Tools

| Tool | Description |
|---|---|
| `list_devices` | List connected ADB devices |
| `screenshot` | Capture device screen |
| `dump_uiautomator` | Dump UI hierarchy via uiautomator |
| `tap` | Tap at coordinates |
| `swipe` | Swipe from (x1,y1) to (x2,y2) |
| `type_text` | Type text via ADB |
| `press_key` | Send key event |
| `unlock` | Wake + swipe up + enter PIN |
| `launch_app` | Launch app by package name |
| `force_stop` | Force stop app |
| `list_apps` | List installed packages |
| `password_manager` | Store/retrieve app credentials |

## Development

```bash
# Watch mode
npm run dev

# Run tests
npm test
```

## Author

**Deepagent** — AI agent by Hermes Agent

## License

MIT
