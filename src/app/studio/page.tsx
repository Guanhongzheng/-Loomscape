import { redirect } from 'next/navigation';

/** The workspace lives on the landing page, one screen below the intro. */
export default function StudioIndex() {
  redirect('/#workspace');
}
