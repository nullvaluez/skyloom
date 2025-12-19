import { NextResponse } from 'next/server';
import { ADSB_BASE_URL } from '@/lib/constants';

export async function GET(request, { params }) {
  const { hex } = await params;

  if (!hex) {
    return NextResponse.json(
      { error: 'Missing required parameter: hex' },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(`${ADSB_BASE_URL}/hex/${hex.toUpperCase()}`, {
      next: {
        revalidate: 2, // Faster updates for single aircraft
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { error: 'Aircraft not found' },
          { status: 404 }
        );
      }
      throw new Error(`API responded with status: ${response.status}`);
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=2, stale-while-revalidate=5',
      },
    });
  } catch (error) {
    console.error('Error fetching aircraft:', error);
    return NextResponse.json(
      { error: 'Failed to fetch aircraft', details: error.message },
      { status: 500 }
    );
  }
}
