import { z } from "zod";
import { catalogSourceSchema, SourceResponseError } from "@comprafino/core";
import type { CatalogSource, CatalogSourceClaim, RetailerId } from "@comprafino/core";
import { parseTottusPage } from "./tottus-parser.ts";
import { parseTottusCatalogProduct } from "./targeted.ts";
import { parsePlazaVeaPage, plazaVeaCatalogUrl } from "./plaza-vea.ts";
import { parseMetroPage, metroCatalogUrl } from "./metro.ts";
import { parseMakroPage, makroCatalogUrl } from "./makro.ts";
import { assertPublicAccess } from "./public-access.ts";
export { CatalogAccessRestriction } from "./public-access.ts";

const storefronts = {
  "plaza-vea": { origin: "https://www.plazavea.com.pe", catalog: plazaVeaCatalogUrl, channel: "1" },
  metro: { origin: "https://www.metro.pe", catalog: metroCatalogUrl, channel: "1" },
  makro: { origin: "https://www.makro.plazavea.com.pe", catalog: makroCatalogUrl, channel: "9" },
} as const;

// Grocery, household and personal-care scope. Shared VTEX trees can also contain
// marketplace departments; tree membership never establishes seller/stock evidence.
const departments = new Set([
  "Abarrotes",
  "Bebidas",
  "Aguas y Bebidas",
  "Limpieza",
  "Mascotas",
  "Frutas y Verduras",
  "Congelados",
  "Quesos y Fiambres",
  "Embutidos y Fiambres",
  "Panadería y Pastelería",
  "Carnes, Aves y Pescados",
  "Lácteos y Huevos",
  "Lácteos",
  "Desayunos",
  "Desayuno",
  "Cuidado Personal y Salud",
  "Higiene, Salud y Belleza",
  "Belleza",
  "Bebé e Infantil",
  "Niños y Bebés",
  "Mercado Saludable",
  "Pollo Rostizado y Comidas Preparadas",
  "Comidas y Rostizados",
  "Vinos, licores y cervezas",
  "Cervezas, Vinos y Licores",
]);

type CategoryNode = { id: number; name: string; children: CategoryNode[] };
const categoryNode: z.ZodType<CategoryNode> = z.lazy(() =>
  z.object({
    id: z.number().int().positive(),
    name: z.string().min(1),
    children: z.array(categoryNode).default([]),
  }),
);

export function parseVtexCatalogSources(
  raw: unknown,
  retailer: keyof typeof storefronts,
): CatalogSource[] {
  const roots = z.array(categoryNode).max(5000).parse(raw);
  const storefront = storefronts[retailer];
  const sources: CatalogSource[] = [];
  function visit(node: CategoryNode, parents: number[], names: string[]) {
    if (parents.length > 8 || sources.length >= 5000) {
      throw new Error("Public category tree exceeds bounded structure");
    }
    const path = [...parents, node.id];
    const categoryNames = [...names, node.name];
    if (node.children.length) {
      for (const child of node.children) {
        visit(child, path, categoryNames);
      }
      return;
    }
    const url = new URL(storefront.catalog);
    url.searchParams.set("fq", `C:/${path.join("/")}/`);
    url.searchParams.set("sc", storefront.channel);
    sources.push(
      catalogSourceSchema.parse({
        retailer,
        key: String(node.id),
        name: categoryNames.join(" / "),
        url: url.href,
      }),
    );
  }
  for (const root of roots) {
    if (departments.has(root.name)) {
      visit(root, [], []);
    }
  }
  return [...new Map(sources.map((source) => [source.key, source])).values()];
}

