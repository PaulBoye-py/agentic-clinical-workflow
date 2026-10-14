// NEXT_PUBLIC_* values are inlined at build time, so they must be referenced
// literally (not via a dynamic key).
export const config = {
  region: process.env.NEXT_PUBLIC_AWS_REGION ?? "",
  userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID ?? "",
  userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID ?? "",
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, ""),
};

export const missingConfig = Object.entries(config)
  .filter(([, v]) => !v)
  .map(([k]) => k);
