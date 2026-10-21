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
    expect(operations.type).toBe("section");

    (document.querySelector('[aria-label="Add to Operations"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    (document.querySelector('[role="dialog"] [aria-label="Group"]') as HTMLInputElement).click();
    await vi.waitFor(() => expect([...document.querySelectorAll('[role="dialog"] button')].some((button) => button.textContent?.trim() === "Add group")).toBe(true));
    const groupName = document.querySelector('[aria-label="Menu item label"]') as HTMLInputElement;
    groupName.value = "Reports";
    groupName.dispatchEvent(new Event("input", { bubbles: true }));
    const createGroupButton = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent?.trim() === "Add group") as HTMLButtonElement;
    await vi.waitFor(() => expect(createGroupButton.disabled).toBe(false));
    createGroupButton.click();
    await vi.waitFor(() => expect((config().menus[0]!.entries[0] as { children: unknown[] }).children).toHaveLength(3));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    const group = (config().menus[0]!.entries[0] as { children: { id: string; label: string }[] }).children[2]!;
    (document.querySelector(`[aria-label="Edit group ${group.label}"]`) as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Edit group"));
    expect((document.querySelector('[role="dialog"] [aria-label="Menu item label"]') as HTMLInputElement).value).toBe("Reports");
    expect(document.querySelector('[role="dialog"] [role="treeitem"][aria-selected="true"]')?.textContent).toContain("Operations");
    const icon = document.querySelector('[role="dialog"] [aria-label="Menu item icon"]') as HTMLSelectElement;
    icon.value = "briefcase";
    icon.dispatchEvent(new Event("change", { bubbles: true }));
    expect(icon.value).toBe("briefcase");
    const submitEdit = document.querySelector('[role="dialog"] button[type="submit"]') as HTMLButtonElement;
    expect(submitEdit.disabled).toBe(false);
    submitEdit.click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(((config().menus[0]!.entries[0] as { children: { id: string; icon?: string }[] }).children.find((entry) => entry.id === group.id)?.icon)).toBe("briefcase"));
    const chevron = document.querySelector(`[aria-label="${group.label} show chevron"]`) as HTMLInputElement;
    chevron.checked = true;
    chevron.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => {
      const current = (config().menus[0]!.entries[0] as { children: { id: string; icon?: string; type: string; chevron?: boolean }[] }).children.find((entry) => entry.id === group.id);
      expect(current?.icon).toBe("briefcase");
      expect(current?.type === "group" && current.chevron).toBe(true);
    });
    (document.querySelector(`[aria-label="Add to ${group.label}"]`) as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    (document.querySelector('[role="dialog"] [aria-label="Group"]') as HTMLInputElement).click();
    await vi.waitFor(() => expect([...document.querySelectorAll('[role="dialog"] button')].some((button) => button.textContent?.trim() === "Add group")).toBe(true));
    const nestedGroupName = document.querySelector('[aria-label="Menu item label"]') as HTMLInputElement;
    nestedGroupName.value = "Nested reports";
    nestedGroupName.dispatchEvent(new Event("input", { bubbles: true }));
    const createNestedGroupButton = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent?.trim() === "Add group") as HTMLButtonElement;
    await vi.waitFor(() => expect(createNestedGroupButton.disabled).toBe(false));
    createNestedGroupButton.click();
    await vi.waitFor(() => expect(((config().menus[0]!.entries[0] as { children: { id: string; children?: unknown[] }[] }).children.find((entry) => entry.id === group.id)?.children)).toHaveLength(1));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    (document.querySelector(`[aria-label="Add to ${group.label}"]`) as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    (document.querySelector('[role="dialog"] [aria-label="Entry"]') as HTMLInputElement).click();
    await vi.waitFor(() => expect([...document.querySelectorAll('[role="dialog"] button')].some((button) => button.textContent?.trim() === "Add entry")).toBe(true));
    const entryLabel = document.querySelector('[aria-label="Menu item label"]') as HTMLInputElement;
    entryLabel.value = "Analytics report";
    entryLabel.dispatchEvent(new Event("input", { bubbles: true }));
    const createEntryButton = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent?.trim() === "Add entry") as HTMLButtonElement;
    await vi.waitFor(() => expect(createEntryButton.disabled).toBe(false));
    createEntryButton.click();
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Delete entry Analytics report"]')).not.toBeNull());
    (document.querySelector('[aria-label="Edit page Analytics report"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Edit entry"));
    expect((document.querySelector('[role="dialog"] [aria-label="Menu item label"]') as HTMLInputElement).value).toBe("Analytics report");
    const settingsParent = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] [role="treeitem"]')].find((button) => button.textContent?.trim() === "Settings");
    expect(settingsParent).toBeDefined();
    settingsParent?.click();
    expect(settingsParent?.querySelector<HTMLInputElement>("input")?.checked).toBe(true);
    (document.querySelector('[role="dialog"] button[type="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect((config().menus[0]!.entries.find((entry) => entry.id === "settings") as { children: { label: string }[] }).children.some((entry) => entry.label === "Analytics report")).toBe(true));
    (document.querySelector('[aria-label="Delete entry Analytics report"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Delete entry Analytics report"]')).toBeNull());
  });

  it("edits a section through the shared prefilled menu dialog without changing its order", async () => {
    const [config, setConfig] = createSignal(defaultNavigation);
    dispose = render(() => <NavigationStudio config={config} setConfig={setConfig} saveConfig={async () => undefined} />, document.body);
    (document.querySelector('[aria-label="Edit section Operations"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Edit section"));
    const name = document.querySelector('[role="dialog"] [aria-label="Menu item label"]') as HTMLInputElement;
    expect(name.value).toBe("Operations");
    name.value = "Commerce";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    (document.querySelector('[role="dialog"] button[type="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(config().menus[0]?.entries.map((entry) => entry.label)).toEqual(["Commerce", "Settings"]));
    expect(config().menus[0]?.entries.map((entry) => entry.id)).toEqual(["operations", "settings"]);
  });

  it("moves the configured Settings section up and down and saves the new order", async () => {
    const [config, setConfig] = createSignal(defaultNavigation);
    const saveConfig = vi.fn().mockResolvedValue(undefined);
    dispose = render(() => <NavigationStudio config={config} setConfig={setConfig} saveConfig={saveConfig} />, document.body);

    (document.querySelector('[aria-label="More options for Settings"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Move Settings up"]')).not.toBeNull());
    (document.querySelector('[aria-label="Move Settings up"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(config().menus[0]?.entries.map((entry) => entry.id)).toEqual(["settings", "operations"]));
    expect(config().menus[0]?.entries[0]?.type).toBe("section");
    expect((config().menus[0]?.entries[0] as { children: { id: string }[] }).children[0]?.id).toBe("help-link");

    (document.querySelector('[aria-label="More options for Settings"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Move Settings down"]')).not.toBeNull());
    (document.querySelector('[aria-label="Move Settings down"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(config().menus[0]?.entries.map((entry) => entry.id)).toEqual(["operations", "settings"]));
    ([...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Save changes") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(saveConfig).toHaveBeenCalledOnce());
  });

  it("drags a menu entry both above and below another entry", async () => {
    const [config, setConfig] = createSignal(defaultNavigation);
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
    const labels = () => rows().map((row) => row.querySelector("span.min-w-32")?.textContent?.trim());
    const setRowBounds = (row: HTMLElement) => Object.defineProperty(row, "getBoundingClientRect", { configurable: true, value: () => ({ top: 0, bottom: 100, height: 100, left: 0, right: 500, width: 500, x: 0, y: 0, toJSON: () => ({}) }) });

    let [group, link] = rows();
    setRowBounds(link!);
    dispatchDrag(group!.querySelector('[aria-label="Drag to reorder"]')!, "dragstart");
    dispatchDrag(link!, "dragover", 90);
    dispatchDrag(link!, "drop", 90);
    await vi.waitFor(() => expect(labels()).toEqual(["Settings", "Operations"]));

    [link, group] = rows();
    setRowBounds(link!);
    dispatchDrag(group!.querySelector('[aria-label="Drag to reorder"]')!, "dragstart");
    dispatchDrag(link!, "dragover", 10);
    dispatchDrag(link!, "drop", 10);
    await vi.waitFor(() => expect(labels()).toEqual(["Operations", "Settings"]));
  });
});
