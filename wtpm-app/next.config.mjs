/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pg', 'exceljs', 'jspdf', 'jspdf-autotable', 'bcryptjs'],
  experimental: { serverActions: { bodySizeLimit: '25mb' } },
  poweredByHeader: false,
};
export default nextConfig;
