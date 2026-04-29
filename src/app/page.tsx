'use client';

import { useEffect, useState, useRef } from 'react';

type Video = {
  id: string;
  filename: string;
  url: string;
  timestamp: number;
  title: string;
  prompt: string;
  account: string;
};

// サムネイル個別のコンポーネント（遅延読み込み対応でパフォーマンスを改善）
function ThumbnailItem({ video, index, isActive, onClick }: { video: Video, index: number, isActive: boolean, onClick: () => void }) {
  const [shouldLoad, setShouldLoad] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: '400px' });

    if (ref.current) {
      observer.observe(ref.current);
    }
    return () => observer.disconnect();
  }, []);

  // ギャラリーを開いた瞬間に、現在再生中の動画まで即座にジャンプする
  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ behavior: 'auto', block: 'center' });
    }
  }, []);

  return (
    <div 
      ref={ref}
      onClick={onClick}
      className={`group relative aspect-[9/16] bg-white/5 rounded-2xl overflow-hidden cursor-pointer border-2 transition-all duration-300 ${
        isActive ? 'border-blue-500 scale-[1.02] shadow-[0_0_20px_rgba(59,130,246,0.3)]' : 'border-transparent hover:border-white/20'
      }`}
    >
      {shouldLoad ? (
        <video 
          src={`${video.url}#t=0.1`}
          className="h-full w-full object-cover opacity-60 group-hover:opacity-100 transition-opacity duration-500"
          preload="metadata"
          muted
          playsInline
        />
      ) : (
        <div className="h-full w-full flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-white/5 border-t-white/20 rounded-full animate-spin" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
        <p className="text-[10px] text-white/40 font-mono mb-1">#{index + 1}</p>
        <p className="text-xs text-white/90 font-medium line-clamp-2 leading-tight">
          {video.prompt || video.filename}
        </p>
      </div>

    </div>
  );
}

export default function Home() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [isEditingIndex, setIsEditingIndex] = useState(false);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const [showThumbnailGrid, setShowThumbnailGrid] = useState(false);
  const [renderGrid, setRenderGrid] = useState(false); // アニメーション終了後にDOMから消すため

  // showThumbnailGridが変わったときにrenderGridを同期（閉じる時はアニメーション後に消す）
  useEffect(() => {
    if (showThumbnailGrid) {
      setRenderGrid(true);
    } else {
      const timer = setTimeout(() => setRenderGrid(false), 150);
      return () => clearTimeout(timer);
    }
  }, [showThumbnailGrid]);

  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const progressRef = useRef<HTMLDivElement | null>(null);
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

  const goToNext = () => {
    setCurrentIndex(prev => Math.min(prev + 1, videos.length - 1));
  };
  const goToPrev = () => {
    setCurrentIndex(prev => Math.max(prev - 1, 0));
  };

  const handleIndexJump = () => {
    const num = parseInt(editValue, 10);
    if (!isNaN(num)) {
      const target = Math.max(0, Math.min(num - 1, videos.length - 1));
      setCurrentIndex(target);
    }
    setIsEditingIndex(false);
  };

  const startEditing = () => {
    setEditValue(String(currentIndex + 1));
    setIsEditingIndex(true);
  };

  useEffect(() => {
    if (isEditingIndex && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditingIndex]);

  // キーボード操作（上下キーでの動画切り替え、スペースキーでの再生/一時停止）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Input要素などにフォーカスがある場合は無視
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      // ギャラリー表示中はナビゲーションを無効化
      if (showThumbnailGrid) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (e.metaKey && e.shiftKey) {
          setCurrentIndex(videos.length - 1);
        } else if (e.metaKey) {
          setCurrentIndex(prev => Math.min(prev + 100, videos.length - 1));
        } else if (e.shiftKey) {
          setCurrentIndex(prev => Math.min(prev + 10, videos.length - 1));
        } else {
          goToNext();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (e.metaKey && e.shiftKey) {
          setCurrentIndex(0);
        } else if (e.metaKey) {
          setCurrentIndex(prev => Math.max(prev - 100, 0));
        } else if (e.shiftKey) {
          setCurrentIndex(prev => Math.max(prev - 10, 0));
        } else {
          goToPrev();
        }
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
      // ギャラリー表示中はホイールによる動画切り替えを無効化
      if (showThumbnailGrid) return;

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
  }, [videos.length, showThumbnailGrid]); // goToNext/goToPrev が videos.length に依存するため

  // Escapeキーでギャラリーを閉じる
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showThumbnailGrid) {
        setShowThumbnailGrid(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showThumbnailGrid]);

  // アクティブな動画のみ再生し、他は一時停止する
  useEffect(() => {
    if (videos.length === 0) return;
    const activeId = videos[currentIndex]?.id;
    
    Object.entries(videoRefs.current).forEach(([id, el]) => {
      if (!el) return;
      if (id === activeId) {
        if (!showThumbnailGrid) {
          el.muted = isMuted;
          el.play().catch(e => console.log('Autoplay prevented:', e));
        } else {
          // ギャラリー表示中は一時停止のみ行い、ミュート状態を変更しないことで
          // onVolumeChange による isMuted の誤更新を防ぐ
          el.pause();
        }
      } else {
        el.pause();
        el.muted = true;
        // アクティブでない動画のみ再生位置をリセット
        if (id !== activeId) {
          el.currentTime = 0;
        }
      }
    });
  }, [currentIndex, videos, isMuted, showThumbnailGrid]);

  const handleMouseMove = (e: React.MouseEvent) => {
    const threshold = 200; // 反応範囲 (px)
    const isNearBottom = e.clientY > window.innerHeight - threshold;
    const isNearLeft = e.clientX < threshold;
    setShowControls(isNearBottom || isNearLeft);
  };

  const handleMouseLeave = () => {
    setShowControls(false);
  };

  // プログレスバーのスムーズな更新 (60fps)
  useEffect(() => {
    let animationFrameId: number;

    const updateProgress = () => {
      const activeId = videos[currentIndex]?.id;
      const el = activeId ? videoRefs.current[activeId] : null;
      
      if (el && progressRef.current) {
        const p = (el.currentTime / el.duration) * 100;
        progressRef.current.style.width = `${p}%`;
      }
      
      animationFrameId = requestAnimationFrame(updateProgress);
    };

    animationFrameId = requestAnimationFrame(updateProgress);
    return () => cancelAnimationFrame(animationFrameId);
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
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="h-full w-full flex items-center justify-center relative group bg-black">
        {renderVideos.map((video) => {
          const isActive = video.id === currentVideo.id;
          return (
            <div
              key={video.id}
              className={`absolute inset-0 bg-black transition-opacity duration-0 ${
                isActive ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
              }`}
            >
              <video
                ref={el => { videoRefs.current[video.id] = el; }}
                src={video.url}
                className="h-full w-full object-contain"
                loop
                muted={!isActive || isMuted}
                onVolumeChange={(e) => {
                  if (!isActive) return;
                  const target = e.target as HTMLVideoElement;
                  setIsMuted(target.muted);
                }}
                playsInline
                preload="auto"
                autoPlay={isActive}
              />
            </div>
          );
        })}

        {/* Top UI Container */}
        <div className={`absolute top-12 left-8 z-30 transition-opacity duration-300 ${
          showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}>
          <div className="px-2 py-6 bg-black/40 backdrop-blur-3xl border border-white/10 rounded-full flex flex-col items-center gap-2 min-w-[54px] shadow-2xl">
            {/* Jump to Newest */}
            <button 
              onClick={() => setCurrentIndex(0)}
              disabled={currentIndex === 0}
              className="w-10 h-10 flex items-center justify-center text-white hover:text-white disabled:opacity-20 transition-all hover:scale-110 active:scale-95 cursor-pointer"
              title="Jump to Newest"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 4h14M12 20V8M7 13l5-5 5 5" />
              </svg>
            </button>
            
            {/* Go Previous */}
            <button 
              onClick={goToPrev}
              disabled={currentIndex === 0}
              className="w-10 h-10 flex items-center justify-center text-white hover:text-white disabled:opacity-20 transition-all hover:scale-110 active:scale-95 cursor-pointer -mt-1"
              title="Previous"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="m18 15-6-6-6 6" />
              </svg>
            </button>

            {/* Counter */}
            <div className="flex flex-col items-center gap-1 w-12">
              <div className="h-7 w-full flex items-center justify-center">
                {isEditingIndex ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleIndexJump();
                      if (e.key === 'Escape') setIsEditingIndex(false);
                    }}
                    onBlur={handleIndexJump}
                    className="w-full h-full bg-white/10 border border-white/20 rounded text-[16px] text-white font-mono font-medium text-center focus:outline-none focus:bg-white/20"
                  />
                ) : (
                  <span 
                    onClick={startEditing}
                    className="w-full h-full flex items-center justify-center text-[16px] text-white font-mono font-medium tracking-tighter cursor-text hover:text-blue-400 transition-colors"
                    title="Click to jump to number"
                  >
                    {currentIndex + 1}
                  </span>
                )}
              </div>
              <div className="w-4 h-[1px] bg-white/20" />
              <span className="text-[10px] text-white/20 font-mono font-light text-center">
                {videos.length}
              </span>
            </div>

            {/* Go Next */}
            <button 
              onClick={goToNext}
              disabled={currentIndex === videos.length - 1}
              className="w-10 h-10 flex items-center justify-center text-white hover:text-white disabled:opacity-20 transition-all hover:scale-110 active:scale-95 cursor-pointer -mb-1"
              title="Next"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {/* Jump to Oldest */}
            <button 
              onClick={() => setCurrentIndex(videos.length - 1)}
              disabled={currentIndex === videos.length - 1}
              className="w-10 h-10 flex items-center justify-center text-white hover:text-white disabled:opacity-20 transition-all hover:scale-110 active:scale-95 cursor-pointer"
              title="Jump to Oldest"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 20h14M12 4v12M7 11l5 5 5-5" />
              </svg>
            </button>

            <div className="w-6 h-[1px] bg-white/10 my-1" />

            {/* Thumbnail Grid Toggle */}
            <button 
              onClick={() => setShowThumbnailGrid(true)}
              className="w-10 h-10 flex items-center justify-center text-white hover:text-blue-400 transition-all hover:scale-110 active:scale-95 cursor-pointer"
              title="View all thumbnails"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Overlay Info (Sora/TikTok style) */}
        <div className={`absolute bottom-0 left-0 right-0 p-10 pb-6 pt-32 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none z-20 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className="max-w-2xl">
            {currentVideo.prompt && (
              <p className="text-white text-base font-light leading-relaxed drop-shadow-2xl mb-2 line-clamp-4">
                {currentVideo.prompt}
              </p>
            )}
            <div className="flex items-center gap-2 pt-2 border-t border-white/10 text-white/70 text-sm font-medium">
              {currentVideo.account && (
                <span className="tracking-wide">@{currentVideo.account}</span>
              )}
              <span className="opacity-30">|</span>
              <span className="tracking-wide">{date}</span>
              <span className="opacity-30">|</span>
              <span className="font-mono text-xs opacity-50 truncate max-w-[200px]">
                {currentVideo.filename || currentVideo.url.split('/').pop()?.replace(/\.mp4$/i, '') || currentVideo.id}
              </span>
            </div>
            <div className="mt-6 flex items-center gap-3">
              {/* 操作ガイドは左上に移動したため削除 */}
            </div>
          </div>
        </div>

        {/* Custom Progress Bar */}
        <div className={`absolute bottom-0 left-0 right-0 h-[2px] bg-white/10 z-40 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}>
          <div 
            ref={progressRef}
            className="h-full bg-white/30"
          />
        </div>
      </div>

      {/* Thumbnail Grid Overlay */}
      <div 
        className={`fixed inset-0 z-50 transition-all duration-150 ease-out ${
          showThumbnailGrid ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none translate-y-2'
        }`}
      >
        {/* 背景（クリックで閉じる） */}
        <div className="absolute inset-0 bg-black/95 backdrop-blur-3xl" onClick={() => setShowThumbnailGrid(false)} />
        
        {/* 追従する閉じるボタン */}
        <button 
          onClick={() => setShowThumbnailGrid(false)}
          className="fixed top-4 right-4 md:top-6 md:right-6 z-[60] w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white transition-all hover:scale-110 active:scale-95 shadow-2xl backdrop-blur-md border border-white/10"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        {/* スクロール可能なコンテンツエリア */}
        <div className="absolute inset-0 overflow-y-auto">
          <div className="max-w-7xl mx-auto p-6 md:p-12 pt-24 md:pt-32" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-10">
              <h2 className="text-2xl font-light tracking-widest uppercase text-white/50">Gallery</h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
              {renderGrid && videos.map((video, index) => (
                <ThumbnailItem 
                  key={video.id}
                  video={video}
                  index={index}
                  isActive={index === currentIndex}
                  onClick={() => {
                    setCurrentIndex(index);
                    setShowThumbnailGrid(false);
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

