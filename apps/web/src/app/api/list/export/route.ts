import { getAuth } from "../../../../server/auth.ts";
import { shoppingListExportHandler } from "../../../../server/shopping-list-export-handler.ts";

export const GET = shoppingListExportHandler({
  session: (headers, signal) =>
    getAuth(signal).api.getSession({ headers, query: { disableCookieCache: true } }),
});

export const maxDuration = 20;
