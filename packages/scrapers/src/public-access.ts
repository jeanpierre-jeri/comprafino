/** A source restriction stops that retailer's work; callers never switch URLs
 * or retry other SKUs/queries to get around the same response. */
export class CatalogAccessRestriction extends Error {}

export function assertPublicAccess(response: Response) {
  if ([401, 403, 429].includes(response.status)) {
    throw new CatalogAccessRestriction(
      `Retailer HTTP ${response.status}; public source restricted`,
    );
  }
}
