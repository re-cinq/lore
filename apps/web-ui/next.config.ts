import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['@google-cloud/storage', 'octokit', '@octokit/auth-app'],
};

export default nextConfig;
