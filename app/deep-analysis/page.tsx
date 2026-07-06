import { redirect } from 'next/navigation';

// Deep Analysis merged into the unified /charts analytics page; keep the old
// URL working for bookmarks and stale prefetches.
export default function DeepAnalysisRedirect() {
    redirect('/charts');
}
