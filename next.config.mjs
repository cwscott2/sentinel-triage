/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root. Without this, Next walks up and finds a stray
  // package-lock.json in the user profile directory, which breaks output file
  // tracing and can produce a Vercel build that is missing dependencies.
  outputFileTracingRoot: import.meta.dirname,

  // Surface which build is actually live. Vercel injects the commit SHA at build
  // time; locally it falls back to "dev". Without this there is no way to tell a
  // stale deploy from a stale browser cache.
  env: {
    NEXT_PUBLIC_BUILD:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
  },
};

export default nextConfig;