export function parseTottusCatalogSources(html: string): CatalogSource[] {
  const match = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/u.exec(html);
  if (!match) {
    throw new Error("Tottus public category hydration missing");
  }
  const raw: unknown = JSON.parse(match[1]!);
  const menu = z
    .object({
      props: z.object({
        pageProps: z.object({
          serverData: z.object({
            headerData: z.object({
              sisNavigationMenu: z.object({
                entry: z.object({ categories: z.array(z.unknown()).max(5000) }),
              }),
            }),
          }),
        }),
      }),
    })
    .parse(raw).props.pageProps.serverData.headerData.sisNavigationMenu.entry.categories;
  const sources = new Map<string, CatalogSource>();
  const excluded = new Set([
    "Tecnología",
    "Electrohogar",
    "Vestuario",
    "Muebles",
    "Dormitorio",
    "Menaje y Organización",
    "Bazar",
    "Juguetería",
    "Deportes y Aire Libre",
  ]);
  function visit(value: unknown, depth: number, names: string[]) {
    if (depth > 8) {
      throw new Error("Tottus category structure too deep");
    }
    const node = z
      .object({
        item_name: z.string().min(1),
        item_url: z.union([z.string(), z.object({ href: z.string() })]),
        second_level_categories: z.array(z.unknown()).default([]),
        third_level_categories: z.array(z.unknown()).default([]),
      })
      .parse(value);
    const children = [...node.second_level_categories, ...node.third_level_categories];
    const categoryNames = [...names, node.item_name];
    if (children.length) {
      for (const child of children) {
        visit(child, depth + 1, categoryNames);
      }
      return;
    }
    const link = typeof node.item_url === "string" ? node.item_url : node.item_url.href;
    if (
      !link.startsWith("/tottus-pe/lista/") &&
      !link.startsWith("https://www.tottus.com.pe/tottus-pe/lista/")
    ) {
      return;
    }
    const url = new URL(link, "https://www.tottus.com.pe");
    url.search = "";
    const category = /^\/tottus-pe\/lista\/(CATG\d+)\/([^/]+)$/u.exec(url.pathname);
    if (!category) return;
    const source = catalogSourceSchema.parse({
      retailer: "tottus",
      key: category[1],
      name: categoryNames.join(" / "),
      url: url.href,
    });
    sources.set(source.key, source);
  }
  for (const value of menu) {
    const department = z.object({ item_name: z.string() }).parse(value);
    if (!excluded.has(department.item_name)) {
      visit(value, 0, []);
    }
  }
  if (!sources.size || sources.size > 5000) {
    throw new Error("Unexpected Tottus public category count");
  }
  return [...sources.values()];
}

