import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get('title');
  const artist = searchParams.get('artist');
  const duration = searchParams.get('duration');

  if (!title || !artist) {
    return NextResponse.json({ error: 'Missing title or artist' }, { status: 400 });
  }

  const normalize = (str: string) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const targetTitle = normalize(title);
  const targetArtist = normalize(artist.split(',')[0]);
  const targetDuration = duration ? parseInt(duration) : null;

  // Optimized reliable mirrors
  const saavnEndpoints = [
    `https://saavn.dev/api/search/songs?query=${encodeURIComponent(title + ' ' + artist)}`,
    `https://jio-saavn-api.vercel.app/api/search/songs?query=${encodeURIComponent(title + ' ' + artist)}`,
    `https://jiosaavn-api-privatecvc2.vercel.app/search/songs?query=${encodeURIComponent(title + ' ' + artist)}`
  ];

  const fetchSaavn = async (url: string) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 6000); 

    try {
      const res = await fetch(url, { signal: controller.signal, next: { revalidate: 3600 } });
      clearTimeout(id);
      if (!res.ok) return null;
      const data = await res.json();
      
      // Handle different API response structures
      const results = data.data?.results || data.data || data.results || [];
      
      if (results && results.length > 0) {
        // Find best match
        for (const song of results) {
          const sTitle = normalize(song.name || song.title || '');
          const sArtist = normalize(song.primaryArtists || song.singers || song.subtitle || '');
          const sDur = song.duration || song.durationInSeconds;

          // More lenient matching: title or artist match is enough if duration is close
          const titleMatch = sTitle.includes(targetTitle) || targetTitle.includes(sTitle);
          const artistMatch = sArtist.includes(targetArtist) || targetArtist.includes(sArtist);
          const durMatch = !targetDuration || !sDur || Math.abs(sDur - targetDuration) < 20;

          if ((titleMatch && artistMatch) || (titleMatch && durMatch)) {
            const dl = song.downloadUrl || song.download_url;
            if (dl && dl.length > 0) {
              const highQual = dl[dl.length - 1].link || dl[dl.length - 1].url || dl[dl.length - 1];
              return { url: highQual, duration: sDur, source: 'Saavn' };
            }
          }
        }
        
        // Final fallback: if no high-precision match, take the first result if title matches at all
        const first = results[0];
        const dl = first.downloadUrl || first.download_url;
        if (dl && dl.length > 0) {
          return { url: dl[dl.length - 1].link || dl[dl.length - 1].url || dl[dl.length - 1], duration: first.duration, source: 'Saavn-First' };
        }
      }
      return null;
    } catch {
      return null;
    }
  };

  const fetchDeezer = async () => {
    try {
      const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(title + ' ' + artist)}&limit=1`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.data?.[0]) {
        const track = data.data[0];
        return { url: track.preview, duration: track.duration, source: 'Deezer' };
      }
      return null;
    } catch {
      return null;
    }
  };

  // Try Saavn mirrors in parallel
  try {
    const saavnResult = await Promise.any(saavnEndpoints.map(url => fetchSaavn(url).then(r => r || Promise.reject())));
    if (saavnResult) return NextResponse.json(saavnResult);
  } catch (e) {
    // All Saavn mirrors failed, fallback to Deezer
    const deezerResult = await fetchDeezer();
    if (deezerResult) return NextResponse.json(deezerResult);
  }

  return NextResponse.json({ error: 'No track found' }, { status: 404 });
}
