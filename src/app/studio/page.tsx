import type { Metadata } from 'next';
import { StudioOverview } from '@/components/studio/overview';

export const metadata: Metadata = {
  title: '总览 · 织境',
};

/** A standalone overview inside the workspace shell; no homepage reload. */
export default function StudioIndex() {
  return <StudioOverview />;
}
