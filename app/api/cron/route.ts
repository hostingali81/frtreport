import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get('secret');

    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ 
        error: 'Unauthorized',
        debug: { received: secret, hasEnv: !!process.env.CRON_SECRET }
      }, { status: 401 });
    }

    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';

    const scrapeUrl = `${baseUrl}/api/scrape?refresh=1&secret=${secret}`;
    const response = await fetch(scrapeUrl);
    const data = await response.json();

    return NextResponse.json({ 
      success: true, 
      message: 'Full scrape triggered',
      scrapeUrl,
      result: data 
    });
  } catch (error: any) {
    return NextResponse.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
}
