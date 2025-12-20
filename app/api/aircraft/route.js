import { NextResponse } from 'next/server';
import { ADSB_BASE_URL } from '@/lib/constants';

// Timeout for external API calls (10 seconds)
const API_TIMEOUT_MS = 10000;

/**
 * Fetch with timeout using AbortController
 */
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
    const response = await fetchWithTimeout(
      `${ADSB_BASE_URL}/lat/${lat}/lon/${lon}/dist/${dist}`,
      {
        next: {
          revalidate: 3, // Cache for 3 seconds
        },
      },
      API_TIMEOUT_MS
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
    // Handle timeout specifically
    if (error.name === 'AbortError') {
      console.error('External API timeout:', `${ADSB_BASE_URL}/lat/${lat}/lon/${lon}/dist/${dist}`);
      return NextResponse.json(
        { error: 'External API timeout', ac: [] },
        { status: 504 }
      );
    }

    console.error('Error fetching aircraft data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch aircraft data', details: error.message, ac: [] },
      { status: 500 }
    );
  }
}
