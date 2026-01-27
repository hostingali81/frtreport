import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const baseUrl = process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}` 
    : 'http://localhost:3000';

  const response = await fetch(`${baseUrl}/api/scrape?refresh=1&secret=${secret}`);
  const data = await response.json();

  return NextResponse.json({ 
    success: true, 
    message: 'Full scrape triggered',
    result: data 
  });
}
