'use client';

import { useEffect, useRef, useCallback, useState, memo } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Repeat, Repeat1, Shuffle, Heart, Mic2, Download, X,
  RotateCcw, RotateCw, ChevronDown, User, Menu, Music, Zap
} from 'lucide-react';
import { usePlayerStore, useFavoritesStore } from '@/lib/store';
import { formatTime, cn } from '@/lib/utils';
import { getLyrics, parseSyncedLyrics, ParsedLyricLine } from '@/lib/lyrics';
import { motion, AnimatePresence } from 'framer-motion';

const MicVocalIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="m11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12" />
    <path d="M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5" />
    <circle cx="16" cy="7" r="5" />
  </svg>
);

const TechyLoader = () => (
  <div className="flex flex-col items-center justify-center">
    <style>{`
      .vibrax-loader { position: relative; display: flex; align-items: center; justify-content: center; width: 80px; height: 80px; }
      .vibrax-loader:before, .vibrax-loader:after { content: ""; position: absolute; border-radius: 50%; animation: pulsOut 1.8s ease-in-out infinite; filter: drop-shadow(0 0 15px rgba(252, 211, 77, 0.6)); }
      .vibrax-loader:before { width: 100%; height: 100%; box-shadow: inset 0 0 0 0.8rem #fcd34d; animation-name: pulsIn; }
      .vibrax-loader:after { width: calc(100% - 2rem); height: calc(100% - 2rem); box-shadow: 0 0 0 0 #fcd34d; }
      @keyframes pulsIn { 0% { box-shadow: inset 0 0 0 0.8rem #fcd34d; opacity: 1; } 50%, 100% { box-shadow: inset 0 0 0 0 #fcd34d; opacity: 0; } }
      @keyframes pulsOut { 0%, 50% { box-shadow: 0 0 0 0 #fcd34d; opacity: 0; } 100% { box-shadow: 0 0 0 0.8rem #fcd34d; opacity: 1; } }
    `}</style>
    <div className="vibrax-loader mb-12"></div>
    <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }} className="text-xs font-black tracking-[0.3em] text-[#fcd34d] uppercase flex flex-col items-center gap-2">
      <div className="flex items-center gap-2"><Zap className="w-3 h-3 fill-[#fcd34d]" /><span>VIBRAX NEURAL SYNC</span></div>
      <span className="text-[10px] opacity-50">Synchronizing Data Stream...</span>
    </motion.div>
  </div>
);

const LyricLine = memo(({ 
  line, isActive, isPast, progress, displayMode, onClick 
}: { 
  line: ParsedLyricLine, isActive: boolean, isPast: boolean, progress: number, displayMode: 'line' | 'word', onClick: () => void 
}) => {
  return (
    <motion.div initial={false} animate={{ opacity: isActive ? 1 : (isPast ? 0.45 : 0.2), filter: isPast ? 'blur(0.5px)' : 'blur(0px)' }} transition={{ duration: 0.4, ease: "linear" }} className={cn("transition-all cursor-pointer py-4 pl-12 md:pl-20 group/line will-change-opacity", isActive ? "text-white" : "text-white/30")} onClick={onClick}>
      <div className={cn("text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-black tracking-tighter leading-tight flex flex-wrap gap-x-3 md:gap-x-6", isActive && displayMode === 'line' ? "drop-shadow-[0_0_20px_rgba(255,255,255,0.8)]" : "")}>
        {isActive && displayMode === 'word' && line.words && line.words.length > 0 ? (
          line.words.map((word, wi) => {
            const isWordActive = progress >= word.startTime - 0.05 && progress < word.endTime;
            const isWordPast = progress >= word.endTime;
            return (
              <motion.span key={wi} animate={{ color: isWordActive ? '#ffffff' : (isWordPast ? '#ffffff' : 'rgba(255,255,255,0.3)'), textShadow: isWordActive ? '0 0 20px rgba(255,255,255,1)' : 'none' }} transition={{ duration: 0.15, ease: "linear" }} className="inline-block origin-left">{word.text}</motion.span>
            );
          })
        ) : (
          <span className={cn(isActive && displayMode === 'line' ? "text-white" : "text-inherit transition-colors duration-300 group-hover/line:text-white/60")}>{line.text}</span>
        )}
      </div>
    </motion.div>
  );
});

