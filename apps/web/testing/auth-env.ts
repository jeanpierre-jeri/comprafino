/** Explicit fake credentials for test processes only; never imported by production source. */
export const authTestEnv = {
  BETTER_AUTH_URL: "http://127.0.0.1:3100",
  BETTER_AUTH_SECRET: "only-test-secret-with-at-least-thirty-two-characters",
  GOOGLE_CLIENT_ID: "test-google-client",
  GOOGLE_CLIENT_SECRET: "test-google-secret",
};
