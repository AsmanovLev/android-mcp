import { spawnSync } from "child_process";

export type Bounds = {
  x1: number; y1: number;
  x2: number; y2: number;
};

export type UIElement = {
  index: number;
  text: string;
  contentDesc: string;
  resourceId: string;
  shortResourceId: string;
  className: string;
  bounds: Bounds;
  center: { x: number; y: number };
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

function getAttr(attrs: string, name: string): string {
  const re = new RegExp(`${name}="([^"]*)"`);
  const m = re.exec(attrs);
  return m ? m[1] : "";
}

function isInteractive(attrs: string): boolean {
  const INTERACTIVE_CLASSES = [
    "android.widget.Button",
    "android.widget.ImageButton",
    "android.widget.EditText",
    "android.widget.CheckBox",
    "android.widget.Switch",
    "android.widget.RadioButton",
    "android.widget.Spinner",
    "android.widget.SeekBar",
    "android.widget.ProgressBar",
    "android.widget.RatingBar",
  ];
  const cls = getAttr(attrs, "class");
  return (
    getAttr(attrs, "focusable") === "true" ||
    getAttr(attrs, "clickable") === "true" ||
    getAttr(attrs, "long-clickable") === "true" ||
    getAttr(attrs, "checkable") === "true" ||
    getAttr(attrs, "scrollable") === "true" ||
    getAttr(attrs, "selected") === "true" ||
    getAttr(attrs, "password") === "true" ||
    INTERACTIVE_CLASSES.includes(cls)
  );
}

function parseBounds(attrs: string): Bounds | null {
  const m = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(attrs);
  if (!m) return null;
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  return { x1, y1, x2, y2 };
}

export function parseUIElements(xml: string): UIElement[] {
  const nodeRe = /<node\s+([^>]*?)\/?>/g;
  const elements: UIElement[] = [];
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = nodeRe.exec(xml)) !== null) {
    const attrs = match[1];
    if (!isInteractive(attrs)) continue;

    const bounds = parseBounds(attrs);
    if (!bounds) continue;

    const text = getAttr(attrs, "text");
    const desc = getAttr(attrs, "content-desc");
    const rawId = getAttr(attrs, "resource-id");
    const shortId = rawId.includes("/") ? rawId.split("/").pop()! : rawId;
    const cls = getAttr(attrs, "class");

    const clickable = getAttr(attrs, "clickable") === "true";
    const scrollable = getAttr(attrs, "scrollable") === "true";
    const checkable = getAttr(attrs, "checkable") === "true";
    const checked = getAttr(attrs, "checked") === "true";
    const focused = getAttr(attrs, "focused") === "true";
    const enabled = getAttr(attrs, "enabled") === "true";
    const pwd = getAttr(attrs, "password") === "true";
    const longClickable = getAttr(attrs, "long-clickable") === "true";
    const focusable = getAttr(attrs, "focusable") === "true";
    const selected = getAttr(attrs, "selected") === "true";

    const name = desc || text;
    const isEdit = cls === "android.widget.EditText";
    if (!name && !shortId && !isEdit && !clickable && !scrollable && !checkable && !focused && !pwd) {
      continue;
    }

    elements.push({
      index,
      text,
      contentDesc: desc,
      resourceId: rawId,
      shortResourceId: shortId,
      className: cls,
      bounds,
      center: {
        x: Math.round((bounds.x1 + bounds.x2) / 2),
        y: Math.round((bounds.y1 + bounds.y2) / 2),
      },
      clickable,
      longClickable,
      checkable,
      checked,
      scrollable,
      focusable,
      focused,
      enabled,
      password: pwd,
      selected,
    });
    index++;
  }

  return elements;
}

export function getForegroundPackage(p: string[]): string {
  try {
    const r = spawnSync("adb", [...p, "shell", "dumpsys", "window"], { encoding: "utf8", timeout: 5000 });
    if (r.error || r.status !== 0) return "";
    const m = /mCurrentFocus=.*?([\w.]+)\//.exec(r.stdout);
    if (m) return m[1];
    const m2 = /mFocusedApp=.*?([\w.]+)\//.exec(r.stdout);
    if (m2) return m2[1];
  } catch {}
  return "";
}

export function resolveResourceId(id: string, pkg: string): string {
  if (!id || id.includes("/") || id.includes(":")) return id;
  if (!pkg) return id;
  return `${pkg}:id/${id}`;
}

export function findElement(elements: UIElement[], selector: Selector, pkg = ""): UIElement | null {
  const index = selector.index ?? 0;
  const resolvedId = selector.resourceId ? resolveResourceId(selector.resourceId, pkg) : undefined;

  const filtered = elements.filter((el) => {
    if (resolvedId && el.resourceId !== resolvedId && el.shortResourceId !== selector.resourceId) return false;
    if (selector.text && el.text !== selector.text && el.contentDesc !== selector.text) return false;
    if (selector.description && el.contentDesc !== selector.description) return false;
    if (selector.className && el.className !== selector.className) return false;
    return true;
  });

  return filtered[index] ?? null;
}

export function formatElements(elements: UIElement[]): string {
  const MAX_NODES = 300;
  const out: string[] = [];

  for (const el of elements.slice(0, MAX_NODES)) {
    const attrs: string[] = [];
    if (el.text) attrs.push(`text="${el.text}"`);
    if (el.contentDesc && el.contentDesc !== el.text) attrs.push(`desc="${el.contentDesc}"`);
    if (el.password) attrs.push("password");
    if (el.clickable) attrs.push("clickable");
    if (el.scrollable) attrs.push("scrollable");
    if (el.checkable) attrs.push(`checkable${el.checked ? "=checked" : ""}`);
    if (el.focused) attrs.push("focused");
    if (!el.enabled) attrs.push("disabled");
    if (el.selected) attrs.push("selected");
    if (el.longClickable) attrs.push("long-clickable");

    const resId = el.shortResourceId ? ` id=${el.shortResourceId}` : "";
    out.push(`${el.index}: [${el.bounds.x1},${el.bounds.y1}][${el.bounds.x2},${el.bounds.y2}] ${el.className}${resId} ${attrs.join(" ")}`);
  }

  if (out.length === 0) return "(no interactive elements found)";
  if (elements.length > MAX_NODES) out.push(`... ${elements.length - MAX_NODES} more elements, truncated`);
  return out.join("\n");
}
