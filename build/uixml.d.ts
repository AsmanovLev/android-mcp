export type Bounds = {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
};
export type UIElement = {
    index: number;
    text: string;
    contentDesc: string;
    resourceId: string;
    shortResourceId: string;
    className: string;
    bounds: Bounds;
    center: {
        x: number;
        y: number;
    };
    clickable: boolean;
    longClickable: boolean;
    checkable: boolean;
    checked: boolean;
    scrollable: boolean;
    focusable: boolean;
    focused: boolean;
    enabled: boolean;
    password: boolean;
    selected: boolean;
};
export type Selector = {
    text?: string;
    resourceId?: string;
    className?: string;
    description?: string;
    index?: number;
};
export declare function parseUIElements(xml: string): UIElement[];
export declare function getForegroundPackage(p: string[]): string;
export declare function resolveResourceId(id: string, pkg: string): string;
export declare function findElement(elements: UIElement[], selector: Selector, pkg?: string): UIElement | null;
export declare function formatElements(elements: UIElement[]): string;
