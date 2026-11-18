/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root. Without this, Next walks up and finds a stray
  // package-lock.json in the user profile directory, which breaks output file
  // tracing and can produce a Vercel build that is missing dependencies.
  outputFileTracingRoot: import.meta.dirname,

  // The guardrail fixture pages are read from disk at request time by the
  // triage API (fixture presets) and by /fixtures/[id] (so a person can open
  // them). They are not imported, so tracing has to be told to ship them.
  outputFileTracingIncludes: {
    "/api/triage": ["./evals/fixtures/*.html"],
    "/fixtures/[id]": ["./evals/fixtures/*.html"],
  },

  // Surface which build is actually live. Vercel injects the commit SHA at build
  // time; locally it falls back to "dev". Without this there is no way to tell a
  // stale deploy from a stale browser cache.
  env: {
    NEXT_PUBLIC_BUILD:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
  },
};

export default nextConfig;
