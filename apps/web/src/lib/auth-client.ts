"use client";

import { createAuthClient } from "better-auth/react";

// Same-origin requests; no server secrets or deployment URL in the client bundle.
export const authClient = createAuthClient();
