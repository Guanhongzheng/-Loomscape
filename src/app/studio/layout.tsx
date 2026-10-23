import type { Metadata } from 'next';
import { StudioShell } from '@/components/studio/shell';

export const metadata: Metadata = {
  title: '工作台',
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <StudioShell>{children}</StudioShell>;
}
