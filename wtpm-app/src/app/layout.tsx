import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WTPM · OEE Management',
  description: 'WTPM digital data collection and OEE management system',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'WTPM', statusBarStyle: 'default' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, themeColor: '#261a66' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
