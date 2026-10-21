import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "@solidjs/web";
import NavigationStudio from "../../admin-panel/src/NavigationStudio";
import { defaultNavigation } from "./config/navigation";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  localStorage.clear();
});

describe("navigation studio", () => {
  it("renders the admin menu settings tabs and shell settings without a live preview", async () => {
    dispose = render(() => <NavigationStudio config={() => defaultNavigation} setConfig={() => undefined} saveConfig={async () => undefined} />, document.body);

    expect(document.querySelector("h1")?.textContent).toBe("Admin Menu Settings");
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(document.querySelectorAll(".menu-editor-item")).toHaveLength(2);
    expect(document.querySelector('[aria-label="Live menu preview"]')).toBeNull();
    expect(document.querySelector('[aria-label="Create application page"]')).toBeNull();
    expect([...document.querySelectorAll("h2")].some((heading) => heading.textContent?.trim() === "Add a menu link")).toBe(false);

    (document.querySelector("#admin-settings-tab") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector("#admin-settings-tab")?.getAttribute("aria-selected")).toBe("true"));
    expect(document.querySelector('[aria-label="Sidebar width"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Breadcrumb depth"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Welcome page title"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Welcome page description"]')).not.toBeNull();
    (document.querySelector("#admin-menu-tab") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector("#admin-menu-tab")?.getAttribute("aria-selected")).toBe("true"));
    expect(document.querySelector('[aria-label="Navigation preview"]')).toBeNull();
  });

  it("edits menu icons, chevrons, and nested submenu entries", async () => {
    const [config, setConfig] = createSignal(defaultNavigation);
    dispose = render(() => <NavigationStudio config={config} setConfig={setConfig} saveConfig={async () => undefined} />, document.body);
    const operations = config().menus[0]!.entries.find((entry) => entry.id === "operations")!;
    expect(operations.type).toBe("group");

    const icon = document.querySelector('[aria-label="Operations icon"]') as HTMLSelectElement;
    icon.value = "briefcase";
    icon.dispatchEvent(new Event("change", { bubbles: true }));
    const chevron = document.querySelector('[aria-label="Operations show chevron"]') as HTMLInputElement;
    chevron.checked = true;
    chevron.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => {
      const current = config().menus[0]!.entries.find((entry) => entry.id === "operations");
      expect(current?.icon).toBe("briefcase");
      expect(current?.type === "group" && current.chevron).toBe(true);
    });
    (document.querySelectorAll('[aria-label="Add submenu"]')[0] as HTMLButtonElement).click();
    await vi.waitFor(() => expect((config().menus[0]!.entries.find((entry) => entry.id === "operations") as { children: unknown[] }).children).toHaveLength(3));
  });

  it("moves the configured Settings group up and down and saves the new order", async () => {
    const withSettingsGroup = {
      ...defaultNavigation,
      menus: defaultNavigation.menus.map((menu) => ({ ...menu, entries: [...menu.entries, { id: "settings", type: "group" as const, label: "Settings", children: [] }] })),
    };
    const [config, setConfig] = createSignal(withSettingsGroup);
    const saveConfig = vi.fn().mockResolvedValue(undefined);
    dispose = render(() => <NavigationStudio config={config} setConfig={setConfig} saveConfig={saveConfig} />, document.body);

    (document.querySelector('[aria-label="More options for Settings"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Move Settings up"]')).not.toBeNull());
    (document.querySelector('[aria-label="Move Settings up"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(config().menus[0]?.entries.map((entry) => entry.id)).toEqual(["operations", "settings", "help-link"]));
    expect(config().menus[0]?.entries[1]?.type).toBe("group");
    expect((config().menus[0]?.entries[1] as { children: { id: string }[] }).children).toHaveLength(0);

    (document.querySelector('[aria-label="More options for Settings"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Move Settings down"]')).not.toBeNull());
    (document.querySelector('[aria-label="Move Settings down"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(config().menus[0]?.entries.map((entry) => entry.id)).toEqual(["operations", "help-link", "settings"]));
    ([...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Save changes") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(saveConfig).toHaveBeenCalledOnce());
  });

  it("drags a menu entry both above and below another entry", async () => {
    const withSettingsGroup = {
      ...defaultNavigation,
      menus: defaultNavigation.menus.map((menu) => ({ ...menu, entries: [...menu.entries, { id: "settings", type: "group" as const, label: "Settings", children: [] }] })),
    };
    const [config, setConfig] = createSignal(withSettingsGroup);
    dispose = render(() => <NavigationStudio config={config} setConfig={setConfig} saveConfig={async () => undefined} />, document.body);
    const transfer = {
      dropEffect: "",
      effectAllowed: "",
      value: "",
      setData(_format: string, value: string) { this.value = value; },
      getData(_format: string) { return this.value; },
    };
    const dispatchDrag = (target: Element, type: string, clientY = 0) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: transfer }, clientY: { value: clientY } });
      target.dispatchEvent(event);
    };
    const rows = () => [...document.querySelectorAll<HTMLElement>(".menu-editor-item")];
    const labels = () => rows().map((row) => row.querySelector("input")?.value);
    const setRowBounds = (row: HTMLElement) => Object.defineProperty(row, "getBoundingClientRect", { configurable: true, value: () => ({ top: 0, bottom: 100, height: 100, left: 0, right: 500, width: 500, x: 0, y: 0, toJSON: () => ({}) }) });

    let [group, link] = rows();
    setRowBounds(link!);
    dispatchDrag(group!.querySelector('[aria-label="Drag to reorder"]')!, "dragstart");
    dispatchDrag(link!, "dragover", 90);
    dispatchDrag(link!, "drop", 90);
    await vi.waitFor(() => expect(labels()).toEqual(["Help center", "Operations", "Settings"]));

    [link, group] = rows();
    setRowBounds(link!);
    dispatchDrag(group!.querySelector('[aria-label="Drag to reorder"]')!, "dragstart");
    dispatchDrag(link!, "dragover", 10);
    dispatchDrag(link!, "drop", 10);
    await vi.waitFor(() => expect(labels()).toEqual(["Operations", "Help center", "Settings"]));
  });
});
