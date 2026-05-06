import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get('title');
  const artist = searchParams.get('artist');
  const durationParam = searchParams.get('duration');
  const targetDuration = durationParam ? parseInt(durationParam) : null;

  if (!title || !artist) {
    return NextResponse.json({ error: 'Missing title or artist' }, { status: 400 });
  }

  const normalize = (str: string) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const targetTitle = normalize(title as string);
  const targetArtist = normalize((artist as string).split(',')[0]);
  const searchQuery = encodeURIComponent(`${title} ${artist}`);

  // 1. OFFICIAL JIOSAAVN API (Direct Decryption)
  // This gets 320kbps MP3 directly from JioSaavn CDN without relying on broken Vercel mirrors
  const fetchOfficialSaavn = async () => {
    try {
      const url = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=10&p=1&q=${searchQuery}`;
      const res = await fetch(url, { next: { revalidate: 3600 } });
      if (!res.ok) throw new Error('Official API failed');
      const data = await res.json();
      
      const results = data.results || [];
      if (!results || results.length === 0) return null;

      for (const song of results) {
        const sTitle = normalize(song.title || song.song || '');
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
            
            // Upgrade to 320kbps and mp3
            const highQual = decrypted.replace('_96.mp4', '_320.mp3').replace('_96.m4a', '_320.mp3').replace('_160.mp4', '_320.mp3');
            return { url: highQual, duration: parseInt(sDur), source: 'Official-JioSaavn' };
          }
        }
      }
      return null;
    } catch (e) {
      console.error('Official Saavn Fetch Error:', e);
      return null;
    }
  };

  // 2. YOUTUBE FALLBACK (Via Piped API)
  // Used for Western tracks (like Akon) that do not exist on JioSaavn
  const fetchPipedYouTube = async () => {
    const instances = [
      'https://pipedapi.kavin.rocks',
      'https://pipedapi.tokhmi.xyz',
      'https://pipedapi.smnz.de',
      'https://pipedapi.adminforge.de',
      'https://piped-api.garudalinux.org',
      'https://pipedapi.drgns.space'
    ];

    const ytQuery = encodeURIComponent(`${title} ${artist} audio`);

    for (const baseUrl of instances) {
      try {
        // Step 1: Search YouTube
        const searchRes = await fetch(`${baseUrl}/search?q=${ytQuery}&filter=all`, { signal: AbortSignal.timeout(3000) });
        if (!searchRes.ok) continue;
        const searchData = await searchRes.json();
        const items = searchData.items || [];
        
        let videoId = null;
        for (const item of items) {
          if (item.url && item.url.includes('/watch?v=')) {
            videoId = item.url.split('?v=')[1];
            break;
          }
        }
        
        if (!videoId) continue;

        // Step 2: Get Audio Stream
        const streamRes = await fetch(`${baseUrl}/streams/${videoId}`, { signal: AbortSignal.timeout(3000) });
        if (!streamRes.ok) continue;
        const streamData = await streamRes.json();
        
        const audioStreams = streamData.audioStreams || [];
        if (audioStreams.length > 0) {
          // Sort by highest bitrate
          audioStreams.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
          return { url: audioStreams[0].url, source: 'YouTube-Piped' };
        }
      } catch (e) {
        // Ignore errors for individual instances, just move to the next one
        continue;
      }
    }
    return null;
  };

  try {
    // Attempt Official JioSaavn First (Fastest and Best Quality for Asian tracks)
    const saavnResult = await fetchOfficialSaavn();
    if (saavnResult && saavnResult.url) {
      return NextResponse.json(saavnResult);
    }

    // Fallback to YouTube if JioSaavn doesn't have the song (e.g., Western tracks)
    const ytResult = await fetchPipedYouTube();
    if (ytResult && ytResult.url) {
      return NextResponse.json(ytResult);
    }

    throw new Error('All high-quality sources failed');
  } catch (e) {
    console.error(`Audio Upgrade completely failed for ${title} ${artist}`);
    return NextResponse.json({ error: 'No full track found' }, { status: 404 });
  }
}
