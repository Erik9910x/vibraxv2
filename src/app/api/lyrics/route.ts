import { NextRequest, NextResponse } from 'next/server';

// LRCLIB proxy — free synced lyrics, no auth required
// Server-side to include proper User-Agent header (Lrclib BLOCKS browser requests without it)

const UA = 'VibraX/1.0 (https://vibrax.app)';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trackName = searchParams.get('track');
  const artistName = searchParams.get('artist');
  const albumName = searchParams.get('album');
  const duration = searchParams.get('duration');

  if (!trackName || !artistName) {
    return NextResponse.json({ error: 'Missing track or artist' }, { status: 400 });
  }

  try {
    // === Stage 1: Exact match (if album + duration provided) ===
    if (albumName && duration) {
      const exactUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artistName)}&album_name=${encodeURIComponent(albumName)}&duration=${duration}`;
      const exactRes = await fetch(exactUrl, { headers: { 'User-Agent': UA } });
      if (exactRes.ok) {
        const data = await exactRes.json();
        if (data && (data.syncedLyrics || data.plainLyrics)) {
          return NextResponse.json(data);
        }
      }
    }

    // === Stage 2: Exact get without album ===
    const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artistName)}`;
    const getRes = await fetch(getUrl, { headers: { 'User-Agent': UA } });
    if (getRes.ok) {
      const data = await getRes.json();
      if (data && (data.syncedLyrics || data.plainLyrics)) {
        return NextResponse.json(data);
      }
    }

    // === Stage 3: Strict search with duration filtering ===
    const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artistName)}`;
    const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': UA } });
    if (searchRes.ok) {
      const results = await searchRes.json();
      if (Array.isArray(results) && results.length > 0) {
        // Filter by duration if available
        const targetDur = duration ? parseInt(duration) : null;
        let filtered = results;
        if (targetDur) {
          filtered = results.filter((r: any) => Math.abs(r.duration - targetDur) < 10);
        }
        
        // If no matches within duration, use original results
        const finalResults = filtered.length > 0 ? filtered : results;

        // Preference: Synced > Original (not translated) > Plain
        const synced = finalResults.find((r: any) => r.syncedLyrics && !r.trackName?.toLowerCase().includes('translation'));
        if (synced) return NextResponse.json(synced);

        const anySynced = finalResults.find((r: any) => r.syncedLyrics);
        if (anySynced) return NextResponse.json(anySynced);

        const originalPlain = finalResults.find((r: any) => r.plainLyrics && !r.trackName?.toLowerCase().includes('translation'));
        if (originalPlain) return NextResponse.json(originalPlain);

        if (finalResults[0].plainLyrics) return NextResponse.json(finalResults[0]);
      }
    }

    // === Stage 4: Fuzzy search with stricter filtering ===
    const fuzzyUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(trackName + ' ' + artistName)}`;
    const fuzzyRes = await fetch(fuzzyUrl, { headers: { 'User-Agent': UA } });
    if (fuzzyRes.ok) {
      const results = await fuzzyRes.json();
      if (Array.isArray(results) && results.length > 0) {
        const targetDur = duration ? parseInt(duration) : null;
        
        // Stricter artist matching
        const artistLower = artistName.toLowerCase();
        const artistMatches = results.filter((r: any) => 
          r.artistName?.toLowerCase().includes(artistLower) || artistLower.includes(r.artistName?.toLowerCase())
        );

        const pool = artistMatches.length > 0 ? artistMatches : results;
        
        let filtered = pool;
        if (targetDur) {
          filtered = pool.filter((r: any) => Math.abs(r.duration - targetDur) < 15);
        }

        const finalPool = filtered.length > 0 ? filtered : pool;

        const matchedSynced = finalPool.find((r: any) => 
          r.syncedLyrics && !r.trackName?.toLowerCase().includes('translation')
        );
        if (matchedSynced) return NextResponse.json(matchedSynced);

        const anySynced = finalPool.find((r: any) => r.syncedLyrics);
        if (anySynced) return NextResponse.json(anySynced);

        const anyPlain = finalPool.find((r: any) => r.plainLyrics);
        if (anyPlain) return NextResponse.json(anyPlain);
      }
    }

    return NextResponse.json({ error: 'Lyrics not found' }, { status: 404 });
  } catch (error) {
    console.error('LRCLIB error:', error);
    return NextResponse.json({ error: 'Failed to fetch lyrics' }, { status: 500 });
  }
}
