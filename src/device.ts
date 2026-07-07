import { spawnSync, SpawnSyncReturns } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseUIElements, formatElements, UIElement } from "./uixml";

export type DeviceInfo = { serial: string; status: string; model?: string };

const DEVICE_FILE = path.join(os.homedir(), ".config", "opencode", ".device_id");

export function getDevicePrefix(serial?: string): string[] {
  if (serial) return ["-s", serial];
  try {
    const s = fs.readFileSync(DEVICE_FILE, "utf8").trim();
    if (s) return ["-s", s];
  } catch {}
  return [];
}

export function setDeviceSerial(serial: string): void {
  fs.mkdirSync(path.dirname(DEVICE_FILE), { recursive: true });
  fs.writeFileSync(DEVICE_FILE, serial, "utf8");
}

export function getSelectedSerial(): string | null {
  try {
    return fs.readFileSync(DEVICE_FILE, "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function listDevices(): DeviceInfo[] {
  const r = spawnSync("adb", ["devices", "-l"], { encoding: "utf8", timeout: 5000 });
  if (r.error) throw new Error(`ADB error: ${r.error.message}`);
  const devices: DeviceInfo[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!/\bdevice\b/.test(line) && !/\bunauthorized\b/.test(line) && !/\boffline\b/.test(line)) continue;
    if (/^List of devices/.test(line)) continue;
    const parts = line.split(/\s+/);
    const modelMatch = line.match(/model:(\S+)/);
    devices.push({
      serial: parts[0],
      status: /\bdevice\b/.test(line) ? "device" : parts[1] || "unknown",
      model: modelMatch ? modelMatch[1] : undefined,
    });
  }
  return devices;
}

export function adb(args: string[], timeout = 30000, retries = 3): { stdout: string; stderr: string; status: number } {
  for (let i = 0; i <= retries; i++) {
    const result = spawnSync("adb", args, { encoding: "utf8", timeout, maxBuffer: 5 * 1024 * 1024 });
    if (!result.error && result.status === 0) return { stdout: result.stdout, stderr: result.stderr, status: result.status };
    if (result.error && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT" && i < retries) {
      const t = Date.now();
      while (Date.now() - t < (i + 1) * 1000) {}
      continue;
    }
    if (result.error) throw new Error(`ADB error: ${result.error.message}`);
    return { stdout: result.stdout, stderr: result.stderr, status: result.status ?? -1 };
  }
  throw new Error("ADB failed after retries");
}

export function checkDevice(p: string[]) {
  for (let i = 0; i <= 3; i++) {
    const r = spawnSync("adb", [...p, "get-state"], { encoding: "utf8", timeout: 5000 });
    if (!r.error && r.status === 0) return;
    if (i < 3) { const t = Date.now(); while (Date.now() - t < (i + 1) * 1000) {}; continue; }
  }
  throw new Error("Selected device not available");
}

export function adbScreenCapture(p: string[]): string {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const dump = spawnSync("adb", [...p, "shell", "uiautomator", "dump", "/sdcard/ui.xml"], { encoding: "utf8", timeout: 30000 });
    if (dump.error || dump.status !== 0) {
      if (attempt < 5) {
        const t = Date.now();
        while (Date.now() - t < attempt * 1000) {}
        continue;
      }
      throw new Error(`Screen dump failed after 5 attempts: ${dump.stderr || dump.error?.message}`);
    }
    const cat = spawnSync("adb", [...p, "shell", "cat", "/sdcard/ui.xml"], { encoding: "utf8", timeout: 15000 });
    if (cat.error || cat.status !== 0) {
      if (attempt < 5) {
        const t = Date.now();
        while (Date.now() - t < attempt * 1000) {}
        continue;
      }
      throw new Error(`Screen read failed after 5 attempts: ${cat.stderr || cat.error?.message}`);
    }
    return cat.stdout;
  }
  throw new Error("Screen capture failed");
}

export function captureScreenSummary(p: string[]): string {
  try {
    const xml = adbScreenCapture(p);
    const elements = parseUIElements(xml);
    return formatElements(elements);
  } catch {
    return "(screen capture failed)";
  }
}

export function captureScreenshotRaw(p: string[]): Buffer {
  const result = spawnSync("adb", [...p, "exec-out", "screencap", "-p"], { timeout: 15000 });
  if (result.error) throw new Error(`Screenshot error: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Screencap failed with code ${result.status}`);
  if (!result.stdout || result.stdout.length === 0) throw new Error("Screencap returned empty");
  return result.stdout as Buffer;
}

export function captureUIXml(p: string[]): string {
  adb([...p, "shell", "uiautomator", "dump", "/sdcard/ui.xml"]);
  return adb([...p, "shell", "cat", "/sdcard/ui.xml"]).stdout;
}
