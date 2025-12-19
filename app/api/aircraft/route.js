import { NextResponse } from 'next/server';
import { ADSB_BASE_URL } from '@/lib/constants';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lon = searchParams.get('lon');
  const dist = searchParams.get('dist') || '250';

  if (!lat || !lon) {
    return NextResponse.json(
      { error: 'Missing required parameters: lat and lon' },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(
      `${ADSB_BASE_URL}/lat/${lat}/lon/${lon}/dist/${dist}`,
      {
        next: {
          revalidate: 3, // Cache for 3 seconds
        },
      }
    );

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
    console.error('Error fetching aircraft data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch aircraft data', details: error.message },
      { status: 500 }
    );
  }
}
