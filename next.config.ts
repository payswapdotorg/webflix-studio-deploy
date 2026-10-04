import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The vendored studio resolves its runtime file reads from the runtime cwd
  // via statically-scoped paths (see server/webflix-lab/COMPAT_PATCHES.md).
  // The vendored live-provider modules dynamic-import z-ai-web-dev-sdk; the
  // studio pins the offline deterministic provider, so the SDK is never
  // loaded at runtime — keep it external rather than bundled.
  serverExternalPackages: ['z-ai-web-dev-sdk'],
  // Runtime file reads performed by the vendored studio pipeline (fixture)
  // and static handlers (web assets fallback): include them in the serverless
  // function bundle at their project-relative paths. public/** is CDN-served
  // and must NOT be duplicated into the function bundle.
  outputFileTracingIncludes: {
    '/api/**': ['./server/webflix-lab/fixtures/**', './server/webflix-lab/apps/studio/web/**'],
  },
  outputFileTracingExcludes: {
    '/api/**': ['./public/**'],
  },
  async rewrites() {
    return {
      beforeFiles: [
        // The studio client lives at / (public/index.html, byte-copy of
        // apps/studio/web/index.html).
        { source: '/', destination: '/index.html' },
      ],
      afterFiles: [
        // Baseline master WAVs are pre-baked under public/audio/** (CDN);
        // any other /audio/:id/master.wav (fresh compiles, session masters)
        // falls through to the catch-all API route.
        { source: '/audio/:path*', destination: '/api/audio/:path*' },
      ],
      fallback: [],
    };
  },
};

export default nextConfig;
