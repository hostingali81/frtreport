import { redirect } from 'next/navigation';

// Deep Analysis merged into the unified /analytics dashboard; keep the old
// URL working for bookmarks and stale prefetches.
export default function DeepAnalysisRedirect() {
    redirect('/analytics');
}
