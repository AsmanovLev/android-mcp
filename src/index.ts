import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  getDevicePrefix, checkDevice, listDevices, setDeviceSerial, getSelectedSerial,
  captureScreenSummary, captureScreenshotRaw, captureUIXml, adb, DeviceInfo,
} from "./device";
import { parseUIElements, formatElements, findElement, getForegroundPackage, UIElement } from "./uixml";
import { runSteps, Step, busySleep, findTouchDevice, touchDown, touchUp } from "./gesture";

const server = new Server(
  { name: "android-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// ── Helper: wrap result ──
function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

// ── Helper: get device prefix + check ──
function prep(serial?: string): string[] {
  const p = getDevicePrefix(serial);
  checkDevice(p);
  return p;
}

// ── Helper: capture screen summary ──
function screenSummary(p: string[]): string {
  try {
    const xml = captureUIXml(p);
    const elements = parseUIElements(xml);
    return formatElements(elements);
  } catch (e: any) {
    return `(screen capture failed: ${e.message})`;
  }
}

// ── Tool definitions ──

const TOOLS: Tool[] = [
  // ── Device management ──
  {
    name: "mobile_device_list",
    description: "List connected Android devices and optionally select one as the active device for all mobile tools.",
    inputSchema: {
      type: "object",
      properties: {
        select: { type: "string", description: "Device serial to select as the active device" },
      },
    },
  },
  {
    name: "mobile_screenshot",
    description: "Capture a screenshot from the Android device. Returns the screenshot file path and UI hierarchy text.",
    inputSchema: {
      type: "object",
      properties: {
        return_screen: { type: "boolean", description: "Include UI hierarchy text (default: true)" },
        serial: { type: "string", description: "ADB device serial (optional)" },
      },
    },
  },
  {
    name: "mobile_app",
    description: "Manage Android apps via ADB: install APK, start app by package, force-stop, uninstall, or list installed packages.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["install", "start", "force-stop", "delete", "list"], description: "Operation" },
        package: { type: "string", description: "Package name (required for start/force-stop/delete; optional filter for list)" },
        file: { type: "string", description: "Path to APK file (required for install)" },
        return_screen: { type: "boolean", description: "Capture screen after action (default: true)" },
        serial: { type: "string", description: "ADB device serial (optional)" },
      },
      required: ["action"],
    },
  },
  {
    name: "mobile_gesture",
    description: "Execute gestures on the Android device: tap, swipe, long-press, drag, or multi-step gesture sequences.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["tap", "swipe", "fastswipe", "tap-hold", "drag", "press", "move", "release", "hold", "swipe-hold-start", "swipe-hold-end", "swipe-hold-startend"], description: "Gesture type" },
        x: { type: "number", description: "X coordinate" },
        y: { type: "number", description: "Y coordinate" },
        x2: { type: "number", description: "End X (required for swipe/fastswipe/swipe-hold-*)" },
        y2: { type: "number", description: "End Y (required for swipe/fastswipe/swipe-hold-*)" },
        duration: { type: "number", description: "Duration in ms" },
        delay: { type: "number", description: "Delay before this step (ms)" },
        text: { type: "string", description: "Find element by text and tap it (alternative to x/y)" },
        return_screen: { type: "boolean", description: "Capture screen after gesture (default: true)" },
        serial: { type: "string", description: "ADB device serial (optional)" },
      },
      required: ["action"],
    },
  },
  {
    name: "mobile_gesture_combo",
    description: "Execute a multi-step gesture sequence (array of steps). Each step can be tap, swipe, fastswipe, tap-hold, drag, press, move, release, hold, swipe-hold-start, swipe-hold-end, or swipe-hold-startend.",
    inputSchema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["tap", "swipe", "fastswipe", "tap-hold", "drag", "press", "move", "release", "hold", "swipe-hold-start", "swipe-hold-end", "swipe-hold-startend"], description: "Gesture type" },
              x: { type: "number", description: "X coordinate" },
              y: { type: "number", description: "Y coordinate" },
              x2: { type: "number", description: "End X" },
              y2: { type: "number", description: "End Y" },
              duration: { type: "number", description: "Duration in ms" },
              delay: { type: "number", description: "Delay before this step (ms)" },
            },
            required: ["action", "x", "y"],
          },
          description: "Array of gesture steps to execute in sequence",
        },
        return_screen: { type: "boolean", description: "Capture screen after sequence (default: true)" },
        serial: { type: "string", description: "ADB device serial (optional)" },
      },
      required: ["steps"],
    },
  },
  {
    name: "mobile_gesture_macro",
    description: "Execute a named gesture macro (e.g., 'unlock', 'home', 'back', 'recents', 'notification_panel', 'quick_settings').",
    inputSchema: {
      type: "object",
      properties: {
        macro: { type: "string", enum: ["unlock", "home", "back", "recents", "notification_panel", "quick_settings"], description: "Macro name" },
        return_screen: { type: "boolean", description: "Capture screen after macro (default: true)" },
        serial: { type: "string", description: "ADB device serial (optional)" },
      },
      required: ["macro"],
    },
  },
  {
    name: "mobile_button",
    description: "Press a hardware/system button on the Android device: back, home, recent apps, menu, volume up/down, power, camera, or call.",
    inputSchema: {
      type: "object",
      properties: {
        button: { type: "string", enum: ["back", "home", "recent", "menu", "volume_up", "volume_down", "power", "camera", "call"], description: "Button to press" },
        return_screen: { type: "boolean", description: "Capture screen after button press (default: true)" },
        serial: { type: "string", description: "ADB device serial (optional)" },
      },
      required: ["button"],
    },
  },
  {
    name: "mobile_type",
    description: "Type text into the currently focused input field on the Android device.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to type" },
        clear_first: { type: "boolean", description: "Clear the field before typing (default: false)" },
        return_screen: { type: "boolean", description: "Capture screen after typing (default: true)" },
        serial: { type: "string", description: "ADB device serial (optional)" },
      },
      required: ["text"],
    },
  },
  {
    name: "mobile_power",
    description: "Control device power state: turn screen on/off, check if awake, or reboot.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["on", "off", "awake", "reboot"], description: "Power action" },
        serial: { type: "string", description: "ADB device serial (optional)" },
      },
      required: ["action"],
    },
  },
  {
    name: "mobile_unlock_screen",
    description: "Unlock the Android device screen. Wakes the screen, swipes up, and enters a PIN/password if provided.",
    inputSchema: {
      type: "object",
      properties: {
        pin: { type: "string", description: "PIN or password to unlock (optional)" },
        serial: { type: "string", description: "ADB device serial (optional)" },
      },
    },
  },
  {
    name: "mobile_wait",
    description: "Wait for a UI element to appear or disappear on the screen, with timeout.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to wait for" },
        resource_id: { type: "string", description: "Resource ID to wait for" },
        className: { type: "string", description: "Class name to wait for" },
        description: { type: "string", description: "Content description to wait for" },
        timeout: { type: "number", description: "Max wait time in ms (default: 10000)" },
        disappear: { type: "boolean", description: "Wait for element to disappear instead of appear (default: false)" },
        serial: { type: "string", description: "ADB device serial (optional)" },
      },
    },
  },
  {
    name: "mobile_state",
    description: "Get device state: battery level, screen orientation, display info, foreground app, and network status.",
    inputSchema: {
      type: "object",
      properties: {
        serial: { type: "string", description: "ADB device serial (optional)" },
      },
    },
  },
  {
    name: "mobile_activity_manager",
    description: "Start an Android activity by intent (package/class, action, data URI, extras).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "Intent action (e.g., android.intent.action.VIEW)" },
        data_uri: { type: "string", description: "Data URI for the intent" },
        package: { type: "string", description: "Package name" },
        class_name: { type: "string", description: "Full class name (e.g., com.example/.MainActivity)" },
        extras: { type: "string", description: "JSON string of extra key-value pairs" },
        serial: { type: "string", description: "ADB device serial (optional)" },
      },
    },
  },
  {
    name: "mobile_restart_bridge",
    description: "Restart the ADB server (kill + start). Useful when devices are not detected or ADB is stuck.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  // ── F-Droid ──
  {
    name: "fdroid_search",
    description: "Search for Android apps on F-Droid by query.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (default: 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "fdroid_download",
    description: "Download an APK from F-Droid by package name.",
    inputSchema: {
      type: "object",
      properties: {
        package_name: { type: "string", description: "Package name to download" },
        output_dir: { type: "string", description: "Output directory (default: /tmp)" },
      },
      required: ["package_name"],
    },
  },
  // ── RuStore ──
  {
    name: "rustore_search",
    description: "Search for Android apps on RuStore by query.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (default: 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "rustore_download",
    description: "Download an APK from RuStore by package name.",
    inputSchema: {
      type: "object",
      properties: {
        package_name: { type: "string", description: "Package name to download" },
        output_dir: { type: "string", description: "Output directory (default: /tmp)" },
      },
      required: ["package_name"],
    },
  },
  // ── Password Manager ──
  {
    name: "password_manager",
    description: "Manage stored passwords for auto-login on Android apps. Store, retrieve, list, or delete credentials.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["store", "get", "list", "delete"], description: "Operation" },
        app: { type: "string", description: "App package name (required for store/get/delete)" },
        username: { type: "string", description: "Username (required for store)" },
        password: { type: "string", description: "Password (required for store)" },
      },
      required: ["action"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ── Device List ──
      case "mobile_device_list": {
        const a = args as { select?: string };
        if (a.select) {
          const devices = listDevices();
          const found = devices.find((d) => d.serial === a.select);
          if (!found) {
            const available = devices.map((d) => `  ${d.serial}`).join("\n");
            return err(`Device "${a.select}" not found.\nConnected devices:\n${available}`);
          }
          setDeviceSerial(a.select);
        }
        const devices = listDevices();
        const selected = getSelectedSerial();
        if (devices.length === 0) return ok("No devices connected");
        const lines = devices.map((d) => {
          const marker = d.serial === selected ? " →" : "  ";
          const model = d.model ? ` (${d.model.replace(/_/g, " ")})` : "";
          return `${marker} ${d.serial}${model} [${d.status}]`;
        });
        if (!selected && devices.length > 0) {
          lines.push("", 'No device selected. Use select:"<serial>" to choose one.');
        }
        return ok(lines.join("\n"));
      }

      // ── Screenshot ──
      case "mobile_screenshot": {
        const a = args as { return_screen?: boolean; serial?: string };
        const p = prep(a.serial);

        // Check screen is awake
        const wake = adb([...p, "shell", "dumpsys", "power"]);
        if (!/mWakefulness=Awake/.test(wake.stdout)) {
          return err("Screen is off — turn it on first using mobile_power");
        }

        const timestamp = Date.now();
        const screenshotDir = path.join(os.homedir(), ".config", "opencode", "screenshots");
        fs.mkdirSync(screenshotDir, { recursive: true });
        const screenshotPath = path.join(screenshotDir, `screen_${timestamp}.png`);

        const rawPng = captureScreenshotRaw(p);
        fs.writeFileSync(screenshotPath, rawPng);

        let result = `Screenshot saved: ${screenshotPath}`;
        if (a.return_screen !== false) {
          result += "\n--- UI Tree ---\n" + screenSummary(p);
        }
        return ok(result);
      }

      // ── App Management ──
      case "mobile_app": {
        const a = args as { action: string; package?: string; file?: string; return_screen?: boolean; serial?: string };
        const p = prep(a.serial);

        let result: string;
        if (a.action === "install") {
          if (!a.file) return err("file is required for install");
          if (!fs.existsSync(a.file)) return err(`File not found: ${a.file}`);
          const r = adb([...p, "install", "-r", a.file]);
          if (r.status === 0) {
            const sizeMb = (fs.statSync(a.file).size / 1024 / 1024).toFixed(2);
            result = `Install successful (${sizeMb} MB)`;
          } else {
            return err(`Install failed: ${(r.stderr || r.stdout || "").trim()}`);
          }
        } else if (a.action === "list") {
          const r = adb([...p, "shell", "pm", "list", "packages", "--user", "0"]);
          if (r.status !== 0) return err(`Failed to list packages: ${(r.stderr || r.stdout || "").trim()}`);
          let lines = r.stdout.split("\n").filter((l) => l.startsWith("package:")).map((l) => l.replace("package:", "").trim());
          if (a.package) { const pkg = a.package; lines = lines.filter((l) => l.toLowerCase().includes(pkg.toLowerCase())); }
          result = lines.length === 0 ? (a.package ? `No packages match "${a.package}"` : "No packages installed") : lines.join("\n");
        } else {
          if (!a.package) return err("package is required for start/force-stop/delete");
          if (a.action === "start") {
            const r = adb([...p, "shell", "monkey", "-p", a.package, "1"]);
            if (r.status !== 0 || /Error/i.test(r.stderr || "")) {
              return err(`Failed to start ${a.package}: ${(r.stderr || r.stdout || "").trim()}`);
            }
            result = `Started ${a.package}`;
          } else if (a.action === "force-stop") {
            adb([...p, "shell", "am", "force-stop", a.package]);
            result = `Force-stopped ${a.package}`;
          } else if (a.action === "delete") {
            const r = adb([...p, "uninstall", a.package]);
            if (r.status !== 0) return err(`Failed to uninstall ${a.package}: ${(r.stderr || r.stdout || "").trim()}`);
            result = `Uninstalled ${a.package}`;
          } else {
            return err(`Unknown action: ${a.action}`);
          }
        }

        if (a.return_screen !== false) {
          result += "\n---\n" + screenSummary(p);
        }
        return ok(result);
      }

      // ── Gesture ──
      case "mobile_gesture": {
        const a = args as { action: string; x?: number; y?: number; x2?: number; y2?: number; duration?: number; delay?: number; text?: string; return_screen?: boolean; serial?: string };
        const p = prep(a.serial);

        let x = a.x ?? 0;
        let y = a.y ?? 0;

        // If text is provided, find element and tap its center
        if (a.text) {
          const xml = captureUIXml(p);
          const elements = parseUIElements(xml);
          const el = findElement(elements, { text: a.text });
          if (!el) return err(`Element with text "${a.text}" not found`);
          x = el.center.x;
          y = el.center.y;
        }

        const step: Step = {
          action: a.action as Step["action"],
          x, y,
          x2: a.x2, y2: a.y2,
          duration: a.duration, delay: a.delay,
        };
        runSteps(p, [step]);

        let result = `Gesture ${a.action} executed at (${x}, ${y})`;
        if (a.return_screen !== false) {
          result += "\n---\n" + screenSummary(p);
        }
        return ok(result);
      }

      // ── Gesture Combo ──
      case "mobile_gesture_combo": {
        const a = args as { steps: Step[]; return_screen?: boolean; serial?: string };
        const p = prep(a.serial);
        runSteps(p, a.steps);
        let result = `Executed ${a.steps.length} gesture steps`;
        if (a.return_screen !== false) {
          result += "\n---\n" + screenSummary(p);
        }
        return ok(result);
      }

      // ── Gesture Macro ──
      case "mobile_gesture_macro": {
        const a = args as { macro: string; return_screen?: boolean; serial?: string };
        const p = prep(a.serial);
        const display = adb([...p, "shell", "wm", "size"]);
        const dm = /(\d+)x(\d+)/.exec(display.stdout);
        const w = dm ? parseInt(dm[1]) : 1080;
        const h = dm ? parseInt(dm[2]) : 2400;

        const macros: Record<string, Step[]> = {
          "home": [{ action: "tap", x: w / 2, y: h - 10 }],
          "back": [{ action: "tap", x: 30, y: h - 10 }],
          "recents": [{ action: "tap", x: w - 30, y: h - 10 }],
          "unlock": [
            { action: "tap", x: w / 2, y: h / 2 },
            { action: "swipe", x: w / 2, y: h * 0.8, x2: w / 2, y2: h * 0.2 },
          ],
          "notification_panel": [
            { action: "swipe", x: w / 2, y: 10, x2: w / 2, y2: h * 0.4 },
          ],
          "quick_settings": [
            { action: "swipe", x: w / 2, y: 10, x2: w / 2, y2: h * 0.6 },
          ],
        };

        const steps = macros[a.macro];
        if (!steps) return err(`Unknown macro: ${a.macro}`);
        runSteps(p, steps);

        let result = `Macro "${a.macro}" executed`;
        if (a.return_screen !== false) {
          result += "\n---\n" + screenSummary(p);
        }
        return ok(result);
      }

      // ── Button ──
      case "mobile_button": {
        const a = args as { button: string; return_screen?: boolean; serial?: string };
        const p = prep(a.serial);

        const keyMap: Record<string, string> = {
          "back": "KEYCODE_BACK",
          "home": "KEYCODE_HOME",
          "recent": "KEYCODE_APP_SWITCH",
          "menu": "KEYCODE_MENU",
          "volume_up": "KEYCODE_VOLUME_UP",
          "volume_down": "KEYCODE_VOLUME_DOWN",
          "power": "KEYCODE_POWER",
          "camera": "KEYCODE_CAMERA",
          "call": "KEYCODE_CALL",
        };

        const key = keyMap[a.button];
        if (!key) return err(`Unknown button: ${a.button}`);
        adb([...p, "shell", "input", "keyevent", key]);

        let result = `Pressed ${a.button}`;
        if (a.return_screen !== false) {
          result += "\n---\n" + screenSummary(p);
        }
        return ok(result);
      }

      // ── Type ──
      case "mobile_type": {
        const a = args as { text: string; clear_first?: boolean; return_screen?: boolean; serial?: string };
        const p = prep(a.serial);

        if (a.clear_first) {
          adb([...p, "shell", "input", "keyevent", "KEYCODE_MOVE_END"]);
          // Select all + delete
          for (let i = 0; i < 50; i++) {
            adb([...p, "shell", "input", "keyevent", "KEYCODE_DEL"]);
          }
        }
        adb([...p, "shell", "input", "text", a.text]);

        let result = `Typed: "${a.text}"`;
        if (a.return_screen !== false) {
          result += "\n---\n" + screenSummary(p);
        }
        return ok(result);
      }

      // ── Power ──
      case "mobile_power": {
        const a = args as { action: string; serial?: string };
        const p = getDevicePrefix(a.serial);

        if (a.action === "awake") {
          const wake = adb([...p, "shell", "dumpsys", "power"]);
          return ok(wake.stdout.includes("mWakefulness=Awake") ? "Device is awake" : "Device is sleeping");
        } else if (a.action === "on") {
          adb([...p, "shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
          return ok("Screen turned on");
        } else if (a.action === "off") {
          adb([...p, "shell", "input", "keyevent", "KEYCODE_SLEEP"]);
          return ok("Screen turned off");
        } else if (a.action === "reboot") {
          adb([...p, "reboot"]);
          return ok("Rebooting device...");
        }
        return err(`Unknown power action: ${a.action}`);
      }

      // ── Unlock Screen ──
      case "mobile_unlock_screen": {
        const a = args as { pin?: string; serial?: string };
        const p = prep(a.serial);

        // Wake screen
        adb([...p, "shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
        busySleep(500);

        // Swipe up to unlock
        const display = adb([...p, "shell", "wm", "size"]);
        const dm = /(\d+)x(\d+)/.exec(display.stdout);
        const w = dm ? parseInt(dm[1]) : 1080;
        const h = dm ? parseInt(dm[2]) : 2400;
        adb([...p, "shell", "input", "swipe",
          String(w / 2), String(h * 0.8),
          String(w / 2), String(h * 0.2),
          "300"]);
        busySleep(1000);

        // Enter PIN if provided
        if (a.pin) {
          adb([...p, "shell", "input", "text", a.pin]);
          busySleep(300);
          adb([...p, "shell", "input", "keyevent", "KEYCODE_ENTER"]);
        }

        return ok("Screen unlocked" + (a.pin ? " (PIN entered)" : ""));
      }

      // ── Wait ──
      case "mobile_wait": {
        const a = args as { text?: string; resource_id?: string; className?: string; description?: string; timeout?: number; disappear?: boolean; serial?: string };
        const p = prep(a.serial);
        const timeout = a.timeout ?? 10000;
        const start = Date.now();

        while (Date.now() - start < timeout) {
          const xml = captureUIXml(p);
          const elements = parseUIElements(xml);
          const found = findElement(elements, {
            text: a.text,
            resourceId: a.resource_id,
            className: a.className,
            description: a.description,
          });

          if (a.disappear && !found) return ok(`Element disappeared (waited ${Date.now() - start}ms)`);
          if (!a.disappear && found) return ok(`Element found (waited ${Date.now() - start}ms)`);

          busySleep(500);
        }

        return err(`Timeout (${timeout}ms) waiting for element to ${a.disappear ? "disappear" : "appear"}`);
      }

      // ── State ──
      case "mobile_state": {
        const a = args as { serial?: string };
        const p = getDevicePrefix(a.serial);

        const battery = adb([...p, "shell", "dumpsys", "battery"]);
        const batLevel = /level: (\d+)/.exec(battery.stdout)?.[1] ?? "?";
        const batStatus = /status: (\d+)/.exec(battery.stdout)?.[1] ?? "?";
        const statusMap: Record<string, string> = { "1": "unknown", "2": "charging", "3": "discharging", "4": "not charging", "5": "full" };

        const display = adb([...p, "shell", "wm", "size"]);
        const density = adb([...p, "shell", "wm", "density"]);

        const wake = adb([...p, "shell", "dumpsys", "power"]);
        const awake = wake.stdout.includes("mWakefulness=Awake") ? "awake" : "sleeping";

        const rotation = adb([...p, "shell", "dumpsys", "window", "rotations"]);
        const rotM = /Rotation: (\d)/.exec(rotation.stdout);
        const rotMap: Record<string, string> = { "0": "portrait", "1": "landscape", "2": "reverse portrait", "3": "reverse landscape" };

        const foreground = getForegroundPackage(p);

        const wifi = adb([...p, "shell", "dumpsys", "wifi"]);
        const wifiConnected = wifi.stdout.includes("Wi-Fi is connected") || wifi.stdout.includes("CONNECTED/CONNECTED");

        const lines = [
          `Battery: ${batLevel}% (${statusMap[batStatus] ?? "unknown"})`,
          `Screen: ${awake}`,
          `Display: ${display.stdout.trim()}`,
          `Density: ${density.stdout.trim()}`,
          `Rotation: ${rotMap[rotM?.[1] ?? "0"] ?? "unknown"}`,
          `Foreground app: ${foreground || "(unknown)"}`,
          `Wi-Fi: ${wifiConnected ? "connected" : "disconnected"}`,
        ];
        return ok(lines.join("\n"));
      }

      // ── Activity Manager ──
      case "mobile_activity_manager": {
        const a = args as { action?: string; data_uri?: string; package?: string; class_name?: string; extras?: string; serial?: string };
        const p = prep(a.serial);

        const intentParts: string[] = [];
        if (a.action) intentParts.push("-a", a.action);
        if (a.data_uri) intentParts.push("-d", a.data_uri);
        if (a.package) intentParts.push(a.package);
        if (a.class_name) {
          if (a.package) intentParts.push("-n", a.class_name.startsWith(a.package) ? a.class_name : `${a.package}/${a.class_name}`);
          else intentParts.push("-n", a.class_name);
        }
        if (a.extras) {
          try {
            const parsed = JSON.parse(a.extras);
            for (const [k, v] of Object.entries(parsed)) {
              if (typeof v === "string") intentParts.push("--es", k, v);
              else if (typeof v === "number") intentParts.push("--ei", k, String(v));
              else if (typeof v === "boolean") intentParts.push("--ez", k, String(v));
            }
          } catch {
            return err(`Invalid extras JSON: ${a.extras}`);
          }
        }

        adb([...p, "shell", "am", "start", ...intentParts]);
        return ok(`Activity started: ${intentParts.join(" ") || "(default launcher)"}`);
      }

      // ── Restart ADB ──
      case "mobile_restart_bridge": {
        adb(["kill-server"]);
        busySleep(2000);
        adb(["start-server"]);
        busySleep(1000);
        return ok("ADB server restarted");
      }

      // ── F-Droid Search (HTML parsing — API was removed) ──
      case "fdroid_search": {
        const a = args as { query: string; limit?: number };
        const limit = a.limit ?? 10;
        const url = `https://search.f-droid.org/?q=${encodeURIComponent(a.query)}`;
        const res = await fetch(url);
        if (!res.ok) return err(`F-Droid search error: ${res.status}`);
        const html = await res.text();
        // Parse HTML: each result is <a class="package-header" href=".../packages/PKGNAME">
        const pkgRegex = /href="https:\/\/f-droid\.org\/[^"]*\/packages\/([^"\/]+)"/g;
        const nameRegex = /<h4 class="package-name">\s*([^<]+)\s*<\/h4>/g;
        const descRegex = /<span class="package-summary">([^<]*)<\/span>/g;
        const pkgs: string[] = []; const names: string[] = []; const descs: string[] = [];
        let m;
        while ((m = pkgRegex.exec(html)) !== null && pkgs.length < limit) pkgs.push(m[1]);
        while ((m = nameRegex.exec(html)) !== null && names.length < limit) names.push(m[1].trim());
        while ((m = descRegex.exec(html)) !== null && descs.length < limit) descs.push(m[1].trim());
        if (pkgs.length === 0) return ok(`No F-Droid results for "${a.query}"`);
        const lines = pkgs.map((pkg, i) => {
          const name = names[i] || pkg;
          const desc = descs[i] || "";
          return `${pkg}\n  ${name}\n  ${desc.substring(0, 120)}`;
        });
        return ok(`F-Droid results for "${a.query}":\n\n${lines.join("\n\n")}`);
      }

      // ── F-Droid Download (HTML parsing — API was removed) ──
      case "fdroid_download": {
        const a = args as { package_name: string; output_dir?: string };
        const outDir = a.output_dir || "/tmp";
        // Fetch the package page to find APK download links
        const url = `https://f-droid.org/en/packages/${a.package_name}/`;
        const res = await fetch(url);
        if (!res.ok) return err(`F-Droid package page error: ${res.status}`);
        const html = await res.text();
        // Find the latest APK link: href="https://f-droid.org/repo/PKGNAME_VERSION.apk"
        const escapedPkg = a.package_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const apkRegex = new RegExp(`href="(https:\\/\\/f-droid\\.org\\/repo\\/${escapedPkg}_[^"]+\\.apk)"`);
        const apkMatch = apkRegex.exec(html);
        if (!apkMatch) return err(`No APK download link found for ${a.package_name}`);
        const apkUrl = apkMatch[1];
        const apkRes = await fetch(apkUrl);
        if (!apkRes.ok) return err(`Download failed: ${apkRes.status}`);
        const buffer = Buffer.from(await apkRes.arrayBuffer());
        const filename = `${a.package_name}.apk`;
        const outPath = path.join(outDir, filename);
        fs.writeFileSync(outPath, buffer);
        const sizeMb = (buffer.length / 1024 / 1024).toFixed(2);
        return ok(`Downloaded ${a.package_name} (${sizeMb} MB) to ${outPath}`);
      }

      // ── RuStore Search (API removed — no public endpoint available) ──
      case "rustore_search": {
        return err("RuStore public API has been removed. The search endpoint (www.rustore.ru/api/search) and all api.rustore.ru endpoints return 404. RuStore now uses a Next.js RSC-based frontend with Cloudflare challenge protection, making automated search impossible without a browser automation framework.");
      }

      // ── RuStore Download (API removed — no public endpoint available) ──
      case "rustore_download": {
        return err("RuStore public API has been removed. The download endpoint (www.rustore.ru/api/v1/apps/*/download) and all api.rustore.ru endpoints return 404. Automated APK downloads from RuStore are no longer possible via simple HTTP requests.");
      }

      // ── Password Manager ──
      case "password_manager": {
        const a = args as { action: string; app?: string; username?: string; password?: string };
        const pwDir = path.join(os.homedir(), ".config", "opencode", "passwords");
        fs.mkdirSync(pwDir, { recursive: true });

        if (a.action === "store") {
          if (!a.app || !a.username || !a.password) return err("app, username, and password are required for store");
          const data = { app: a.app, username: a.username, password: a.password };
          fs.writeFileSync(path.join(pwDir, `${a.app}.json`), JSON.stringify(data, null, 2), "utf8");
          return ok(`Stored credentials for ${a.app}`);
        } else if (a.action === "get") {
          if (!a.app) return err("app is required for get");
          const pwPath = path.join(pwDir, `${a.app}.json`);
          if (!fs.existsSync(pwPath)) return err(`No credentials stored for ${a.app}`);
          const data = JSON.parse(fs.readFileSync(pwPath, "utf8"));
          return ok(`App: ${data.app}\nUsername: ${data.username}\nPassword: ${data.password}`);
        } else if (a.action === "list") {
          const files = fs.readdirSync(pwDir).filter((f) => f.endsWith(".json"));
          if (files.length === 0) return ok("No stored credentials");
          const apps = files.map((f) => f.replace(".json", ""));
          return ok("Stored apps:\n" + apps.map((app) => `  ${app}`).join("\n"));
        } else if (a.action === "delete") {
          if (!a.app) return err("app is required for delete");
          const pwPath = path.join(pwDir, `${a.app}.json`);
          if (!fs.existsSync(pwPath)) return err(`No credentials stored for ${a.app}`);
          fs.unlinkSync(pwPath);
          return ok(`Deleted credentials for ${a.app}`);
        }
        return err(`Unknown action: ${a.action}`);
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e: any) {
    return err(`Error: ${e.message}`);
  }
});

// ── Start ──
const transport = new StdioServerTransport();
server.connect(transport);
console.error("Android MCP server running on stdio");
