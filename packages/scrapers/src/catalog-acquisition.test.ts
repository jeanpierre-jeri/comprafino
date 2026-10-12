import { expect, it, vi } from "vitest";
import { acquireCatalogPages } from "./catalog-acquisition.ts";
import type { CatalogAcquisitionTasks } from "./catalog-acquisition.ts";
import {
  CatalogAccessRestriction,
  parseTottusCatalogSources,
  parseVtexCatalogSources,
  fetchCatalogPage,
} from "./catalog-sources.ts";
import fixture from "./fixtures/tottus.json";
import productFixture from "./fixtures/tottus-product.json";
import metro from "./fixtures/metro.json";
import type { CatalogSourceClaim } from "@comprafino/core";
import type { ReportProgress } from "../../../scripts/cli-progress.ts";

const claim: CatalogSourceClaim = {
  id: "00000000-0000-4000-8000-000000000001",
  token: "00000000-0000-4000-8000-000000000002",
  retailer: "metro",
  key: "1001196",
  name: "Papel",
  cursor: 20,
  url: "https://www.metro.pe/api/catalog_system/pub/products/search?fq=C%3A%2F1900%2F1001195%2F1001196%2F&sc=1",
};

const tottusClaim: CatalogSourceClaim = {
  ...claim,
  retailer: "tottus",
  key: "CATG43329",
  cursor: 0,
  url: "https://www.tottus.com.pe/tottus-pe/lista/CATG43329/Simple",
};
const productUrl = "https://www.tottus.com.pe/tottus-pe/articulo/113706602/aceite-primor/113706603";

it.each(["valid", "missing-unit", "unavailable"])(
  "handles a single-product category redirect with %s evidence",
  async (scenario) => {
    const data = structuredClone(productFixture);
    const variant = data.props.pageProps.productData.variants[0]!;
    if (scenario === "missing-unit") {
      Reflect.deleteProperty(variant.attributes.measurement, "unidad-de-medida");
    }
    if (scenario === "unavailable") {
      variant.isPurchaseable = false;
    }
    const fetchPage = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: productUrl } }))
      .mockResolvedValueOnce(
        new Response(`<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`),
      );
    const result = await fetchCatalogPage(tottusClaim, fetchPage);
    const expectedListing = expect.objectContaining({
      externalId: "113706603",
      currentPriceCents: 970,
    });
    expect(result.nextCursor).toBeNull();
    expect(result.discovered).toBe(1);
    expect(result.listings).toEqual(scenario === "valid" ? [expectedListing] : []);
    expect(fetchPage.mock.calls[0]![1]?.redirect).toBe("manual");
    expect(fetchPage.mock.calls[1]![1]?.redirect).toBe("error");
  },
);

it("rejects redirected product hydration with a different identity", async () => {
  const data = structuredClone(productFixture);
  data.props.pageProps.productData.id = "999";
  const fetchPage = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: productUrl } }))
    .mockResolvedValueOnce(
      new Response(`<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`),
    );
  await expect(fetchCatalogPage(tottusClaim, fetchPage)).rejects.toThrow(/identity/u);
});

it.each([
  "https://example.com/tottus-pe/articulo/113706602/aceite/113706603",
  "https://www.tottus.com.pe/login",
  `${productUrl}?token=example`,
  "https://user:password@www.tottus.com.pe/tottus-pe/articulo/113706602/aceite/113706603",
  tottusClaim.url,
  "https://www.tottus.com.pe/tottus-pe",
  "https://www.tottus.com.pe/tottus-pe/lista/CATG999/Other",
  "https://www.tottus.com.pe/tottus-pe/lista/CATG43329/Renamed?page=9",
])("rejects an untrusted category redirect without another request: %s", async (location) => {
  const fetchPage = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }));
  await expect(fetchCatalogPage(tottusClaim, fetchPage)).rejects.toThrow(/redirect/u);
  expect(fetchPage).toHaveBeenCalledOnce();
});

it("follows one renamed category slug preserving the category and requested page", async () => {
  const data = structuredClone(fixture);
  data.props.pageProps.pagination.currentPage = 5;
  const fetchPage = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(null, {
        status: 301,
        headers: { location: "/tottus-pe/lista/CATG43329/Renamed" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(`<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`),
    );
  const result = await fetchCatalogPage({ ...tottusClaim, cursor: 4 }, fetchPage);
  expect(result.discovered).toBe(data.props.pageProps.results.length);
  const target = fetchPage.mock.calls[1]![0];
  if (!(target instanceof URL)) {
    throw new Error("Expected a public category URL");
  }
  expect(target.href).toBe("https://www.tottus.com.pe/tottus-pe/lista/CATG43329/Renamed?page=5");
  expect(fetchPage.mock.calls[1]![1]?.redirect).toBe("error");
});

it("rejects a second redirect and preserves access restriction handling on the product", async () => {
  for (const status of [302, 403]) {
    const fetchPage = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: productUrl } }))
      .mockResolvedValueOnce(new Response(null, { status, headers: { location: productUrl } }));
    await expect(fetchCatalogPage(tottusClaim, fetchPage)).rejects.toThrow(
      /Public catalog request failed|public source restricted/u,
    );
    expect(fetchPage).toHaveBeenCalledTimes(2);
  }
});

it("classifies homepage redirects without treating them as empty completed categories", async () => {
  const work = tasks();
  work.fetchPage.mockImplementation(() =>
    fetchCatalogPage(
      tottusClaim,
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://www.tottus.com.pe/tottus-pe" },
        }),
    ),
  );
  const result = await acquireCatalogPages(work, 1);
  expect(result.failedPages).toBe(1);
  expect(result.failures[0]?.diagnostic).toMatchObject({
    sourceResponseCode: "redirect_to_home",
    httpStatus: 302,
  });
  expect(work.fail).toHaveBeenCalledWith(claim, "redirect_to_home");
  expect(work.complete).not.toHaveBeenCalled();
});

