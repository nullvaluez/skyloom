import { NextResponse } from 'next/server';
import { PLANESPOTTERS_URL } from '@/lib/constants';

export async function GET(request, { params }) {
  const { hex } = await params;

  if (!hex) {
    return NextResponse.json(
      { error: 'Missing required parameter: hex' },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(`${PLANESPOTTERS_URL}/${hex.toUpperCase()}`, {
      next: {
        revalidate: 3600, // Cache photos for 1 hour
      },
      headers: {
        'User-Agent': 'ShadowADSB/1.0',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json({ photos: [] });
      }
      throw new Error(`API responded with status: ${response.status}`);
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('Error fetching aircraft photo:', error);
    // Return empty photos array instead of error for graceful degradation
    return NextResponse.json({ photos: [] });
  }
}
