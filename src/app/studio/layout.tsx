import type { Metadata } from 'next';
import { StudioShell } from '@/components/studio/shell';
import { EmbeddingGate } from '@/components/studio/embedding-gate';
import { EmbeddingTagMigration } from '@/components/studio/embedding-tag-migration';

export const metadata: Metadata = {
  title: '工作台',
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StudioShell>{children}</StudioShell>
      <EmbeddingGate />
      <EmbeddingTagMigration />
    </>
  );
}
