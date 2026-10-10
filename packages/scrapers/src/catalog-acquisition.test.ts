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
import metro from "./fixtures/metro.json";
import type { CatalogSourceClaim } from "@comprafino/core";

const claim: CatalogSourceClaim = {
  id: "00000000-0000-4000-8000-000000000001",
  token: "00000000-0000-4000-8000-000000000002",
  retailer: "metro",
  key: "1001196",
  name: "Papel",
  cursor: 20,
  url: "https://www.metro.pe/api/catalog_system/pub/products/search?fq=C%3A%2F1900%2F1001195%2F1001196%2F&sc=1",
};

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
