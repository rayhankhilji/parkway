import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The engine ships as TypeScript source with no build step, so Next compiles it
  // alongside the app. This is what keeps the package free of a bundler config and
  // therefore free of dependencies.
  transpilePackages: ['@parkway/engine'],
  // Typed routes are deliberately off. The only navigation in the app targets a
  // dynamic segment built from a server-supplied game id, which the feature
  // cannot infer from a template literal — so honouring it would mean casting at
  // every call site, and a guarantee you cast around is not a guarantee.
  eslint: {
    // Linting runs once, from the workspace root, against one flat config that
    // covers both packages. Letting `next build` run a second pass with its own
    // config would mean two sets of rules that can disagree.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
