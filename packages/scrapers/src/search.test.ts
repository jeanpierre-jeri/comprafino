import { describe, expect, it, vi } from "vitest";
import { createMetroAdapter } from "./metro.ts";
import { createPlazaVeaAdapter } from "./plaza-vea.ts";
import { createTottusAdapter } from "./tottus.ts";
import metro from "./fixtures/metro.json";
import plaza from "./fixtures/plaza-vea.json";
import tottus from "./fixtures/tottus.json";

function requestUrl(input: Parameters<typeof fetch>[0] | undefined): URL {
  if (input instanceof URL) return input;

  if (typeof input === "string") return new URL(input);

  if (input instanceof Request) return new URL(input.url);

  throw new Error("Expected retailer request");
}

describe("public retailer search adapters", () => {
  for (const [name, create, fixture] of [
    ["metro", createMetroAdapter, metro],
    ["plaza-vea", createPlazaVeaAdapter, plaza],
  ] as const) {
    it(`${name} uses encoded ft, anonymous channel and exactly one bounded page`, async () => {
      const fake = vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify(fixture), {
            headers: { resources: `0-${fixture.length - 1}/${fixture.length}` },
          }),
      );
      const r = await create(fake).searchProducts("atún & aceite", 2);
      expect(r.listings).toHaveLength(2);
      expect(fake).toHaveBeenCalledOnce();
      const url = requestUrl(fake.mock.calls[0]?.[0]);
      expect(url.searchParams.get("ft")).toBe("atún & aceite");
      expect(url.search).toContain("%20");
      expect(url.search).not.toContain("+");
      expect(url.searchParams.get("fq")).toBeNull();
      expect(url.searchParams.get("sc")).toBe("1");
      expect(url.searchParams.get("_from")).toBe("0");
      expect(url.searchParams.get("_to")).toBe("19");
    });
    it(`${name} allows empty search without treating it as ingestion failure`, async () => {
      const fake = vi.fn<typeof fetch>(
        async () => new Response("[]", { headers: { resources: "0-19/0" } }),
      );
      expect(await create(fake).searchProducts("inexistente", 10)).toEqual({
        listings: [],
        discovered: 0,
      });
    });
    it(`${name} accepts a short final page whose header retains the requested end`, async () => {
      const rows = fixture.slice(0, 2);
      const fake = vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify(rows), { headers: { resources: "0-19/2" } }),
      );
      const result = await create(fake).searchProducts("aceite primor", 10);
      expect(result.discovered).toBe(2);
      expect(fake).toHaveBeenCalledOnce();
    });
    it(`${name} stops on HTTP errors, malformed bounds and payloads without retry`, async () => {
      for (const response of [
        new Response("blocked", { status: 403 }),
        new Response("[]"),
        new Response("[]", { headers: { resources: "0-19/1" } }),
        new Response(JSON.stringify(Array.from({ length: 21 }, () => fixture[0])), {
          headers: { resources: "0-20/21" },
        }),
      ]) {
        const fake = vi.fn<typeof fetch>(async () => response);
        await expect(create(fake).searchProducts("arroz", 10)).rejects.toThrow(/search/iu);
        expect(fake).toHaveBeenCalledOnce();
      }
    });
  }

  it("Tottus searches Ntt through hydration and does not paginate", async () => {
    const fake = vi.fn<typeof fetch>(
      async () => new Response(`<script id="__NEXT_DATA__">${JSON.stringify(tottus)}</script>`),
    );
    const r = await createTottusAdapter(fake).searchProducts("arroz costeño", 2);
    expect(r.listings).toHaveLength(2);
    expect(fake).toHaveBeenCalledOnce();
    expect(requestUrl(fake.mock.calls[0]?.[0]).searchParams.get("Ntt")).toBe("arroz costeño");
  });
  it("Tottus accepts an explicit empty page and rejects unexpected page sizes", async () => {
    const data = structuredClone(tottus);
    data.props.pageProps.results = [];
    data.props.pageProps.pagination.count = 0;
    const fake = vi.fn<typeof fetch>(
      async () => new Response(`<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`),
    );
    expect(await createTottusAdapter(fake).searchProducts("inexistente", 10)).toEqual({
      listings: [],
      discovered: 0,
    });
  });
  it("rejects invalid input before retailer requests", async () => {
    const fake = vi.fn<typeof fetch>();

    for (const create of [createTottusAdapter, createMetroAdapter, createPlazaVeaAdapter]) {
      await expect(create(fake).searchProducts("??", 10)).rejects.toThrow(
        "Invalid discovery query",
      );
      await expect(create(fake).searchProducts("arroz", 11)).rejects.toThrow(/search/iu);
    }

    expect(fake).not.toHaveBeenCalled();
  });
});

it("prioritizes a requested brand before the adapter truncates the source page", async () => {
  const data = structuredClone(tottus);
  const template = data.props.pageProps.results[0]!;
  data.props.pageProps.results = Array.from({ length: 12 }, (_, index) => ({
    ...template,
    productId: String(1000 + index),
    url: `https://www.tottus.com.pe/tottus-pe/articulo/${1000 + index}/queso-edam`,
    skuId: String(2000 + index),
    displayName: index === 11 ? "Queso Edam Tottus 400 g" : "Queso Edam Vonk x Kg",
  }));
  data.props.pageProps.pagination.count = 12;
  const fake = vi.fn<typeof fetch>(
    async () => new Response(`<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`),
  );
  const result = await createTottusAdapter(fake).searchProducts("queso edam tottus", 10);
  expect(result.listings).toHaveLength(10);
  expect(result.listings[0]?.title).toBe("Queso Edam Tottus 400 g");
  expect(fake).toHaveBeenCalledOnce();
});

for (const [name, create, fixture, host] of [
  ["metro", createMetroAdapter, metro, "www.metro.pe"],
  ["plaza-vea", createPlazaVeaAdapter, plaza, "www.plazavea.com.pe"],
] as const) {
  it(`${name} prioritizes structured brand matches beyond the first ten source products`, async () => {
    const rows = Array.from({ length: 12 }, (_, index) => {
      const template = fixture[0]!;
      return {
        ...template,
        productId: String(1000 + index),
        productName: "Queso Edam 400 g",
        brand: index === 11 ? "ARO" : "VONK",
        link: `https://${host}/queso-edam-${index}/p`,
        items: [{ ...template.items[0]!, itemId: String(2000 + index), name: "Queso Edam 400 g" }],
      };
    });
    const fake = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(rows), { headers: { resources: "0-19/12" } }),
    );
    const result = await create(fake).searchProducts("queso edam aro", 10);
    expect(result.listings[0]?.sourceBrand).toBe("ARO");
    expect(result.listings).toHaveLength(10);
    expect(fake).toHaveBeenCalledOnce();
  });
}
