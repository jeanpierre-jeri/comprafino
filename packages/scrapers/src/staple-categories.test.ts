import { expect, it, vi } from "vitest";
import sugar from "./fixtures/staple-plaza-vea.json";
import pasta from "./fixtures/staple-metro.json";
import { createPlazaVeaAdapter } from "./plaza-vea.ts";
import { createMetroAdapter } from "./metro.ts";
import { parseArguments } from "./cli-options.ts";
it("uses the allowlisted complete sugar path and accepts observed short terminal VTEX ranges", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(sugar), { headers: { resources: "0-19/11" } }));
  const result = await createPlazaVeaAdapter(request, "sugar-brown").fetchListings(20);
  expect(result.listings.length).toBeGreaterThan(0);
  expect(result.listings.every((l) => l.category === "444")).toBe(true);
  const url = new URL(
    request.mock.calls[0]![0] instanceof URL ? request.mock.calls[0]![0].href : "",
  );
  expect(url.searchParams.get("fq")).toBe("C:/431/434/444/");
  expect(request).toHaveBeenCalledOnce();
});
it("stops after twenty usable pasta listings without an extra request", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(pasta), { headers: { resources: "0-19/67" } }));
  const result = await createMetroAdapter(request, "pasta").fetchListings(20);
  expect(result.listings).toHaveLength(20);
  expect(
    new URL(
      request.mock.calls[0]![0] instanceof URL ? request.mock.calls[0]![0].href : "",
    ).searchParams.get("fq"),
  ).toBe("C:/1700/1711/1000743/");
  expect(request).toHaveBeenCalledOnce();
});
it("refuses excessive or arbitrary scopes before requests", async () => {
  const request = vi.fn<typeof fetch>();
  await expect(createMetroAdapter(request, "oats").fetchListings(21)).rejects.toThrow("at most 20");
  expect(request).not.toHaveBeenCalled();
  expect(() => parseArguments(["--retailer=metro", "--category=unknown"])).toThrow("Usage");
  expect(() => parseArguments(["--category=oats"])).toThrow("Tottus");
  expect(() => parseArguments(["--retailer=plaza-vea", "--category=oats", "--limit=500"])).toThrow(
    "at most 20",
  );
});

it("caps a sparse staple category at two pages even before reaching the usable listing limit", async () => {
  const duplicatePage = Array.from({ length: 20 }, () => sugar[0]);
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify(duplicatePage), { headers: { resources: "0-19/100" } }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(duplicatePage), { headers: { resources: "20-39/100" } }),
    );
  const result = await createPlazaVeaAdapter(request, "sugar-brown").fetchListings(20);
  expect(result.listings).toHaveLength(1);
  expect(result.discovered).toBe(40);
  expect(request).toHaveBeenCalledTimes(2);
});
