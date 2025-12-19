import { NextResponse } from 'next/server';
import { ADSB_BASE_URL } from '@/lib/constants';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const field = searchParams.get('field') || 'all';

  if (!query) {
    return NextResponse.json(
      { error: 'Missing required parameter: q' },
      { status: 400 }
    );
  }

  try {
    let endpoint;
    const searchQuery = query.toUpperCase().trim();

    // Determine which endpoint to use based on field
    switch (field) {
      case 'callsign':
        endpoint = `${ADSB_BASE_URL}/callsign/${searchQuery}`;
        break;
      case 'registration':
        endpoint = `${ADSB_BASE_URL}/reg/${searchQuery}`;
        break;
      case 'type':
        endpoint = `${ADSB_BASE_URL}/type/${searchQuery}`;
        break;
      case 'hex':
        endpoint = `${ADSB_BASE_URL}/hex/${searchQuery}`;
        break;
      case 'squawk':
        endpoint = `${ADSB_BASE_URL}/sqk/${searchQuery}`;
        break;
      case 'all':
      default:
        // For 'all', try callsign first (most common search)
        endpoint = `${ADSB_BASE_URL}/callsign/${searchQuery}`;
        break;
    }

    const response = await fetch(endpoint, {
      next: {
        revalidate: 5,
      },
    });

    if (!response.ok) {
      // If callsign search fails, try registration for 'all' field
      if (field === 'all' && response.status === 404) {
        const regResponse = await fetch(
          `${ADSB_BASE_URL}/reg/${searchQuery}`,
          { next: { revalidate: 5 } }
        );

        if (regResponse.ok) {
          const data = await regResponse.json();
          return NextResponse.json(data);
        }
      }

      throw new Error(`API responded with status: ${response.status}`);
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=30',
      },
    });
  } catch (error) {
    console.error('Error searching aircraft:', error);
    return NextResponse.json(
      { error: 'Search failed', details: error.message },
      { status: 500 }
    );
  }
}
