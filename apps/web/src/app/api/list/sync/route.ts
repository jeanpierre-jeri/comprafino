import { getAuth } from "../../../../server/auth.ts";
import { shoppingListSyncHandlers } from "../../../../server/shopping-list-sync-handler.ts";

export const { GET, POST } = shoppingListSyncHandlers({
  session: (headers) => getAuth().api.getSession({ headers }),
  origin: () => new URL(getAuth().options.baseURL).origin,
});
