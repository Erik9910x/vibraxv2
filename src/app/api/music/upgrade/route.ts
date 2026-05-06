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

  // 1. UNOFFICIAL JIOSAAVN MIRRORS
  // These mirrors use a different internal algorithm that CAN find Western songs like Akon.
  const fetchMirrors = async () => {
    const endpoints = [
      `https://jio-saavn-api-phi.vercel.app/api/search/songs?query=${searchQuery}`,
      `https://saavn.dev/api/search/songs?query=${searchQuery}`
    ];

    const fetchSingle = async (url: string) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('Mirror failed');
      const json = await res.json();
      const results = json.data?.results || json.results || json.data || [];
      if (!results || results.length === 0) throw new Error('No results');

      for (const song of results) {
        const sTitle = normalize(song.name || song.title || '');
        let sArtist = '';
        if (song.artists?.primary) {
          sArtist = normalize(song.artists.primary.map((a: any) => a.name).join(' '));
        } else {
          sArtist = normalize(song.primaryArtists || song.singers || '');
        }
        const sDur = song.duration;

        const titleMatch = sTitle.includes(targetTitle) || targetTitle.includes(sTitle);
        const artistMatch = sArtist.includes(targetArtist) || targetArtist.includes(sArtist);
        const durMatch = !targetDuration || !sDur || Math.abs(parseInt(sDur) - targetDuration) < 20;

        if ((titleMatch && artistMatch) || (titleMatch && durMatch)) {
          const dl = song.downloadUrl || song.download_url;
          if (dl && Array.isArray(dl) && dl.length > 0) {
            return { url: dl[dl.length - 1].url || dl[dl.length - 1].link, duration: parseInt(sDur), source: 'Saavn-Mirror' };
          }
        }
      }
      throw new Error('No accurate match found in mirror');
    };

    try {
      return await Promise.any(endpoints.map(fetchSingle));
    } catch (e) {
      return null;
    }
  };

  // 2. OFFICIAL JIOSAAVN API (Direct Decryption)
  const fetchOfficialSaavn = async () => {
    try {
      const url = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=10&p=1&q=${searchQuery}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
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
            const highQual = decrypted.replace('_96.mp4', '_320.mp3').replace('_96.m4a', '_320.mp3').replace('_160.mp4', '_320.mp3');
            return { url: highQual, duration: parseInt(sDur), source: 'Official-JioSaavn' };
          }
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  // 3. YOUTUBE FALLBACK (Via Piped API)
  const fetchPipedYouTube = async () => {
    const instances = [
      'https://pipedapi.kavin.rocks',
      'https://pipedapi.smnz.de',
      'https://pipedapi.tokhmi.xyz',
      'https://piped-api.garudalinux.org'
    ];
    const ytQuery = encodeURIComponent(`${title} ${artist} audio`);

    for (const baseUrl of instances) {
      try {
        const searchRes = await fetch(`${baseUrl}/search?q=${ytQuery}&filter=all`, { signal: AbortSignal.timeout(4000) });
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

        const streamRes = await fetch(`${baseUrl}/streams/${videoId}`, { signal: AbortSignal.timeout(4000) });
        if (!streamRes.ok) continue;
        const streamData = await streamRes.json();
        
        const audioStreams = streamData.audioStreams || [];
        if (audioStreams.length > 0) {
          audioStreams.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
          return { url: audioStreams[0].url, source: 'YouTube-Piped' };
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  };

  try {
    // Stage 1: Try Working Unofficial Mirrors (they find Western tracks better)
    const mirrorResult = await fetchMirrors();
    if (mirrorResult && mirrorResult.url) return NextResponse.json(mirrorResult);

    // Stage 2: Try Official JioSaavn API
    const saavnResult = await fetchOfficialSaavn();
    if (saavnResult && saavnResult.url) return NextResponse.json(saavnResult);

    // Stage 3: Try YouTube Fallback
    const ytResult = await fetchPipedYouTube();
    if (ytResult && ytResult.url) return NextResponse.json(ytResult);

    throw new Error('All high-quality sources failed');
  } catch (e) {
    console.error(`Audio Upgrade completely failed for ${title} ${artist}`);
    return NextResponse.json({ error: 'No full track found' }, { status: 404 });
  }
}
