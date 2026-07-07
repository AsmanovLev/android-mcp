"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.busySleep = busySleep;
exports.findTouchDevice = findTouchDevice;
exports.touchDown = touchDown;
exports.touchMove = touchMove;
exports.touchUp = touchUp;
exports.gestureSwipe = gestureSwipe;
exports.runSteps = runSteps;
const child_process_1 = require("child_process");
const device_1 = require("./device");
function busySleep(ms) {
    const t = Date.now();
    while (Date.now() - t < ms) { }
}
function adbRaw(args, timeout = 30000) {
    const result = (0, child_process_1.spawnSync)("adb", args, { encoding: "utf8", timeout });
    if (result.error)
        throw new Error(`ADB error: ${result.error.message}`);
    return { stdout: result.stdout, stderr: result.stderr, status: result.status ?? -1 };
}
function findTouchDevice(p) {
    const out = (0, device_1.adb)([...p, "shell", "getevent", "-p"]);
    const lines = out.stdout.split("\n");
    let currentDev = "";
    for (const line of lines) {
        const addM = /^add device \d+: \/dev\/input\/(event\d+)/.exec(line.trim());
        if (addM) {
            currentDev = addM[1];
            continue;
        }
        if (currentDev && /^\s+0035\s/.test(line))
            return currentDev;
    }
    for (const dev of ["event1", "event0", "event2"]) {
        const r = adbRaw([...p, "shell", "sendevent", `/dev/input/${dev}`, "0", "0", "0"]);
        if (r.status === 0 || r.stderr?.includes("Operation not permitted"))
            return dev;
    }
    throw new Error("Could not find touch input device");
}
function sendEvent(p, dev, type, code, value) {
    (0, device_1.adb)([...p, "shell", "sendevent", `/dev/input/${dev}`, String(type), String(code), String(value)]);
}
function touchDown(p, dev, x, y, id = 0) {
    sendEvent(p, dev, 3, 57, id);
    sendEvent(p, dev, 3, 53, Math.round(x));
    sendEvent(p, dev, 3, 54, Math.round(y));
    sendEvent(p, dev, 1, 330, 1);
    sendEvent(p, dev, 0, 0, 0);
}
function touchMove(p, dev, x, y) {
    sendEvent(p, dev, 3, 53, Math.round(x));
    sendEvent(p, dev, 3, 54, Math.round(y));
    sendEvent(p, dev, 0, 0, 0);
}
function touchUp(p, dev) {
    sendEvent(p, dev, 1, 330, 0);
    sendEvent(p, dev, 3, 57, -1);
    sendEvent(p, dev, 0, 0, 0);
}
function gestureSwipe(p, _dev, x1, y1, x2, y2) {
    const dist = Math.abs(y2 - y1) + Math.abs(x2 - x1);
    const dur = Math.max(200, Math.min(800, Math.round(dist * 1.8)));
    (0, device_1.adb)([...p, "shell", "input", "swipe",
        String(Math.round(x1)), String(Math.round(y1)),
        String(Math.round(x2)), String(Math.round(y2)),
        String(dur)]);
    busySleep(dur + 100);
}
function runSteps(prefix, steps) {
    let touchDev = null;
    const needsTouch = steps.some((s) => s.action === "press" || s.action === "move" || s.action === "release" ||
        s.action === "hold" || s.action === "tap-hold" ||
        s.action === "swipe-hold-start" || s.action === "swipe-hold-end" || s.action === "swipe-hold-startend");
    if (needsTouch)
        touchDev = findTouchDevice(prefix);
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        if (s.delay)
            busySleep(s.delay);
        switch (s.action) {
            case "tap":
                (0, device_1.adb)([...prefix, "shell", "input", "tap", String(Math.round(s.x)), String(Math.round(s.y))]);
                break;
            case "swipe":
                if (s.x2 == null || s.y2 == null)
                    throw new Error(`Step ${i}: swipe requires x2, y2`);
                gestureSwipe(prefix, "", s.x, s.y, s.x2, s.y2);
                break;
            case "fastswipe":
                if (s.x2 == null || s.y2 == null)
                    throw new Error(`Step ${i}: fastswipe requires x2, y2`);
                const swArgs = ["shell", "input", "swipe",
                    String(Math.round(s.x)), String(Math.round(s.y)),
                    String(Math.round(s.x2)), String(Math.round(s.y2))];
                if (s.duration != null)
                    swArgs.push(String(s.duration));
                (0, device_1.adb)([...prefix, ...swArgs]);
                break;
            case "drag":
                if (s.x2 == null || s.y2 == null)
                    throw new Error(`Step ${i}: drag requires x2, y2`);
                (0, device_1.adb)([...prefix, "shell", "input", "swipe",
                    String(Math.round(s.x)), String(Math.round(s.y)),
                    String(Math.round(s.x2)), String(Math.round(s.y2)),
                    String(s.duration ?? 1000)]);
                break;
            case "tap-hold":
                if (!touchDev)
                    throw new Error("touch device not found");
                try {
                    touchDown(prefix, touchDev, s.x, s.y);
                    busySleep(s.duration ?? 500);
                    touchUp(prefix, touchDev);
                }
                catch {
                    (0, device_1.adb)([...prefix, "shell", "input", "swipe",
                        String(Math.round(s.x)), String(Math.round(s.y)),
                        String(Math.round(s.x)), String(Math.round(s.y)),
                        String(s.duration ?? 500)]);
                }
                break;
            case "press":
                if (!touchDev)
                    throw new Error("touch device not found");
                touchDown(prefix, touchDev, s.x, s.y);
                break;
            case "move":
                if (!touchDev)
                    throw new Error("touch device not found");
                touchMove(prefix, touchDev, s.x, s.y);
                break;
            case "release":
                if (!touchDev)
                    throw new Error("touch device not found");
                touchUp(prefix, touchDev);
                break;
            case "hold":
                if (!touchDev)
                    throw new Error("touch device not found");
                try {
                    touchDown(prefix, touchDev, s.x, s.y);
                    busySleep(s.duration ?? 500);
                    touchUp(prefix, touchDev);
                }
                catch {
                    (0, device_1.adb)([...prefix, "shell", "input", "swipe",
                        String(Math.round(s.x)), String(Math.round(s.y)),
                        String(Math.round(s.x)), String(Math.round(s.y)),
                        String(s.duration ?? 500)]);
                }
                break;
            case "swipe-hold-start": {
                if (!touchDev)
                    throw new Error("touch device not found");
                if (s.x2 == null || s.y2 == null)
                    throw new Error(`Step ${i}: swipe-hold-start requires x2, y2`);
                touchDown(prefix, touchDev, s.x, s.y);
                if (s.delay)
                    busySleep(s.delay);
                const st = Math.max(2, Math.floor((s.duration ?? 300) / 16));
                for (let j = 0; j <= st; j++) {
                    const t = j / st;
                    touchMove(prefix, touchDev, s.x + (s.x2 - s.x) * t, s.y + (s.y2 - s.y) * t);
                    busySleep(16);
                }
                touchUp(prefix, touchDev);
                break;
            }
            case "swipe-hold-end": {
                if (!touchDev)
                    throw new Error("touch device not found");
                if (s.x2 == null || s.y2 == null)
                    throw new Error(`Step ${i}: swipe-hold-end requires x2, y2`);
                touchDown(prefix, touchDev, s.x, s.y);
                const st2 = Math.max(2, Math.floor((s.duration ?? 300) / 16));
                for (let j = 0; j <= st2; j++) {
                    const t = j / st2;
                    touchMove(prefix, touchDev, s.x + (s.x2 - s.x) * t, s.y + (s.y2 - s.y) * t);
                    busySleep(16);
                }
                if (s.delay)
                    busySleep(s.delay);
                touchUp(prefix, touchDev);
                break;
            }
            case "swipe-hold-startend": {
                if (!touchDev)
                    throw new Error("touch device not found");
                if (s.x2 == null || s.y2 == null)
                    throw new Error(`Step ${i}: swipe-hold-startend requires x2, y2`);
                touchDown(prefix, touchDev, s.x, s.y);
                if (s.delay)
                    busySleep(s.delay);
                const st3 = Math.max(2, Math.floor((s.duration ?? 300) / 16));
                for (let j = 0; j <= st3; j++) {
                    const t = j / st3;
                    touchMove(prefix, touchDev, s.x + (s.x2 - s.x) * t, s.y + (s.y2 - s.y) * t);
                    busySleep(16);
                }
                if (s.delay)
                    busySleep(s.delay);
                touchUp(prefix, touchDev);
                break;
            }
        }
    }
}
