import { NextResponse } from 'next/server';
import { ADSB_BASE_URL } from '@/lib/constants';

export async function GET() {
  try {
    const response = await fetch(`${ADSB_BASE_URL}/mil`, {
      next: {
        revalidate: 3,
      },
    });

    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
      },
    });
  } catch (error) {
    console.error('Error fetching military aircraft:', error);
    return NextResponse.json(
      { error: 'Failed to fetch military aircraft', details: error.message },
      { status: 500 }
    );
  }
}
