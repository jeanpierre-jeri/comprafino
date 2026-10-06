import { getAuth } from "../../../../server/auth.ts";
import { authHandlers } from "../../../../server/auth-handler.ts";

export const { GET, POST } = authHandlers(getAuth);
