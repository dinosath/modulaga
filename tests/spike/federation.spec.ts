import { expect, test } from "@playwright/test";

function protobufVarint(value: number) {
  const bytes: number[] = [];
  while (value > 127) { bytes.push((value & 127) | 128); value >>>= 7; }
  bytes.push(value);
  return bytes;
}

function protobufString(field: number, value: string) {
  const bytes = [...new TextEncoder().encode(value)];
  return [...protobufVarint(field * 8 + 2), ...protobufVarint(bytes.length), ...bytes];
}

test("mounts the remote selected by the configured workspace route", async ({
  page,
}) => {
  const remoteRequests: string[] = [];
  const catalog = {
    schemaVersion: 1,
    apps: [{
      id: "orders",
      name: "Orders",
      releases: [{
        id: "orders@1.2.0",
        version: "1.2.0",
        manifestUrl: "http://127.0.0.1:4174/mf-manifest.json",
        remoteName: "demo_react",
        exposedModule: "./mount",
      }],
    }],
  };
  const catalogResponse = new Uint8Array([
    ...protobufString(1, JSON.stringify(catalog)),
    ...protobufVarint(16), 1,
  ]);
  await page.route("http://127.0.0.1:4304/**", async (route) => {
    const request = route.request();
    await route.fulfill({
      status: request.method() === "OPTIONS" ? 204 : 200,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type,connect-protocol-version",
        "content-type": "application/proto",
      },
      body: request.method() === "OPTIONS" ? "" : Buffer.from(catalogResponse),
    });
  });
  page.on("request", (request) => {
    if (request.url().startsWith("http://127.0.0.1:4174/")) {
      remoteRequests.push(request.url());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Modulaga" })).toBeVisible();
  await page.getByRole("link", { name: "Orders", exact: true }).click();

  const remote = page.getByTestId("declared-remote-container");
  await expect(remote.getByText("React application loaded from a separate production build.", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Orders 1.2.0 mounted");
  await expect
    .poll(() => remote.locator(".remote-surface").evaluate((element) => getComputedStyle(element).borderInlineStartWidth))
    .toBe("4px");

  const counter = remote.getByRole("button", { name: "React remote clicks: 0" });
  await counter.click();
  await expect(
    remote.getByRole("button", { name: "React remote clicks: 1" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  await expect(remote.getByRole("button", { name: "React remote clicks: 0" })).toBeVisible();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(
    remote.getByRole("button", { name: "React remote clicks: 0" }),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page.getByTestId("declared-remote-container").getByText("React application loaded from a separate production build.", { exact: true })).toBeVisible();

  expect(remoteRequests.some((url) => url.endsWith("/mf-manifest.json"))).toBe(true);
  expect(remoteRequests.some((url) => url.endsWith("/remoteEntry.js"))).toBe(true);
  expect(remoteRequests.some((url) => url.endsWith(".css"))).toBe(true);
});

test("edits menus and dashboard settings with an immediate shell preview", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Edit workspace" }).click();
  await page.getByLabel("Group label").fill("Operations and support");
  await expect(page.locator(".preview-group-label")).toHaveText("Operations and support");

  await page.getByPlaceholder("Inventory").fill("Shipments");
  await page.locator(".add-link-form select").nth(2).selectOption("operations");
  await page.getByRole("button", { name: "Add link" }).click();
  await expect(page.locator(".preview-group a", { hasText: "Shipments" })).toBeVisible();

  await page.getByLabel("Menu placement").selectOption("top");
  await expect(page.locator(".preview-sidebar")).toHaveClass(/is-horizontal/);
  await page.getByLabel("Dashboard title").fill("Operations overview");
  await expect(page.locator(".preview-content-heading")).toHaveText("Operations overview");

  await page.getByLabel("Panel label").first().fill("Monthly shipments");
  await expect(page.locator(".preview-stat span").first()).toHaveText("Monthly shipments");
});
