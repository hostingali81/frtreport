import { redirect } from 'next/navigation';

// The analytics dashboard moved from /charts to /analytics (the page outgrew
// its "charts" name); keep the old URL working for bookmarks.
export default function ChartsRedirect() {
    redirect('/analytics');
}
