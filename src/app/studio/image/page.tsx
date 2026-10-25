import { redirect } from 'next/navigation';

/** Kept as a redirect: the tool now lives as a tab inside /studio/create. */
export default function Page() {
  redirect('/studio/create?tab=image');
}
