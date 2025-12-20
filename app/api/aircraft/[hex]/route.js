import { NextResponse } from 'next/server';
import { ADSB_BASE_URL } from '@/lib/constants';

// Timeout for external API calls (8 seconds for single aircraft)
const API_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request, { params }) {
  const { hex } = await params;

  if (!hex) {
    return NextResponse.json(
      { error: 'Missing required parameter: hex' },
      { status: 400 }
    );
  }

  try {
    const response = await fetchWithTimeout(
      `${ADSB_BASE_URL}/hex/${hex.toUpperCase()}`,
      {
        next: {
          revalidate: 2, // Faster updates for single aircraft
        },
      },
      API_TIMEOUT_MS
    );

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
    if (error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'External API timeout' },
        { status: 504 }
      );
    }

    console.error('Error fetching aircraft:', error);
    return NextResponse.json(
      { error: 'Failed to fetch aircraft', details: error.message },
      { status: 500 }
    );
  }
}
