import { NextResponse } from 'next/server';
import { ADSB_BASE_URL } from '@/lib/constants';

// Timeout for external API calls (10 seconds)
const API_TIMEOUT_MS = 10000;

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

export async function GET() {
  try {
    const response = await fetchWithTimeout(
      `${ADSB_BASE_URL}/mil`,
      {
        next: {
          revalidate: 3,
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
    if (error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'External API timeout', ac: [] },
        { status: 504 }
      );
    }

    console.error('Error fetching military aircraft:', error);
    return NextResponse.json(
      { error: 'Failed to fetch military aircraft', details: error.message, ac: [] },
      { status: 500 }
    );
  }
}
