/**
 * The fake-director demo (M2 slice 6). Build-time flag: set NEXT_PUBLIC_AILI_FAKE_DIRECTOR=1 only in
 * .env.local (dev) and the main e2e build. Unset in production: the turn routes return 404 and the
 * fixture registry is not loaded. Direct access so Next inlines it at build time.
 */
export const FAKE_DIRECTOR = process.env.NEXT_PUBLIC_AILI_FAKE_DIRECTOR === "1";