LyricLine.displayName = 'LyricLine';

export default function FloatingPlayer({ onMenuClick }: { onMenuClick?: () => void }) {
  const {
    currentTrack, isPlaying, volume, isMuted, progress, duration,
    isShuffled, repeatMode, lyricsDisplayMode,
    togglePlay, next, previous, setVolume, toggleMute,
    setProgress, toggleShuffle, toggleRepeat, toggleLyricsMode,
  } = usePlayerStore();

  const { isFavorite, toggleFavorite } = useFavoritesStore();
  const [isDragging, setIsDragging] = useState(false);
  const [isVolumeDragging, setIsVolumeDragging] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRafHandle = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seekerRef = useRef<HTMLDivElement>(null);
  const miniSeekerRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  const miniVolumeRef = useRef<HTMLDivElement>(null);

  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState<ParsedLyricLine[]>([]);
  const [plainLyrics, setPlainLyrics] = useState<string | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [activeLyricIndex, setActiveLyricIndex] = useState(-1);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  
  // Global Keyboard Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
        if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      }
      if (e.code === 'F12' || (e.ctrlKey && e.shiftKey && (e.code === 'KeyI' || e.code === 'KeyJ' || e.code === 'KeyC')) || (e.ctrlKey && e.code === 'KeyU')) {
        e.preventDefault(); return false;
      }
    };
    const handleContextMenu = (e: MouseEvent) => { e.preventDefault(); return false; };
    const debuggerTrap = setInterval(() => { (function() { return false; }['constructor']('debugger')['call']()); }, 1000);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('contextmenu', handleContextMenu);
    return () => {
      window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('contextmenu', handleContextMenu);
      clearInterval(debuggerTrap);
    };
  }, [togglePlay]);

  useEffect(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.volume = isMuted ? 0 : volume / 100;
      audio.setAttribute('playsinline', 'true'); audio.setAttribute('webkit-playsinline', 'true'); audio.preload = 'auto';
      const handleEnded = () => {
        const state = usePlayerStore.getState();
        if (state.repeatMode === 'all') { audio.currentTime = 0; audio.play().catch(() => {}); }
        else state.next();
      };
      audio.addEventListener('ended', handleEnded);
      audioRef.current = audio;
    }
  }, []);

  const seekTo = (time: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time; setProgress(time);
    if (!isPlaying) togglePlay();
  };

  const seekBy = (seconds: number) => {
    if (!audioRef.current) return;
    const newTime = Math.max(0, Math.min(audioRef.current.currentTime + seconds, duration));
    audioRef.current.currentTime = newTime; setProgress(newTime);
  };

  const handleVolumeChange = (e: React.MouseEvent | React.TouchEvent) => {
    const bar = e.currentTarget as HTMLDivElement;
    const rect = bar.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const pos = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
    const newVol = Math.round(pos * 100);
    setVolume(newVol);
    if (audioRef.current) audioRef.current.volume = newVol / 100;
  };

  useEffect(() => {
    const handleGlobalMove = (e: MouseEvent | TouchEvent) => {
      if (isDragging) {
        const bar = seekerRef.current || miniSeekerRef.current;
        if (!bar) return;
        const rect = bar.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const pos = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
        const newTime = pos * (duration || 0);
        if (audioRef.current) { audioRef.current.currentTime = newTime; setProgress(newTime); }
      }
      if (isVolumeDragging) {
        const bar = volumeRef.current || miniVolumeRef.current;
        if (!bar) return;
        const rect = bar.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const pos = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
        const newVol = Math.round(pos * 100);
        setVolume(newVol);
        if (audioRef.current) audioRef.current.volume = newVol / 100;
      }
    };
    const handleGlobalUp = () => { setIsDragging(false); setIsVolumeDragging(false); };
    if (isDragging || isVolumeDragging) {
      window.addEventListener('mousemove', handleGlobalMove); window.addEventListener('mouseup', handleGlobalUp);
      window.addEventListener('touchmove', handleGlobalMove); window.addEventListener('touchend', handleGlobalUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMove); window.removeEventListener('mouseup', handleGlobalUp);
      window.removeEventListener('touchmove', handleGlobalMove); window.removeEventListener('touchend', handleGlobalUp);
    };
  }, [isDragging, isVolumeDragging, duration, setProgress, setVolume]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volume / 100;
  }, [volume, isMuted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    setLyrics([]); setPlainLyrics(null); setActiveLyricIndex(-1);
    const initializeAudio = async () => {
      let audioUrl = currentTrack.previewUrl;
      if (currentTrack.previewUrl && (currentTrack.id.match(/^\d+$/) || currentTrack.previewUrl.includes('apple.com') || currentTrack.duration < 60)) {
        try {
          const res = await fetch(`/api/music/upgrade?title=${encodeURIComponent(currentTrack.title)}&artist=${encodeURIComponent(currentTrack.artist)}&duration=${currentTrack.duration}`);
          if (res.ok) {
            const data = await res.json();
            if (data.url) { audioUrl = data.url; if (data.duration) usePlayerStore.getState().setDuration(data.duration); }
          }
        } catch (e) { console.error(e); }
      }
      if (audioUrl) { audio.src = audioUrl; audio.load(); if (usePlayerStore.getState().isPlaying) audio.play().catch(() => {}); }
    };
    initializeAudio();
  }, [currentTrack?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) audio.play().catch(() => usePlayerStore.setState({ isPlaying: false }));
    else audio.pause();
  }, [isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const updateProgress = () => {
      if (!isNaN(audio.duration) && isPlaying && !isDragging) setProgress(audio.currentTime);
      progressRafHandle.current = requestAnimationFrame(updateProgress);
    };
    if (isPlaying) progressRafHandle.current = requestAnimationFrame(updateProgress);
    else cancelAnimationFrame(progressRafHandle.current);
    return () => cancelAnimationFrame(progressRafHandle.current);
  }, [isPlaying, isDragging, setProgress]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let time = 0; let animId: number;
    const draw = () => {
      const w = canvas.offsetWidth; const h = canvas.offsetHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
      const grad1 = ctx.createLinearGradient(0, 0, w, 0);
      grad1.addColorStop(0, `rgba(252,211,77,${isPlaying ? 0.2 : 0.05})`); grad1.addColorStop(1, `rgba(252,211,77,${isPlaying ? 0.08 : 0.02})`);
      ctx.beginPath(); ctx.moveTo(0, h / 2);
      for (let x = 0; x < w; x += 2) {
        const amp = isPlaying ? 0.25 : 0.02;
        const y = h / 2 + Math.sin(x * 0.03 + time) * h * amp + Math.sin(x * 0.015 + time * 0.8) * h * amp * 0.5;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = grad1; ctx.fill();
      const grad2 = ctx.createLinearGradient(0, 0, w, 0);
      grad2.addColorStop(0, `rgba(252,211,77,${isPlaying ? 0.12 : 0.03})`); grad2.addColorStop(1, `rgba(252,211,77,${isPlaying ? 0.04 : 0.01})`);
      ctx.beginPath(); ctx.moveTo(0, h / 2);
      for (let x = 0; x < w; x += 2) {
        const amp = isPlaying ? 0.15 : 0.01;
        const y = h / 2 + Math.sin(x * 0.02 - time * 0.7) * h * amp + Math.cos(x * 0.01 + time * 0.5) * h * amp * 0.4;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = grad2; ctx.fill();
      if (isPlaying) time += 0.05; animId = requestAnimationFrame(draw);
    };
    draw(); return () => cancelAnimationFrame(animId);
  }, [isPlaying]);

  useEffect(() => {
    if (!currentTrack || !showLyrics) return;
    setLyrics([]); setPlainLyrics(null); setLyricsLoading(true);
    const fetchLyrics = async () => {
      try {
        const data = await getLyrics(currentTrack.title, currentTrack.artist, currentTrack.album, currentTrack.duration);
        if (!data) { setLyricsLoading(false); return; }
        if (data.syncedLyrics) {
          const parsed = parseSyncedLyrics(data.syncedLyrics);
          setLyrics(parsed.length > 0 ? parsed : []);
          setPlainLyrics(parsed.length === 0 ? data.syncedLyrics : null);
        } else if (data.plainLyrics) setPlainLyrics(data.plainLyrics);
      } catch (e) { console.error('Lyrics fetch error:', e); }
      finally { setLyricsLoading(false); }
    };
    fetchLyrics();
  }, [currentTrack?.id, showLyrics]);

  useEffect(() => {
    if (lyrics.length === 0) return;
    const index = lyrics.findLastIndex(l => l.time <= progress + 0.15);
    if (index !== -1 && index !== activeLyricIndex) {
      setActiveLyricIndex(index);
      const container = lyricsContainerRef.current;
      if (container) {
        const activeLine = container.children[index] as HTMLElement;
        if (activeLine) {
          const targetY = activeLine.offsetTop - container.offsetHeight / 2 + activeLine.offsetHeight / 2;
          container.scrollTo({ top: targetY, behavior: 'smooth' });
        }
      }
    }
  }, [progress, lyrics, activeLyricIndex]);

  const handleSeekStart = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDragging(true);
    const bar = e.currentTarget as HTMLDivElement;
    const rect = bar.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const pos = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
    const newTime = pos * (duration || 0);
    if (audioRef.current) { audioRef.current.currentTime = newTime; setProgress(newTime); }
  };

  const handleDownload = async () => {
    if (!audioRef.current?.src || !currentTrack) return;
    try {
      const response = await fetch(audioRef.current.src);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${currentTrack.title} - ${currentTrack.artist}.mp3`;
      document.body.appendChild(link);
      link.click(); document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) { window.open(audioRef.current.src, '_blank'); }
  };

  if (!currentTrack) return null;
  const progressPercent = duration ? (progress / duration) * 100 : 0;
  const remainingTime = duration ? duration - progress : 0;

  return (
    <>
      <AnimatePresence>
        {showLyrics && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] bg-[#050505] flex flex-col md:flex-row overflow-hidden">
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className="absolute inset-0 bg-cover bg-center opacity-50 blur-[70px] scale-125 transition-all duration-1000" style={{ backgroundImage: `url(${currentTrack.imageUrl})` }} />
              <motion.div animate={{ x: [0, 150, -50, 0], y: [0, -100, 150, 0], scale: [1, 1.3, 0.9, 1] }} transition={{ duration: 20, repeat: Infinity, ease: "linear" }} className="absolute -top-1/4 -left-1/4 w-[80%] h-[80%] bg-white/10 blur-[100px] rounded-full" />
              <motion.div animate={{ x: [0, -100, 100, 0], y: [0, 150, -100, 0], scale: [1, 1.1, 1.2, 1] }} transition={{ duration: 18, repeat: Infinity, ease: "linear" }} className="absolute -bottom-1/4 -right-1/4 w-[70%] h-[70%] bg-yellow-400/10 blur-[120px] rounded-full" />
            </div>
            <div className="absolute inset-0 bg-black/30 backdrop-brightness-[0.8] pointer-events-none" />

            <div className="w-full md:w-[40%] h-full flex flex-col p-8 md:p-12 z-[70] items-center justify-center text-center md:border-r border-white/5 relative">
              <button onClick={() => setShowLyrics(false)} className="absolute top-8 left-8 p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all z-[80]"><ChevronDown className="w-8 h-8" /></button>
              <div className="flex flex-col items-center w-full max-w-[400px]">
                <motion.img layoutId="player-art" src={currentTrack.imageUrl} className="w-64 h-64 md:w-[320px] md:h-[320px] object-cover rounded-xl shadow-2xl mb-8" animate={isPlaying ? { scale: 1, opacity: 1 } : { scale: 0.92, opacity: 0.85 }} transition={{ duration: 0.5 }} />
                <h2 className="text-3xl md:text-4xl font-black text-white mb-2 line-clamp-2 drop-shadow-sm">{currentTrack.title}</h2>
                <p className="text-lg md:text-xl text-white/50 mb-8 font-medium">{currentTrack.artist}</p>
                <div className="w-full mb-8 px-4 group">
                  <div ref={seekerRef} className="relative h-1.5 w-full bg-white/10 rounded-full cursor-pointer" onMouseDown={handleSeekStart} onTouchStart={handleSeekStart}>
                    <div className="absolute top-0 left-0 h-full bg-[#fcd34d] shadow-[0_0_8px_rgba(252,211,77,0.5)] transition-all duration-75" style={{ width: `${progressPercent}%` }} />
                  </div>
                  <div className="flex justify-between mt-3 text-[12px] text-white/50 font-black tracking-widest tabular-nums">
                    <span>{formatTime(progress)}</span> <span>-{formatTime(remainingTime)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-6 mb-10 relative z-[80]">
                   <button onClick={(e) => { e.stopPropagation(); previous(); }} className="text-white/40 hover:text-white transition-all p-2"><SkipBack className="w-7 h-7 fill-current" /></button>
                   <button onClick={(e) => { e.stopPropagation(); seekBy(-15); }} className="text-white/40 hover:text-white transition-all p-2"><RotateCcw className="w-6 h-6" /></button>
                   <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-black hover:scale-105 transition-all shadow-xl">
                     {isPlaying ? <Pause className="w-8 h-8 fill-black" /> : <Play className="w-8 h-8 fill-black ml-1" />}
                   </button>
                   <button onClick={(e) => { e.stopPropagation(); seekBy(15); }} className="text-white/40 hover:text-white transition-all p-2"><RotateCw className="w-6 h-6" /></button>
                   <button onClick={(e) => { e.stopPropagation(); next(); }} className="text-white/40 hover:text-white transition-all p-2"><SkipForward className="w-7 h-7 fill-current" /></button>
                </div>
                <div className="flex items-center gap-6 px-6 py-3 rounded-full bg-white/5 border border-white/10 backdrop-blur-xl relative z-[80]">
                   <button onClick={toggleShuffle} className={cn('transition-all', isShuffled ? 'text-[#fcd34d]' : 'text-white/30')}><Shuffle className="w-4 h-4" /></button>
                   <button onClick={toggleRepeat} className={cn('transition-all', repeatMode === 'all' ? 'text-[#fcd34d]' : 'text-white/30')}>
                     {repeatMode === 'all' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
                   </button>
                   <div className="w-[1px] h-4 bg-white/10 mx-1" />
                   <button onClick={toggleMute} className="text-white/30 hover:text-[#fcd34d]">
                     {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                   </button>
                   <div ref={volumeRef} className="w-16 h-1.5 bg-white/10 rounded-full relative cursor-pointer" onMouseDown={(e) => { setIsVolumeDragging(true); handleVolumeChange(e); }}>
                     <div className="absolute top-0 left-0 h-full bg-[#fcd34d] shadow-[0_0_5px_rgba(252,211,77,0.4)]" style={{ width: `${volume}%` }} />
                   </div>
                   <div className="w-[1px] h-4 bg-white/10 mx-1" />
                   <button onClick={toggleLyricsMode} className={cn("transition-all", lyricsDisplayMode === 'word' ? "text-[#fcd34d]" : "text-white/30")}><MicVocalIcon className="w-4 h-4" /></button>
                   <button onClick={handleDownload} className="text-white/30 hover:text-[#fcd34d] transition-colors"><Download className="w-4 h-4" /></button>
                </div>
              </div>
            </div>

            <div className="w-full md:w-[60%] h-full relative flex flex-col p-8 md:p-16 z-10 overflow-hidden">
              <div ref={lyricsContainerRef} className="flex-1 overflow-y-auto space-y-10 pr-8 scroll-smooth no-scrollbar py-[45vh] text-left relative">
                {lyricsLoading ? (
                  <div className="h-full flex items-center justify-center"><TechyLoader /></div>
                ) : lyrics.length > 0 ? (
                  lyrics.map((line, i) => (
                    <LyricLine key={i} line={line} isActive={i === activeLyricIndex} isPast={i < activeLyricIndex} progress={progress} displayMode={lyricsDisplayMode} onClick={() => seekTo(line.time)} />
                  ))
                ) : plainLyrics ? (
                  <div className="text-white/30 text-xl md:text-2xl font-bold leading-relaxed py-12 px-12">{plainLyrics}</div>
                ) : (
                  <div className="h-full flex items-center justify-center text-white/5 text-5xl font-black uppercase tracking-widest italic">Instrumental</div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fixed bottom-0 left-0 right-0 h-[var(--player-height)] bg-[#121212]/95 backdrop-blur-xl border-t border-white/5 z-50 flex items-center px-4 md:px-6 overflow-hidden">
         <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none opacity-40" />
         <div className="relative z-10 flex items-center w-full h-full">
           <div className="flex items-center gap-3 w-[25%] min-w-0">
             <img src={currentTrack.imageUrl} className="w-12 h-12 rounded object-cover cursor-pointer shadow-lg" onClick={() => setShowLyrics(true)} />
             <div className="truncate">
               <div className="text-sm font-semibold text-white truncate hover:underline cursor-pointer" onClick={() => setShowLyrics(true)}>{currentTrack.title}</div>
               <div className="text-xs text-white/50 truncate font-medium">{currentTrack.artist}</div>
             </div>
             <button onClick={() => toggleFavorite(currentTrack.id)} className="ml-2 hover:scale-110 transition-transform"><Heart className={cn("w-4 h-4", isFavorite(currentTrack.id) ? "fill-[#fcd34d] text-[#fcd34d] shadow-[0_0_8px_rgba(252,211,77,0.5)]" : "text-white/40")} /></button>
           </div>
           <div className="flex-1 flex flex-col items-center">
             <div className="flex items-center gap-5 mb-1">
               <button onClick={toggleShuffle} className={cn(isShuffled ? 'text-[#fcd34d]' : 'text-white/40')}><Shuffle className="w-4 h-4" /></button>
               <button onClick={previous} className="text-white/60 hover:text-white p-1"><SkipBack className="w-5 h-5 fill-current" /></button>
               <button onClick={() => seekBy(-15)} className="text-white/40 hover:text-white p-1"><RotateCcw className="w-4 h-4" /></button>
               <button onClick={togglePlay} className="w-9 h-9 bg-white rounded-full flex items-center justify-center text-black hover:scale-110 active:scale-95 transition-all shadow-[0_0_10px_white]">{isPlaying ? <Pause className="w-4 h-4 fill-black" /> : <Play className="w-4 h-4 fill-black ml-0.5" />}</button>
               <button onClick={() => seekBy(15)} className="text-white/40 hover:text-white p-1"><RotateCw className="w-4 h-4" /></button>
               <button onClick={next} className="text-white/60 hover:text-white p-1"><SkipForward className="w-5 h-5 fill-current" /></button>
               <button onClick={toggleRepeat} className={cn(repeatMode === 'all' ? 'text-[#fcd34d]' : 'text-white/40')}>
                  {repeatMode === 'all' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
               </button>
             </div>
             <div className="w-full max-w-[600px] flex items-center gap-3 group">
               <span className="text-[10px] text-white/40 w-10 text-right font-black tabular-nums">{formatTime(progress)}</span>
               <div ref={miniSeekerRef} className="flex-1 h-1.5 bg-white/10 rounded-full relative cursor-pointer" onMouseDown={handleSeekStart} onTouchStart={handleSeekStart}>
                 <div className="absolute top-0 left-0 h-full bg-[#fcd34d] shadow-[0_0_8px_rgba(252,211,77,0.5)] transition-all duration-75" style={{ width: `${progressPercent}%` }} />
               </div>
               <span className="text-[10px] text-white/40 w-10 font-black tabular-nums">-{formatTime(remainingTime)}</span>
             </div>
           </div>
           <div className="w-[25%] flex justify-end items-center gap-5">
             <button onClick={handleDownload} className="text-white/40 hover:text-[#fcd34d] transition-colors"><Download className="w-4 h-4" /></button>
             <button onClick={() => setShowLyrics(true)} className={cn("transition-all", showLyrics ? "text-[#fcd34d]" : "text-white/40 hover:text-white")}><MicVocalIcon className="w-4 h-4" /></button>
             <div className="flex items-center gap-2">
               <button onClick={toggleMute} className="text-white/30 hover:text-[#fcd34d]">
                  {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
               </button>
               <div ref={miniVolumeRef} className="w-24 h-1.5 bg-white/10 rounded-full relative cursor-pointer" onMouseDown={(e) => { setIsVolumeDragging(true); handleVolumeChange(e); }}>
                 <div className="absolute top-0 left-0 h-full bg-[#fcd34d] shadow-[0_0_5px_rgba(252,211,77,0.4)]" style={{ width: `${volume}%` }} />
               </div>
             </div>
           </div>
         </div>
      </div>
    </>
  );
}
