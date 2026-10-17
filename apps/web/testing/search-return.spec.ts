import { expect, test } from "@playwright/test";
import { validatedSearchReturn, withSearchReturn } from "../src/lib/search-return.ts";

test("return destinations admit only the local search page and bounded scroll positions", () => {
  const valid =
    "/search?q=leche&retailer=metro&unit=L&sort=unit-price&priceMode=benefits&page=2#scroll=841";
  expect(validatedSearchReturn(valid)).toBe(valid);
  expect(validatedSearchReturn("/search")).toBe("/search");

  for (const unsafe of [
    undefined,
    null,
    ["/search"],
    "",
    "https://evil.example/search",
    "//evil.example/search",
    "javascript:alert(1)",
    "/search/../list",
    "/search/",
    "/searching",
    "/%73earch",
    "/search\\evil",
    "/search\n",
    "/search#scroll=-1",
    "/search#scroll=Infinity",
    "/search#scroll=10000000",
    "/search#other",
    `/search?q=${"x".repeat(4096)}`,
  ]) {
    expect(validatedSearchReturn(unsafe)).toBeNull();
    expect(withSearchReturn("/listings/dynamic-id", unsafe)).toBe("/listings/dynamic-id");
  }
});

test("detail controls preserve the validated return destination alongside their own query and hash", () => {
  const returnTo = "/search?q=pan&page=2#scroll=432";
  const path = withSearchReturn(
    "/products/dynamic-id?range=7d&priceMode=benefits#offers-title",
    returnTo,
  );
  const url = new URL(path, "https://comprafino.invalid");
  expect(url.pathname).toBe("/products/dynamic-id");
  expect(url.searchParams.get("returnTo")).toBe(returnTo);
  expect(url.searchParams.get("range")).toBe("7d");
  expect(url.searchParams.get("priceMode")).toBe("benefits");
  expect(url.hash).toBe("#offers-title");
});
