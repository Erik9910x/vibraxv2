import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

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

  // Official Saavn direct fetch with decryption
  const fetchOfficialSaavn = async () => {
    try {
      const url = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=10&p=1&q=${encodeURIComponent(title + ' ' + artist)}`;
      const res = await fetch(url, { next: { revalidate: 3600 } });
      if (!res.ok) return null;
      const data = await res.json();
      const results = data.results || [];
      
      for (const song of results) {
        const sTitle = normalize(song.song || song.title || '');
        const sArtist = normalize(song.primary_artists || song.singers || '');
        const sDur = song.duration;

        const titleMatch = sTitle.includes(targetTitle) || targetTitle.includes(sTitle);
        const artistMatch = sArtist.includes(targetArtist) || targetArtist.includes(sArtist);
        const durMatch = !targetDuration || !sDur || Math.abs(parseInt(sDur) - targetDuration) < 20;

        if ((titleMatch && artistMatch) || (titleMatch && durMatch)) {
          if (song.encrypted_media_url) {
            const key = Buffer.from('38346591', 'utf8');
            const decipher = crypto.createDecipheriv('des-ecb', key, null);
            let decrypted = decipher.update(song.encrypted_media_url, 'base64', 'utf8');
            decrypted += decipher.final('utf8');
            
            // Upgrade quality to 320kbps
            const highQual = decrypted.replace('_96', '_320').replace('.mp4', '.mp3');
            return { url: highQual, duration: parseInt(sDur), source: 'OfficialSaavn' };
          }
        }
      }
      return null;
    } catch (e) {
      console.error('Official Saavn error:', e);
      return null;
    }
  };

  // Optimized reliable mirrors
  const saavnEndpoints = [
    `https://jio-saavn-api.vercel.app/api/search/songs?query=${encodeURIComponent(title + ' ' + artist)}`,
    `https://saavn.dev/api/search/songs?query=${encodeURIComponent(title + ' ' + artist)}`
  ];

  const fetchSaavn = async (url: string) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 8000); 

    try {
      const res = await fetch(url, { signal: controller.signal, next: { revalidate: 3600 } });
      clearTimeout(id);
      if (!res.ok) return null;
      const data = await res.json();
      
      // Handle different API response structures
      const results = Array.isArray(data) ? data : (data.data?.results || data.data || data.results || []);
      
      if (results && results.length > 0) {
        // Find best match
        for (const song of results) {
          const sTitle = normalize(song.name || song.title || '');
          const sArtist = normalize(song.primaryArtists || song.singers || song.subtitle || song.artists || '');
          const sDur = song.duration || song.durationInSeconds;

          // More lenient matching: title or artist match is enough if duration is close
          const titleMatch = sTitle.includes(targetTitle) || targetTitle.includes(sTitle);
          const artistMatch = sArtist.includes(targetArtist) || targetArtist.includes(sArtist);
          const durMatch = !targetDuration || !sDur || Math.abs(sDur - targetDuration) < 20;

          if ((titleMatch && artistMatch) || (titleMatch && durMatch)) {
            const dl = song.downloadUrl || song.download_url;
            let highQual: string | null = null;
            if (Array.isArray(dl) && dl.length > 0) {
              highQual = dl[dl.length - 1].link || dl[dl.length - 1].url || dl[dl.length - 1];
            } else if (typeof song.url === 'string') {
              highQual = song.url;
            } else if (typeof song.media_url === 'string') {
              highQual = song.media_url;
            }

            if (highQual) {
              return { url: highQual, duration: sDur, source: 'Saavn' };
            }
          }
        }
        
        // Final fallback: if no high-precision match, take the first result if title matches at all
        const first = results[0];
        if (first) {
          const fTitle = normalize(first.name || first.title || '');
          const fTitleMatch = fTitle.includes(targetTitle) || targetTitle.includes(fTitle);
          
          if (fTitleMatch) {
            const dl = first.downloadUrl || first.download_url;
            let highQual: string | null = null;
            if (Array.isArray(dl) && dl.length > 0) {
              highQual = dl[dl.length - 1].link || dl[dl.length - 1].url || dl[dl.length - 1];
            } else if (typeof first.url === 'string') {
              highQual = first.url;
            } else if (typeof first.media_url === 'string') {
              highQual = first.media_url;
            }
            
            if (highQual) {
              return { url: highQual, duration: first.duration || first.durationInSeconds, source: 'Saavn-First' };
            }
          }
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

  // 1. Try Official Saavn first (most reliable)
  try {
    const officialResult = await fetchOfficialSaavn();
    if (officialResult) return NextResponse.json(officialResult);
  } catch (e) {
    console.error(e);
  }

  // 2. Try Saavn mirrors in parallel
  try {
    if (saavnEndpoints.length > 0) {
      const saavnResult = await Promise.any(saavnEndpoints.map(url => fetchSaavn(url).then(r => r || Promise.reject())));
      if (saavnResult) return NextResponse.json(saavnResult);
    }
  } catch (e) {
    // 3. All Saavn mirrors failed, fallback to Deezer (30s)
    const deezerResult = await fetchDeezer();
    if (deezerResult) return NextResponse.json(deezerResult);
  }

  return NextResponse.json({ error: 'No track found' }, { status: 404 });
}
