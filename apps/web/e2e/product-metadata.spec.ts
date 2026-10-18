import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { productReadFixture } from "../../../packages/db/src/testing/product-read-fixture.ts";
import { closeLocalTestConnections } from "../../../packages/db/src/testing/test-query-client.ts";

const productId = process.env.COMPRAFINO_E2E_PRODUCT_READ_ID;
const productTitle = "Leche Gloria Entera 946ml · fixture metadata";

test.describe("product metadata and page request deduplication", () => {
  // Other specs use different products; only these cases mutate this counter/group.
  test.describe.configure({ mode: "default" });
  test.skip(!productId, "Requires the owned PostgreSQL fixture harness after build");

  test.beforeEach(async () => {
    await productReadFixture(productId).reset();
  });
  test.afterAll(() => closeLocalTestConnections());

  for (const [query, statusText] of [
    [
      "",
      "El precio principal no requiere tarjeta ni membresía. Los beneficios se muestran aparte.",
    ],
    [
      "?priceMode=standard",
      "El precio principal no requiere tarjeta ni membresía. Los beneficios se muestran aparte.",
    ],
    ["?priceMode=benefits", "Incluye ofertas que requieren tarjeta CMR."],
    [
      "?priceMode=unexpected",
      "El precio principal no requiere tarjeta ni membresía. Los beneficios se muestran aparte.",
    ],
    [
      "?priceMode=benefits&priceMode=standard",
      "El precio principal no requiere tarjeta ni membresía. Los beneficios se muestran aparte.",
    ],
  ]) {
    test(`shares one comparison read for ${query || "the default mode"}`, async ({ request }) => {
      // Full HTTP responses finish both the page and streamed metadata. No mocked cache.
      for (let requestNumber = 1; requestNumber <= 2; requestNumber++) {
        const response = await request.get(`/products/${productId}${query}`);
        expect(response.status()).toBe(200);
        const html = await response.text();
        // A second request must read again; there is no process-wide cache.
        expect(await productReadFixture(productId).attempts()).toBe(requestNumber);
        expect(html).toContain(`<title>${productTitle} – precios | CompraFino</title>`);
        expect(html).toContain("Menor precio sin tarjeta ni membresía");
        expect(html).toContain("S/ 5.40");
        expect(html).toContain("Con tarjeta CMR");
        expect(html).toContain(statusText);
      }
    });
  }

  test("keeps invalid and missing IDs as not found", async ({ request }) => {
    for (const id of ["invalid-id", randomUUID()]) {
      const response = await request.get(`/products/${id}`);
      // Next's loading boundary may have started a 200 stream before notFound().
      expect([200, 404]).toContain(response.status());
      const html = await response.text();
      expect(html).toContain("This page could not be found.");
      expect(html).toContain('<meta name="robots" content="noindex"');
      expect(html).not.toContain("No pudimos cargar los precios.");
    }
    expect(await productReadFixture(productId).attempts()).toBe(0);
  });

  test("shares an ineligible product result and keeps it unavailable", async ({ request }) => {
    const fixture = productReadFixture(productId);
    await fixture.setEligible(false);
    try {
      const response = await request.get(`/products/${productId}?priceMode=benefits`);
      expect([200, 404]).toContain(response.status());
      const html = await response.text();
      expect(html).toContain("This page could not be found.");
      expect(html).toContain('<meta name="robots" content="noindex"');
      expect(html).not.toContain("No pudimos cargar los precios.");
      expect(await fixture.attempts()).toBe(1);
    } finally {
      await fixture.setEligible(true);
    }
  });

  test("shares a read failure and recovers on the next request", async ({ request }) => {
    const fixture = productReadFixture(productId);
    await fixture.failReads(true);
    try {
      const response = await request.get(`/products/${productId}?priceMode=benefits`);
      const html = await response.text();
      expect(response.status()).toBe(200);
      expect(html).toContain("No pudimos cargar los precios.");
      expect(html).toContain("<title>Comparar precios | CompraFino</title>");
      expect(html).not.toContain("Controlled fixture read failure");
      expect(await fixture.attempts()).toBe(1);
    } finally {
      await fixture.failReads(false);
    }
    const recovered = await request.get(`/products/${productId}?priceMode=benefits`);
    expect(recovered.status()).toBe(200);
    expect(await recovered.text()).toContain(
      `<title>${productTitle} – precios | CompraFino</title>`,
    );
    expect(await fixture.attempts()).toBe(2);
  });
});
