/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root. Without this, Next walks up and finds a stray
  // package-lock.json in the user profile directory, which breaks output file
  // tracing and can produce a Vercel build that is missing dependencies.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
