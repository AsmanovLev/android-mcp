"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDevicePrefix = getDevicePrefix;
exports.setDeviceSerial = setDeviceSerial;
exports.getSelectedSerial = getSelectedSerial;
exports.listDevices = listDevices;
exports.adb = adb;
exports.checkDevice = checkDevice;
exports.adbScreenCapture = adbScreenCapture;
exports.captureScreenSummary = captureScreenSummary;
exports.captureScreenshotRaw = captureScreenshotRaw;
exports.captureUIXml = captureUIXml;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const uixml_1 = require("./uixml");
const DEVICE_FILE = path.join(os.homedir(), ".config", "opencode", ".device_id");
function getDevicePrefix(serial) {
    if (serial)
        return ["-s", serial];
    try {
        const s = fs.readFileSync(DEVICE_FILE, "utf8").trim();
        if (s)
            return ["-s", s];
    }
    catch { }
    return [];
}
function setDeviceSerial(serial) {
    fs.mkdirSync(path.dirname(DEVICE_FILE), { recursive: true });
    fs.writeFileSync(DEVICE_FILE, serial, "utf8");
}
function getSelectedSerial() {
    try {
        return fs.readFileSync(DEVICE_FILE, "utf8").trim() || null;
    }
    catch {
        return null;
    }
}
function listDevices() {
    const r = (0, child_process_1.spawnSync)("adb", ["devices", "-l"], { encoding: "utf8", timeout: 5000 });
    if (r.error)
        throw new Error(`ADB error: ${r.error.message}`);
    const devices = [];
    for (const line of r.stdout.split("\n")) {
        if (!/\bdevice\b/.test(line) && !/\bunauthorized\b/.test(line) && !/\boffline\b/.test(line))
            continue;
        if (/^List of devices/.test(line))
            continue;
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
function adb(args, timeout = 30000, retries = 3) {
    for (let i = 0; i <= retries; i++) {
        const result = (0, child_process_1.spawnSync)("adb", args, { encoding: "utf8", timeout, maxBuffer: 5 * 1024 * 1024 });
        if (!result.error && result.status === 0)
            return { stdout: result.stdout, stderr: result.stderr, status: result.status };
        if (result.error && result.error.code === "ETIMEDOUT" && i < retries) {
            const t = Date.now();
            while (Date.now() - t < (i + 1) * 1000) { }
            continue;
        }
        if (result.error)
            throw new Error(`ADB error: ${result.error.message}`);
        return { stdout: result.stdout, stderr: result.stderr, status: result.status ?? -1 };
    }
    throw new Error("ADB failed after retries");
}
function checkDevice(p) {
    for (let i = 0; i <= 3; i++) {
        const r = (0, child_process_1.spawnSync)("adb", [...p, "get-state"], { encoding: "utf8", timeout: 5000 });
        if (!r.error && r.status === 0)
            return;
        if (i < 3) {
            const t = Date.now();
            while (Date.now() - t < (i + 1) * 1000) { }
            ;
            continue;
        }
    }
    throw new Error("Selected device not available");
}
function adbScreenCapture(p) {
    for (let attempt = 1; attempt <= 5; attempt++) {
        const dump = (0, child_process_1.spawnSync)("adb", [...p, "shell", "uiautomator", "dump", "/sdcard/ui.xml"], { encoding: "utf8", timeout: 30000 });
        if (dump.error || dump.status !== 0) {
            if (attempt < 5) {
                const t = Date.now();
                while (Date.now() - t < attempt * 1000) { }
                continue;
            }
            throw new Error(`Screen dump failed after 5 attempts: ${dump.stderr || dump.error?.message}`);
        }
        const cat = (0, child_process_1.spawnSync)("adb", [...p, "shell", "cat", "/sdcard/ui.xml"], { encoding: "utf8", timeout: 15000 });
        if (cat.error || cat.status !== 0) {
            if (attempt < 5) {
                const t = Date.now();
                while (Date.now() - t < attempt * 1000) { }
                continue;
            }
            throw new Error(`Screen read failed after 5 attempts: ${cat.stderr || cat.error?.message}`);
        }
        return cat.stdout;
    }
    throw new Error("Screen capture failed");
}
function captureScreenSummary(p) {
    try {
        const xml = adbScreenCapture(p);
        const elements = (0, uixml_1.parseUIElements)(xml);
        return (0, uixml_1.formatElements)(elements);
    }
    catch {
        return "(screen capture failed)";
    }
}
function captureScreenshotRaw(p) {
    const result = (0, child_process_1.spawnSync)("adb", [...p, "exec-out", "screencap", "-p"], { timeout: 15000 });
    if (result.error)
        throw new Error(`Screenshot error: ${result.error.message}`);
    if (result.status !== 0)
        throw new Error(`Screencap failed with code ${result.status}`);
    if (!result.stdout || result.stdout.length === 0)
        throw new Error("Screencap returned empty");
    return result.stdout;
}
function captureUIXml(p) {
    adb([...p, "shell", "uiautomator", "dump", "/sdcard/ui.xml"]);
    return adb([...p, "shell", "cat", "/sdcard/ui.xml"]).stdout;
}
