/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  devIndicators: false,
  // API routes read prompts/*.md and data/demo/*.json from disk at runtime.
  outputFileTracingIncludes: { "/api/**": ["./prompts/**", "./data/demo/**"] },
};
