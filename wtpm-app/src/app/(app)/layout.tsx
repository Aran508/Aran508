import { AppShell } from '@/components/Shell';
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