export async function publicResponse(
  url: URL,
  fetchPage: typeof fetch,
  allowCatalogRedirect = false,
): Promise<{ response: Response; productUrl: URL | null }> {
  const response = await fetchPage(url, {
    headers: {
      Accept: "application/json,text/html",
      "User-Agent": "CompraFino/0.1 (public catalog acquisition)",
    },
    signal: AbortSignal.timeout(30_000),
    redirect: allowCatalogRedirect ? "manual" : "error",
  });
  assertPublicAccess(response);
  if (allowCatalogRedirect && [301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    const target = location ? new URL(location, url) : null;
    if (target?.origin === "https://www.tottus.com.pe" && target.pathname === "/tottus-pe") {
      throw new SourceResponseError("redirect_to_home", response.status);
    }
    const category = /^\/tottus-pe\/lista\/(CATG\d+)\/[^/]+$/u.exec(url.pathname)?.[1];
    const redirectedCategory = target
      ? /^\/tottus-pe\/lista\/(CATG\d+)\/[^/]+$/u.exec(target.pathname)?.[1]
      : undefined;
    const sameCategory = Boolean(
      category && redirectedCategory === category && target?.pathname !== url.pathname,
    );
    const productRedirect = Boolean(
      target && /^\/tottus-pe\/articulo\/\d+\/[^/]+\/\d+\/?$/u.test(target.pathname),
    );
    const allowedQuery = !target?.search || (sameCategory && target.search === url.search);
    if (
      !target ||
      target.origin !== "https://www.tottus.com.pe" ||
      target.username ||
      target.password ||
      !allowedQuery ||
      target.hash ||
      (!sameCategory && !productRedirect)
    ) {
      throw new SourceResponseError("untrusted_redirect", response.status);
    }
    if (sameCategory) {
      // A renamed slug must keep the exact category and requested page.
      target.search = url.search;
    }
    const followed = await publicResponse(target, fetchPage);
    return { response: followed.response, productUrl: productRedirect ? target : null };
  }
  if (!response.ok) {
    throw new SourceResponseError("http_error", response.status);
  }
  return { response, productUrl: null };
}

export async function discoverCatalogSources(
  retailer: RetailerId,
  fetchPage: typeof fetch = fetch,
) {
  if (retailer === "tottus") {
    const { response } = await publicResponse(
      new URL("https://www.tottus.com.pe/tottus-pe"),
      fetchPage,
    );
    return parseTottusCatalogSources(await response.text());
  }
  const { response } = await publicResponse(
    new URL(`${storefronts[retailer].origin}/api/catalog_system/pub/category/tree/3`),
    fetchPage,
  );
  const raw: unknown = await response.json();
  return parseVtexCatalogSources(raw, retailer);
}

export async function fetchCatalogPage(
  source: CatalogSourceClaim,
  fetchPage: typeof fetch = fetch,
) {
  catalogSourceSchema.parse(source);
  const url = new URL(source.url);
  if (source.retailer === "tottus") {
    url.searchParams.set("page", String(source.cursor + 1));
    const { response, productUrl } = await publicResponse(url, fetchPage, true);
    if (productUrl) {
      return parseTottusCatalogProduct(await response.text(), productUrl, new Date());
    }
    const parsed = parseTottusPage(await response.text(), new Date());
    // Category pages can contain sponsored duplicates beyond the 48 native slots.
    if (
      parsed.pagination.currentPage !== source.cursor + 1 ||
      parsed.pagination.perPage > 48 ||
      parsed.discovered > 64
    ) {
      throw new SourceResponseError("pagination_mismatch");
    }
    if (
      parsed.pagination.count > source.cursor * parsed.pagination.perPage &&
      parsed.discovered === 0
    ) {
      throw new SourceResponseError("unexpected_empty_page");
    }
    return {
      listings: [...new Map(parsed.listings.map((row) => [row.externalId, row])).values()],
      discovered: parsed.discovered,
      nextCursor:
        (source.cursor + 1) * parsed.pagination.perPage >= parsed.pagination.count
          ? null
          : source.cursor + 1,
    };
  }
  url.searchParams.set("_from", String(source.cursor));
  url.searchParams.set("_to", String(source.cursor + 19));
  const { response } = await publicResponse(url, fetchPage);
  const raw: unknown = await response.json();
  const products = z.array(z.unknown()).max(20).parse(raw);
  const range = /^(\d+)-(\d+)\/(\d+)$/u.exec(response.headers.get("resources") ?? "");
  if (!range) {
    throw new SourceResponseError("pagination_mismatch");
  }
  const start = Number(range[1]),
    end = Number(range[2]),
    total = Number(range[3]);
  if (
    ![start, end, total].every(Number.isSafeInteger) ||
    start !== source.cursor ||
    end > start + 19 ||
    end < start ||
    products.length !== Math.max(0, Math.min(end + 1, total) - start) ||
    (products.length === 0 && total > start)
  ) {
    throw new SourceResponseError("pagination_mismatch");
  }
  let parsed;
  if (source.retailer === "metro") {
    parsed = parseMetroPage(products, new Date());
  } else if (source.retailer === "makro") {
    parsed = parseMakroPage(products, new Date());
  } else {
    parsed = parsePlazaVeaPage(products, new Date());
  }
  return {
    listings: [...new Map(parsed.listings.map((row) => [row.externalId, row])).values()],
    discovered: parsed.discovered,
    nextCursor: end + 1 >= total ? null : end + 1,
  };
}
