'use client';

import { useEffect, useState, useRef } from 'react';

type Video = {
  id: string;
  url: string;
  timestamp: number;
  title: string;
  prompt: string;
  account: string;
};

export default function Home() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const touchStartY = useRef<number | null>(null);
  const lastScrollTime = useRef(0);

  useEffect(() => {
    fetch('/api/videos')
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to fetch videos');
        return data;
      })
      .then(data => {
        setVideos(data.videos || []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const goToNext = () => setCurrentIndex(prev => Math.min(prev + 1, videos.length - 1));
  const goToPrev = () => setCurrentIndex(prev => Math.max(prev - 1, 0));

  // キーボード操作（上下キーでの動画切り替え、スペースキーでの再生/一時停止）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Input要素などにフォーカスがある場合は無視
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        goToNext();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        goToPrev();
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        const activeId = videos[currentIndex]?.id;
        const activeEl = activeId ? videoRefs.current[activeId] : null;
        if (activeEl) {
          if (activeEl.paused) {
            activeEl.play().catch(err => console.log('Play prevented:', err));
          } else {
            activeEl.pause();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [videos, currentIndex]);

  // マウスホイール・トラックパッド操作（MacBookの二本指スワイプなど）
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      const now = Date.now();
      const cooldown = 800; // 連打防止（ミリ秒）
      if (now - lastScrollTime.current < cooldown) return;

      const threshold = 30; // 誤操作防止の閾値
      if (Math.abs(e.deltaY) > threshold) {
        if (e.deltaY > 0) {
          goToNext();
        } else {
          goToPrev();
        }
        lastScrollTime.current = now;
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [videos.length]); // goToNext/goToPrev が videos.length に依存するため

  // アクティブな動画のみ再生し、他は一時停止する
  useEffect(() => {
    if (videos.length === 0) return;
    const activeId = videos[currentIndex]?.id;

    Object.entries(videoRefs.current).forEach(([id, el]) => {
      if (!el) return;
      if (id === activeId) {
        el.play().catch(e => console.log('Autoplay prevented:', e));
      } else {
        el.pause();
        el.currentTime = 0; // 次回表示される時に最初から再生されるようにリセット
      }
    });
  }, [currentIndex, videos]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <div className="text-2xl animate-pulse font-light tracking-widest uppercase">Initializing...</div>
      </div>
    );
  }

  if (error || videos.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white p-8">
        <div className="max-w-md w-full p-8 bg-white/5 border border-white/10 rounded-3xl backdrop-blur-2xl">
          <h2 className="text-2xl font-semibold mb-6 flex items-center gap-3">
            <span className="text-3xl">🎥</span> Ready to start?
          </h2>
          
          <div className="space-y-6 text-white/70">
            <p className="leading-relaxed">
              動画を再生するには、プロジェクトのフォルダ内に <code className="bg-white/10 px-2 py-0.5 rounded text-white font-mono">videos</code> フォルダを作成してください。
            </p>

            <div className="bg-black/40 p-4 rounded-2xl border border-white/5 font-mono text-sm space-y-2">
              <div className="flex gap-2">
                <span className="text-blue-400">sora-player/</span>
              </div>
              <div className="flex gap-2 ml-4">
                <span className="text-white/40">├──</span>
                <span className="text-green-400">videos/</span>
                <span className="text-white/20 italic">(← ここに動画をいれる)</span>
              </div>
              <div className="flex gap-2 ml-4">
                <span className="text-white/40">└──</span>
                <span>package.json</span>
              </div>
            </div>

            <div className="pt-4 flex flex-col gap-3">
              <p className="text-xs text-white/40 uppercase tracking-widest font-medium">Alternative for power users</p>
              <p className="text-sm">
                または、<code className="bg-white/10 px-2 py-0.5 rounded text-white font-mono">.env</code> ファイルに <code className="text-blue-400">VIDEOS_DIR=/path/to/videos</code> を指定することも可能です。
              </p>
            </div>
          </div>

          <button 
            onClick={() => window.location.reload()}
            className="mt-8 w-full py-4 bg-white text-black font-semibold rounded-2xl hover:bg-gray-200 transition-colors"
          >
            フォルダを作成したので更新する
          </button>
        </div>
      </div>
    );
  }

  const currentVideo = videos[currentIndex];
  const date = new Date(currentVideo.timestamp).toLocaleString();

  // シームレスな切り替えのため、現在・前・次の動画を事前にマウントしておく
  const prevVideo = currentIndex > 0 ? videos[currentIndex - 1] : null;
  const nextVideo = currentIndex < videos.length - 1 ? videos[currentIndex + 1] : null;
  const renderVideos = [prevVideo, currentVideo, nextVideo].filter(Boolean) as Video[];

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaY = touchStartY.current - touchEndY;
    const threshold = 50; // pixels

    if (deltaY > threshold) {
      // Swipe Up -> Next
      goToNext();
    } else if (deltaY < -threshold) {
      // Swipe Down -> Prev
      goToPrev();
    }
    touchStartY.current = null;
  };

  return (
    <main 
      className="bg-black text-white h-screen w-full overflow-hidden relative"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="h-full w-full flex items-center justify-center relative group bg-black">
        {renderVideos.map((video) => {
          const isActive = video.id === currentVideo.id;
          return (
            <video
              key={video.id}
              ref={el => { videoRefs.current[video.id] = el; }}
              src={video.url}
              className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-0 ${
                isActive ? 'opacity-100 z-10' : 'opacity-0 z-0'
              }`}
              controls={isActive}
              loop
              muted={isMuted}
              onVolumeChange={(e) => {
                if (!isActive) return;
                const target = e.target as HTMLVideoElement;
                setIsMuted(target.muted);
              }}
              playsInline
              preload="auto"
            />
          );
        })}

        {/* Top UI Container */}
        <div className="absolute top-8 right-8 flex items-center z-30 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500">
          <div className="px-4 py-1.5 bg-black/40 backdrop-blur-xl border border-white/10 rounded-full flex items-center gap-4">
            {/* Navigation Guide */}
            <span className="text-[9px] text-white/40 tracking-[0.2em] uppercase font-medium">
              ↑↓ OR SWIPE
            </span>
            
            {/* Divider */}
            <div className="w-[1px] h-3 bg-white/10" />

            {/* Counter */}
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-white/60 rounded-full animate-pulse" />
              <span className="text-[11px] text-white/80 font-mono tracking-wider">
                {currentIndex + 1} <span className="opacity-40">/</span> {videos.length}
              </span>
            </div>
          </div>
        </div>

        {/* Overlay Info (Sora/TikTok style) */}
        <div className="absolute bottom-0 left-0 right-0 p-10 pt-32 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
          <div className="max-w-2xl">
            <p className="text-white text-base font-light leading-relaxed drop-shadow-2xl mb-2 line-clamp-4">
              {currentVideo.prompt || 'No prompt available'}
            </p>
            <div className="flex items-center gap-2 pt-2 border-t border-white/10 text-white/70 text-sm font-medium">
              {currentVideo.account && (
                <span className="tracking-wide">@{currentVideo.account}</span>
              )}
              <span className="opacity-30">|</span>
              <span className="tracking-wide">{date}</span>
              <span className="opacity-30">|</span>
              <span className="font-mono text-xs opacity-50 truncate max-w-[200px]">{currentVideo.id}</span>
            </div>
            <div className="mt-6 flex items-center gap-3">
              {/* 操作ガイドは左上に移動したため削除 */}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

