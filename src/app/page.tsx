'use client';

import { useEffect, useState, useRef } from 'react';

type Video = {
  id: string;
  filename: string;
  url: string;
  timestamp: number;
  title: string;
  prompt: string;
  account?: string;
  thumbnail?: string; // 追記：サーバー保存済みのサムネイルURL
};

// サムネイルの静止画キャッシュ（ビデオのデコード負荷を避けるため）
const thumbnailCache = new Map<string, string>();

// サムネイル個別のコンポーネント（遅延読み込み + フレームキャプチャキャッシュ）
function ThumbnailItem({ video, index, isActive, onClick }: { video: Video, index: number, isActive: boolean, onClick: () => void }) {
  const [cachedUrl, setCachedUrl] = useState<string | undefined>(video.thumbnail || thumbnailCache.get(video.url));
  const [shouldLoad, setShouldLoad] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (cachedUrl) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: '400px' });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, [cachedUrl, video.url]);

  // ビデオのデータが読み込まれたら、Canvasでフレームをキャプチャして静止画として保存する
  const handleLoadedData = () => {
    if (cachedUrl || !videoRef.current) return;
    
    try {
      const videoEl = videoRef.current;
      const canvas = document.createElement('canvas');
      
      // サムネイル用にサイズを大幅に縮小（幅300px固定）
      const targetWidth = 300;
      const scale = targetWidth / videoEl.videoWidth;
      canvas.width = targetWidth;
      canvas.height = videoEl.videoHeight * scale;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/webp', 0.6); // WebPに変更してさらに高圧縮
        thumbnailCache.set(video.url, dataUrl);
        setCachedUrl(dataUrl);
        
        // サーバーへ永続保存をリクエスト（非同期）
        fetch('/api/videos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: video.id, dataUrl })
        }).catch(err => console.error('Failed to save thumbnail to server:', err));
        
        console.log(`[Thumbnail] Captured and cached: ${video.filename}`);
      }
    } catch (e) {
      console.error('Failed to capture frame:', e);
    }
  };

  // 背景プリフェッチ用のログ
  useEffect(() => {
    if (cachedUrl) {
      // console.log(`[Thumbnail] Loaded from cache: ${video.filename}`);
    }
  }, [cachedUrl, video.filename]);

  // ギャラリーを開いた瞬間に、現在再生中の動画まで即座にジャンプする
  useEffect(() => {
    if (isActive && containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: 'auto', block: 'center' });
    }
  }, []);

  return (
    <div 
      ref={containerRef}
      onClick={onClick}
      className={`group relative aspect-[9/16] bg-white/5 rounded-2xl overflow-hidden cursor-pointer border-2 transition-all duration-300 ${
        isActive ? 'border-blue-500 scale-[1.02] shadow-[0_0_20px_rgba(59,130,246,0.3)]' : 'border-transparent hover:border-white/20'
      }`}
    >
      {cachedUrl ? (
        <img 
          src={cachedUrl}
          alt=""
          onError={() => {
            // 画像の読み込みに失敗（パス変更やファイル欠損）したら
            // キャッシュをクリアしてビデオからの再取得に切り替える
            setCachedUrl(undefined);
            thumbnailCache.delete(video.url);
          }}
          className="h-full w-full object-cover opacity-60 group-hover:opacity-100 transition-opacity duration-500 animate-in fade-in duration-700"
        />
      ) : shouldLoad ? (
        <video 
          ref={videoRef}
          src={`${video.url}#t=0.1`}
          onLoadedData={handleLoadedData}
          className="h-full w-full object-cover opacity-0" // キャプチャ前は隠しておく
          preload="metadata"
          muted
          playsInline
        />
      ) : null}

      {!cachedUrl && shouldLoad && (
        <div className="absolute inset-0 bg-gradient-to-b from-white/3 to-transparent animate-pulse" />
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
  const [showShortcuts, setShowShortcuts] = useState(false);

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

  // currentIndex の最新値を ref で保持（useEffect の依存配列に入れず、ループを中断させないため）
  const currentIndexRef = useRef(currentIndex);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  // 背景でのプリフェッチ（ギャラリーを開く前にキャッシュを先回りして作成）
  useEffect(() => {
    if (videos.length === 0) return;

    let isCancelled = false;
    
    const prefetch = async () => {
      // 現在のインデックスから開始し、全動画をキャッシュ
      for (let i = 0; i < videos.length; i++) {
        if (isCancelled) break;

        // 最新の currentIndex を ref から取得（動画切り替えがあっても中断しない）
        const startIndex = currentIndexRef.current;
        const targetIndex = (startIndex + i) % videos.length;
        const video = videos[targetIndex];

        if (thumbnailCache.has(video.url)) continue;

        await new Promise<void>((resolve) => {
          const v = document.createElement('video');
          // DOMに追加しないとブラウザがメディアイベントを発火しない場合がある
          v.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;top:-9999px;';
          document.body.appendChild(v);

          v.preload = 'auto';
          v.muted = true;
          v.playsInline = true;

          const cleanup = () => {
            v.onseeked = null;
            v.onloadedmetadata = null;
            v.onerror = null;
            v.src = '';
            if (v.parentNode) v.parentNode.removeChild(v);
          };

          v.onloadedmetadata = () => { v.currentTime = 0.1; };

          v.onseeked = () => {
            try {
              const canvas = document.createElement('canvas');
              const targetWidth = 300;
              const scale = targetWidth / v.videoWidth;
              canvas.width = targetWidth;
              canvas.height = v.videoHeight * scale;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/webp', 0.6);
                thumbnailCache.set(video.url, dataUrl);
                
                // サーバーへ永続保存をリクエスト（非同期）
                fetch('/api/videos', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: video.id, dataUrl })
                }).catch(err => console.error('Failed to save prefetch thumbnail:', err));
              }
            } catch (e) {
              console.error('Background prefetch failed:', e);
            }
            cleanup();
            resolve();
          };

          v.onerror = () => { cleanup(); resolve(); };
          setTimeout(() => { cleanup(); resolve(); }, 4000);

          // srcはDOM追加後に設定（ブラウザによっては順序が重要）
          v.src = video.url;
        });

        await new Promise(r => setTimeout(r, 100));
      }
      console.log(`[Prefetch] Done. ${thumbnailCache.size}/${videos.length} cached.`);
    };

    const timer = setTimeout(prefetch, 1000);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [videos]); // currentIndex を除外：切り替えでループを中断させない

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

      // g: ギャラリーのオンオフ（ギャラリー中でも有効）
      if (e.key === 'g') {
        setShowThumbnailGrid(prev => !prev);
        return;
      }

      // m: ミュートのオンオフ（ギャラリー中でも有効）
      if (e.key === 'm') {
        setIsMuted(prev => !prev);
        return;
      }

      // f: フルスクリーン切り替え
      if (e.key === 'f') {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
        return;
      }

      // r: ランダムジャンプ
      if (e.key === 'r') {
        const randomIndex = Math.floor(Math.random() * videos.length);
        setCurrentIndex(randomIndex);
        return;
      }

      // ?: ショートカット一覧表示
      if (e.key === '?') {
        setShowShortcuts(prev => !prev);
        return;
      }

      // Escape: モーダルを閉じる
      if (e.key === 'Escape') {
        setShowShortcuts(false);
        return;
      }

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
    const bottomThreshold = window.innerHeight * 0.4; // 下部40%を判定範囲に
    const leftThreshold = 200; // 左側は固定値
    const isNearBottom = e.clientY > window.innerHeight - bottomThreshold;
    const isNearLeft = e.clientX < leftThreshold;
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
                または、<code className="bg-white/10 px-2 py-0.5 rounded text-white font-mono">config.json</code> ファイルを作成し、 <code className="text-blue-400">"videosDir": "/path/to/videos"</code> を指定することも可能です。
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
              className="w-10 h-10 flex items-center justify-center text-white hover:text-blue-400 disabled:opacity-20 transition-all hover:scale-110 active:scale-95 cursor-pointer"
              title="Jump to Newest (⌘+Shift+↑)"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 4h14M12 20V8M7 13l5-5 5 5" />
              </svg>
            </button>
            
            {/* Go Previous */}
            <button 
              onClick={goToPrev}
              disabled={currentIndex === 0}
              className="w-10 h-10 flex items-center justify-center text-white hover:text-blue-400 disabled:opacity-20 transition-all hover:scale-110 active:scale-95 cursor-pointer -mt-1"
              title="Previous (↑)"
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
                    title="Type number & Enter to jump"
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
              className="w-10 h-10 flex items-center justify-center text-white hover:text-blue-400 disabled:opacity-20 transition-all hover:scale-110 active:scale-95 cursor-pointer -mb-1"
              title="Next (↓)"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {/* Jump to Oldest */}
            <button 
              onClick={() => setCurrentIndex(videos.length - 1)}
              disabled={currentIndex === videos.length - 1}
              className="w-10 h-10 flex items-center justify-center text-white hover:text-blue-400 disabled:opacity-20 transition-all hover:scale-110 active:scale-95 cursor-pointer"
              title="Jump to Oldest (⌘+Shift+↓)"
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
              title="View all thumbnails (G)"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </button>

            {/* Random Jump */}
            <button 
              onClick={() => {
                const randomIndex = Math.floor(Math.random() * videos.length);
                setCurrentIndex(randomIndex);
              }}
              className="w-10 h-10 flex items-center justify-center text-white hover:text-blue-400 transition-all hover:scale-110 active:scale-95 cursor-pointer"
              title="Random jump (R)"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 3 21 3 21 8" />
                <line x1="4" y1="20" x2="21" y2="3" />
                <polyline points="21 16 21 21 16 21" />
                <line x1="15" y1="15" x2="21" y2="21" />
                <line x1="4" y1="4" x2="9" y2="9" />
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

      {/* キーボードショートカット一覧オーバーレイ */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="bg-white/10 border border-white/20 rounded-2xl p-8 w-full max-w-md shadow-2xl backdrop-blur-xl"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-white font-semibold text-lg mb-6 text-center">キーボードショートカット</h2>
            <div className="space-y-3 text-sm">
              {[
                ['↑ / ↓', '前後の動画へ移動'],
                ['Shift + ↑↓', '10件スキップ'],
                ['⌘ + ↑↓', '100件スキップ'],
                ['Space', '再生 / 一時停止'],
                ['g', 'ギャラリー 開く / 閉じる'],
                ['r', 'ランダムジャンプ'],
                ['m', 'ミュート 切り替え'],
                ['f', 'フルスクリーン 切り替え'],
                ['Esc', 'ギャラリー / このパネルを閉じる'],
                ['?', 'このヘルプを表示'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <kbd className="px-2.5 py-1 bg-white/10 border border-white/20 rounded-lg text-white font-mono text-xs min-w-[80px] text-center">{key}</kbd>
                  <span className="text-white/70 text-right">{desc}</span>
                </div>
              ))}
            </div>
            <p className="text-white/30 text-xs text-center mt-6">どこかをクリックまたは Esc で閉じる</p>
          </div>
        </div>
      )}
    </main>
  );
}

