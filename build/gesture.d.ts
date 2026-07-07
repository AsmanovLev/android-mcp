export type Step = {
    action: "tap" | "swipe" | "fastswipe" | "tap-hold" | "drag" | "press" | "move" | "release" | "hold" | "swipe-hold-start" | "swipe-hold-end" | "swipe-hold-startend";
    x: number;
    y: number;
    x2?: number;
    y2?: number;
    duration?: number;
    delay?: number;
};
export declare function busySleep(ms: number): void;
export declare function findTouchDevice(p: string[]): string;
export declare function touchDown(p: string[], dev: string, x: number, y: number, id?: number): void;
export declare function touchMove(p: string[], dev: string, x: number, y: number): void;
export declare function touchUp(p: string[], dev: string): void;
export declare function gestureSwipe(p: string[], _dev: string, x1: number, y1: number, x2: number, y2: number): void;
export declare function runSteps(prefix: string[], steps: Step[]): void;