function tasks() {
  return {
    claim: vi
      .fn<CatalogAcquisitionTasks["claim"]>()
      .mockResolvedValueOnce(claim)
      .mockResolvedValue(null),
    fetchPage: vi
      .fn<CatalogAcquisitionTasks["fetchPage"]>()
      .mockResolvedValue({ listings: [], discovered: 20, nextCursor: 40 }),
    persist: vi
      .fn<CatalogAcquisitionTasks["persist"]>()
      .mockResolvedValue({ persisted: 1, changed: 1, skippedByCapacity: 0 }),
    complete: vi.fn<CatalogAcquisitionTasks["complete"]>().mockResolvedValue(undefined),
    fail: vi.fn<CatalogAcquisitionTasks["fail"]>().mockResolvedValue(undefined),
    pause: vi.fn<CatalogAcquisitionTasks["pause"]>().mockResolvedValue(undefined),
  };
}

it("advances an empty usable page without confusing zero seller offers with end of category", async () => {
  const work = tasks();
  expect(await acquireCatalogPages(work, 3)).toMatchObject({
    completedPages: 1,
    fetched: 20,
    failedPages: 0,
  });
  expect(work.persist).not.toHaveBeenCalled();
  expect(work.complete).toHaveBeenCalledWith(claim, 40, 20, [], 0);
});

it("reports real page progress and early exhaustion without claiming the whole budget completed", async () => {
  const work = tasks();
  const progress = vi.fn<ReportProgress>();
  await acquireCatalogPages(work, 100, progress);
  expect(progress).toHaveBeenCalledWith(
    "metro: páginas de esta corrida",
    1,
    100,
    "0 observaciones guardadas; 0 fallos",
  );
  expect(progress).toHaveBeenLastCalledWith("Adquisición sin más categorías elegibles", 1, 100);
});

it("retains the cursor when fetching fails and stops the retailer on access restriction", async () => {
  const work = tasks();
  work.fetchPage.mockRejectedValue(new CatalogAccessRestriction("restricted"));
  expect(await acquireCatalogPages(work, 10)).toMatchObject({
    restricted: true,
    failedPages: 1,
    completedPages: 0,
  });
  expect(work.claim).toHaveBeenCalledOnce();
  expect(work.complete).not.toHaveBeenCalled();
  expect(work.fail).toHaveBeenCalledWith(claim);
});

it("uses verified tree leaf paths and Makro's public sales channel, excluding marketplace departments", () => {
  const raw = [
    {
      id: 399,
      name: "Limpieza",
      children: [{ id: 1627, name: "Papeles", children: [{ id: 402, name: "Papel higiénico" }] }],
    },
    { id: 900, name: "Tecnología", children: [{ id: 901, name: "TV" }] },
  ];
  const sources = parseVtexCatalogSources(raw, "makro");
  expect(sources).toHaveLength(1);
  expect(new URL(sources[0]!.url).searchParams.get("fq")).toBe("C:/399/1627/402/");
  expect(new URL(sources[0]!.url).searchParams.get("sc")).toBe("9");
  expect(() => parseVtexCatalogSources([{ id: "402", name: "Papel" }], "metro")).toThrow(
    /Invalid/u,
  );
});

it("takes Tottus categories only from the explicit navigation hydration", () => {
  const raw = {
    props: {
      pageProps: {
        serverData: {
          headerData: {
            sisNavigationMenu: {
              entry: {
                categories: [
                  {
                    item_name: "Limpieza",
                    item_url: {
                      href: "https://www.tottus.com.pe/tottus-pe/lista/CATG16051/Limpieza",
                    },
                    second_level_categories: [
                      {
                        item_name: "Papel higiénico",
                        item_url:
                          "https://www.tottus.com.pe/tottus-pe/lista/CATG16682/Papeles-Higienicos",
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    },
  };
  expect(
    parseTottusCatalogSources(`<script id="__NEXT_DATA__">${JSON.stringify(raw)}</script>`),
  ).toMatchObject([{ retailer: "tottus", key: "CATG16682" }]);
  expect(() =>
    parseTottusCatalogSources('<a href="/tottus-pe/lista/CATG16682/Papeles">Papel</a>'),
  ).toThrow(/hydration/u);
});

it("continues beyond the former 500-product source boundary", async () => {
  const products = Array.from({ length: 20 }, () => metro[0]);
  const fetchPage = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify(products), { headers: { resources: "500-519/1000" } }),
    );
  const result = await fetchCatalogPage({ ...claim, cursor: 500 }, fetchPage);
  expect(result.nextCursor).toBe(520);
  const requested = fetchPage.mock.calls[0]![0];
  if (!(requested instanceof URL)) {
    throw new Error("Expected a public source URL");
  }
  expect(requested.searchParams.get("_from")).toBe("500");
});

it("rejects mismatched source pagination before committing any progress", async () => {
  const fetchPage = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify(metro), { headers: { resources: "0-19/1000" } }),
    );
  await expect(fetchCatalogPage(claim, fetchPage)).rejects.toThrow(/range/u);
  const tottus = {
    ...claim,
    retailer: "tottus" as const,
    key: "CATG16076",
    cursor: 4,
    url: "https://www.tottus.com.pe/tottus-pe/lista/CATG16076/Carnes",
  };
  await expect(
    fetchCatalogPage(
      tottus,
      async () => new Response(`<script id="__NEXT_DATA__">${JSON.stringify(fixture)}</script>`),
    ),
  ).rejects.toThrow(/pagination/u);
});
