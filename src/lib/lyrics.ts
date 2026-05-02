// Lyrics client (LRCLIB) + Embed player (MusicAPI)

export interface LyricsData {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface ParsedLyricLine {
  time: number; // seconds
  text: string;
  words?: { text: string; startTime: number; endTime: number }[];
  endTime?: number;
}

// Fetch lyrics for a track
export async function getLyrics(
  trackName: string,
  artistName: string,
  albumName?: string,
  duration?: number
): Promise<LyricsData | null> {
  try {
    let url = `/api/lyrics?track=${encodeURIComponent(trackName)}&artist=${encodeURIComponent(artistName)}`;
    if (albumName) url += `&album=${encodeURIComponent(albumName)}`;
    if (duration) url += `&duration=${duration}`;

    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Parse synced lyrics (LRC format) into timestamped lines
// Supports word-level timestamps in the format: [mm:ss.xx] <mm:ss.xx> word <mm:ss.xx> word...
export function parseSyncedLyrics(syncedLyrics: string): ParsedLyricLine[] {
  const lines: ParsedLyricLine[] = [];
  const lineRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
  const wordRegex = /<(\d{2}):(\d{2})\.(\d{2,3})>([^<]*)/g;

  const rawLines = syncedLyrics.split('\n');
  
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    const match = lineRegex.exec(line);
    
    if (match) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const ms = parseInt(match[3].padEnd(3, '0'));
      const time = minutes * 60 + seconds + ms / 1000;
      const content = match[4].trim();
      
      if (!content) continue;

      const words: { text: string; startTime: number; endTime: number }[] = [];
      let wordMatch;
      let lastWordEndTime = time;

      // Reset regex index for global search
      wordRegex.lastIndex = 0;
      
      while ((wordMatch = wordRegex.exec(content)) !== null) {
        const wMin = parseInt(wordMatch[1]);
        const wSec = parseInt(wordMatch[2]);
        const wMs = parseInt(wordMatch[3].padEnd(3, '0'));
        const wTime = wMin * 60 + wSec + wMs / 1000;
        const wText = wordMatch[4].trim();
        
        if (wText) {
          words.push({ text: wText, startTime: lastWordEndTime, endTime: wTime });
          lastWordEndTime = wTime;
        }
      }

      // If no word-level tags found, simulate them with weighted timing
      if (words.length === 0) {
        const plainText = content.replace(/<[^>]*>/g, '').trim();
        const splitWords = plainText.split(/\s+/);
        
        let nextTime = 0;
        if (i < rawLines.length - 1) {
          const nextMatch = lineRegex.exec(rawLines[i+1].trim());
          if (nextMatch) {
            const nMin = parseInt(nextMatch[1]);
            const nSec = parseInt(nextMatch[2]);
            const nMs = parseInt(nextMatch[3].padEnd(3, '0'));
            nextTime = nMin * 60 + nSec + nMs / 1000;
          }
        }
        
        let lineDuration = nextTime > time ? (nextTime - time) : 3.5;
        if (lineDuration > 6) lineDuration = 4;
        
        const wordDur = lineDuration / splitWords.length;
        splitWords.forEach((w, wi) => {
          words.push({
            text: w,
            startTime: time + (wi * wordDur),
            endTime: time + ((wi + 1) * wordDur)
          });
        });
      }

      lines.push({ 
        time, 
        text: content.replace(/<[^>]*>/g, '').trim(), 
        words,
        endTime: words.length > 0 ? words[words.length - 1].endTime : time + 3.5
      });
    }
  }

  // Handle Instrumental/Intro if the first lyric starts late
  if (lines.length > 0 && lines[0].time > 5) {
    lines.unshift({
      time: 0,
      text: "• • •",
      words: [{ text: "Instrumental", startTime: 0, endTime: lines[0].time - 0.5 }]
    });
  }

  return lines.sort((a, b) => a.time - b.time);
}

// Get embed player iframe HTML for a track URL
export async function getEmbedPlayer(trackUrl: string): Promise<{ html: string; sizes: string[] } | null> {
  try {
    const res = await fetch('/api/music/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: trackUrl }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
