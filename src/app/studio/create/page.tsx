import { CreateWorkspace } from '@/components/studio/create/create-workspace';
import { isCreateTab } from '@/lib/create-tabs';

/** One module for the five tools that produce a file from a prompt. */
export default function CreatePage({ searchParams }: { searchParams?: { tab?: string } }) {
  const tab = isCreateTab(searchParams?.tab) ? searchParams.tab : 'text';
  return <CreateWorkspace initialTab={tab} />;
}
