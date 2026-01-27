import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Force redeploy

export async function GET(request: Request) {
  try {
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';

    const scrapeUrl = `${baseUrl}/api/scrape?refresh=1`;
    const response = await fetch(scrapeUrl);
    const data = await response.json();

    return NextResponse.json({ 
      success: true, 
      message: 'Full scrape triggered',
      result: data 
    });
  } catch (error: any) {
    return NextResponse.json({ 
      error: error.message
    }, { status: 500 });
  }
}
