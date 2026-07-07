export type DeviceInfo = {
    serial: string;
    status: string;
    model?: string;
};
export declare function getDevicePrefix(serial?: string): string[];
export declare function setDeviceSerial(serial: string): void;
export declare function getSelectedSerial(): string | null;
export declare function listDevices(): DeviceInfo[];
export declare function adb(args: string[], timeout?: number, retries?: number): {
    stdout: string;
    stderr: string;
    status: number;
};
export declare function checkDevice(p: string[]): void;
export declare function adbScreenCapture(p: string[]): string;
export declare function captureScreenSummary(p: string[]): string;
export declare function captureScreenshotRaw(p: string[]): Buffer;
export declare function captureUIXml(p: string[]): string;
