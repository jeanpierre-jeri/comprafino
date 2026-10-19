import { expect, test } from "./fixtures";

test("auth rate limits stay enforced within one client and isolated from another", async ({
  request,
  page,
  browser,
  baseURL,
  extraHTTPHeaders,
}) => {
  test.skip(!process.env.COMPRAFINO_CONTROLLED_E2E, "Requires the owned local fixture server");
  const sessionPath = "/api/auth/get-session";
  const initial = await request.get(sessionPath);
  expect(initial.status()).toBe(200);
  expect(await initial.json()).toBeNull();

  // Exercise the production limiter (100 requests / 10 seconds), not a mock
  // or a test-only limit override. Parallel requests also cover atomic admission.
  const responses = await Promise.all(Array.from({ length: 100 }, () => request.get(sessionPath)));
  expect(responses.some((response) => response.status() === 429)).toBe(true);
  expect(responses.every((response) => [200, 429].includes(response.status()))).toBe(true);

  const blockedSession = page.waitForResponse(
    (response) => new URL(response.url()).pathname === sessionPath,
  );
  await page.goto("/");
  const blocked = await blockedSession;
  expect(blocked.status()).toBe(429);
  expect(Number(blocked.headers()["x-retry-after"])).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Iniciar sesión", exact: true })).toBeDisabled();

  // A separate synthetic client's /64 must remain usable while the first is
  // blocked. This context still talks to the same server and real auth handler.
  const other = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { ...extraHTTPHeaders, "x-forwarded-for": "2001:db8:ffff:ffff::1" },
  });
  try {
    const otherPage = await other.newPage();
    const freshSession = otherPage.waitForResponse(
      (response) => new URL(response.url()).pathname === sessionPath,
    );
    await otherPage.goto("/");
    expect((await freshSession).status()).toBe(200);
    await expect(
      otherPage.getByRole("button", { name: "Iniciar sesión", exact: true }),
    ).toBeEnabled();
  } finally {
    await other.close();
  }
});
