'use client';

import { useEffect, useMemo, useState, useRef, type ReactNode } from 'react';

type Video = {
  id: string;
  filename: string;
  url: string;
  timestamp: number;
  title: string;
  prompt: string;
  account?: string;
  thumbnail?: string; // 追記：サーバー保存済みのサムネイルURL
  tags?: string[];
};

// サムネイルの静止画キャッシュ（ビデオのデコード負荷を避けるため）
const thumbnailCache = new Map<string, string>();
const cameoPattern = /@[A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*/g;
const UNTAGGED_FILTER = '__untagged__';

// サムネイル個別のコンポーネント（遅延読み込み + フレームキャプチャキャッシュ）
function ThumbnailItem({
  video,
  index,
  isActive,
  isSelected,
  onClick,
  onToggleSelected,
  onSelectionDragStart,
  onSelectionDragEnter,
  filteredIndex
}: {
  video: Video;
  index: number;
  isActive: boolean;
  isSelected: boolean;
  onClick: () => void;
  onToggleSelected: () => void;
  onSelectionDragStart: (clientX: number, clientY: number) => void;
  onSelectionDragEnter: () => void;
  filteredIndex: number;
}) {
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
      data-filtered-index={filteredIndex}
      onClick={onClick}
      onPointerEnter={onSelectionDragEnter}
      className={`group relative aspect-[9/16] bg-white/5 rounded-2xl overflow-hidden cursor-pointer border-2 transition-all duration-300 ${
        isSelected
          ? 'border-emerald-400 scale-[1.02] shadow-[0_0_20px_rgba(52,211,153,0.3)]'
          : isActive ? 'border-blue-500 scale-[1.02] shadow-[0_0_20px_rgba(59,130,246,0.3)]' : 'border-transparent hover:border-white/20'
      }`}
    >
      <button
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onSelectionDragStart(e.clientX, e.clientY);
        }}
        className={`absolute left-2 top-2 z-20 h-7 w-7 rounded-full border flex items-center justify-center backdrop-blur-md transition-all ${
          isSelected
            ? 'bg-emerald-400 text-black border-emerald-200 opacity-100'
            : 'bg-black/50 text-white/40 border-white/20 opacity-0 group-hover:opacity-100 hover:text-white'
        }`}
        title="タグ付け対象に選択"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </button>

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
      
      {/* Finderで開くボタン (ホバー時のみ表示) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.currentTarget.blur();
          fetch('/api/videos', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: video.id })
          }).catch(err => console.error('Failed to open folder:', err));
        }}
        className="absolute bottom-2 right-2 z-10 w-7 h-7 flex items-center justify-center bg-black/60 backdrop-blur-md rounded-full text-white/40 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-[4px] group-hover:translate-x-0 shadow-lg border border-white/10 focus:outline-none"
        title="Finderでフォルダを開く"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </button>

      <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
        <p className="text-[10px] text-white/40 font-mono mb-1">#{index + 1}</p>
        <p className="text-xs text-white/90 font-medium line-clamp-2 leading-tight">
          {video.prompt || video.filename}
        </p>
        {video.tags && video.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {video.tags.slice(0, 3).map(tag => (
              <span key={tag} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">
                {tag}
              </span>
            ))}
          </div>
        )}
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
  const [showThumbnailGrid, setShowThumbnailGrid] = useState(true);
  const [renderGrid, setRenderGrid] = useState(false); // アニメーション終了後にDOMから消すため
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState(''); // 実際にフィルタリングに使うクエリ
  const [activeTag, setActiveTag] = useState('');
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());
  const [tagInput, setTagInput] = useState('');
  const [pendingTags, setPendingTags] = useState<Set<string>>(new Set());
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const galleryScrollRef = useRef<HTMLDivElement>(null);
  const filteredVideosRef = useRef<Video[]>([]);
  const isSelectionDraggingRef = useRef(false);
  const selectionPointerRef = useRef<{ x: number; y: number } | null>(null);
  const selectionAutoScrollFrameRef = useRef<number | null>(null);
  const selectionDragAnchorRef = useRef<number>(-1);
  const selectionDragBaseIdsRef = useRef<Set<string>>(new Set());

  // searchQueryが変わったときに、入力中でなければフィルタリング用クエリを更新
  useEffect(() => {
    if (!isComposing) {
      setActiveSearchQuery(searchQuery);
    }
  }, [searchQuery, isComposing]);

  const matchesSearchQuery = (video: Video, searchValue: string) => {
    if (!searchValue.trim()) return true;
    const query = searchValue.toLowerCase();
    return (
      (video.prompt?.toLowerCase().includes(query)) ||
      (video.account?.toLowerCase().includes(query)) ||
      (video.filename?.toLowerCase().includes(query))
    );
  };

  const matchesTag = (video: Video, tag: string) => {
    if (!tag) return true;
    if (tag === UNTAGGED_FILTER) return !video.tags || video.tags.length === 0;
    return Boolean(video.tags?.includes(tag));
  };

  // 検索条件に一致する動画をフィルタリング
  const filteredVideos = useMemo(
    () => videos.filter(video => matchesSearchQuery(video, activeSearchQuery) && matchesTag(video, activeTag)),
    [videos, activeSearchQuery, activeTag]
  );
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const video of videos) {
      for (const tag of video.tags || []) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort(([a, aCount], [b, bCount]) => {
      if (bCount !== aCount) return bCount - aCount;
      return a.localeCompare(b, 'ja');
    });
  }, [videos]);
  const untaggedVideoCount = useMemo(
    () => videos.filter(video => !video.tags || video.tags.length === 0).length,
    [videos]
  );
  const activeTagLabel = activeTag === UNTAGGED_FILTER ? '未分類' : activeTag;
  const isSearchActive = activeSearchQuery.trim().length > 0 || activeTag.length > 0;
  const hasSearchResults = filteredVideos.length > 0;
  const isSearchPlaybackActive = isSearchActive && hasSearchResults;
  const playableVideos = isSearchPlaybackActive ? filteredVideos : videos;
  const currentVideoId = videos[currentIndex]?.id;
  const currentPlayableIndex = playableVideos.findIndex(v => v.id === currentVideoId);

  useEffect(() => {
    filteredVideosRef.current = filteredVideos;
  }, [filteredVideos]);

  const selectedVideos = useMemo(
    () => videos.filter(video => selectedVideoIds.has(video.id)),
    [videos, selectedVideoIds]
  );
  const selectedVideoCount = selectedVideos.length;

  // 選択中の動画すべてが持つタグ（共通タグ）を算出
  const selectedVideosCommonTags = useMemo(() => {
    if (selectedVideos.length === 0) return new Set<string>();
    const first = new Set(selectedVideos[0].tags || []);
    for (let i = 1; i < selectedVideos.length; i++) {
      const tags = new Set(selectedVideos[i].tags || []);
      for (const tag of first) {
        if (!tags.has(tag)) first.delete(tag);
      }
    }
    return first;
  }, [selectedVideos]);

  // 選択中の動画のいずれかが持つタグ（和集合）を算出
  const selectedVideosAnyTags = useMemo(() => {
    const all = new Set<string>();
    for (const video of selectedVideos) {
      for (const tag of video.tags || []) all.add(tag);
    }
    return all;
  }, [selectedVideos]);

  const jumpToPlayableIndex = (targetIndex: number) => {
    const targetVideo = playableVideos[targetIndex];
    if (!targetVideo) return;
    const originalIndex = videos.findIndex(v => v.id === targetVideo.id);
    if (originalIndex !== -1) {
      setCurrentIndex(originalIndex);
    }
  };

  const wrapPlayableIndex = (targetIndex: number) => {
    if (playableVideos.length === 0) return 0;
    return ((targetIndex % playableVideos.length) + playableVideos.length) % playableVideos.length;
  };

  const jumpToWrappedPlayableIndex = (targetIndex: number) => {
    jumpToPlayableIndex(wrapPlayableIndex(targetIndex));
  };

  const jumpByPageStep = (delta: number) => {
    if (playableVideos.length === 0) return;
    const baseIndex = currentPlayableIndex === -1 ? 0 : currentPlayableIndex;
    const lastIndex = playableVideos.length - 1;

    if (delta > 0) {
      jumpToPlayableIndex(baseIndex === lastIndex ? 0 : Math.min(baseIndex + delta, lastIndex));
      return;
    }

    jumpToPlayableIndex(baseIndex === 0 ? lastIndex : Math.max(baseIndex + delta, 0));
  };

  const playFromSearchInput = (searchValue: string) => {
    const nextQuery = searchValue.trim();
    setSearchQuery(searchValue);
    setActiveSearchQuery(searchValue);

    if (!nextQuery) {
      setShowThumbnailGrid(false);
      return;
    }

    const firstResultIndex = videos.findIndex(video => matchesSearchQuery(video, searchValue));
    if (firstResultIndex === -1) {
      searchInputRef.current?.focus();
      return;
    }

    setCurrentIndex(firstResultIndex);
    setShowThumbnailGrid(false);
  };

  const toggleSelectedVideo = (videoId: string) => {
    setSelectedVideoIds(prev => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return next;
    });
  };

  const startSelectionDrag = (filteredIdx: number, clientX: number, clientY: number) => {
    isSelectionDraggingRef.current = true;
    selectionDragAnchorRef.current = filteredIdx;
    selectionPointerRef.current = { x: clientX, y: clientY };
    startSelectionAutoScroll();
    // 起点の動画をトグルし、トグル後の状態をベースとして保存
    const videoId = filteredVideos[filteredIdx]?.id;
    if (videoId) {
      setSelectedVideoIds(prev => {
        const next = new Set(prev);
        if (next.has(videoId)) {
          next.delete(videoId);
        } else {
          next.add(videoId);
        }
        selectionDragBaseIdsRef.current = new Set(next);
        return next;
      });
    } else {
      selectionDragBaseIdsRef.current = new Set(selectedVideoIds);
    }
  };

  const updateSelectionFromPointer = () => {
    const pointer = selectionPointerRef.current;
    if (!pointer) return;

    const hoveredThumbnail = document
      .elementFromPoint(pointer.x, pointer.y)
      ?.closest<HTMLElement>('[data-filtered-index]');
    const filteredIdx = Number(hoveredThumbnail?.dataset.filteredIndex);
    if (Number.isInteger(filteredIdx)) {
      selectVideoDuringDrag(filteredIdx);
    }
  };

  const startSelectionAutoScroll = () => {
    if (selectionAutoScrollFrameRef.current !== null) return;

    const tick = () => {
      selectionAutoScrollFrameRef.current = null;
      if (!isSelectionDraggingRef.current) return;

      const scrollEl = galleryScrollRef.current;
      const pointer = selectionPointerRef.current;
      if (scrollEl && pointer) {
        const rect = scrollEl.getBoundingClientRect();
        const edgeSize = 120;
        const maxScrollStep = 28;
        let scrollStep = 0;

        if (pointer.y < rect.top + edgeSize) {
          scrollStep = -Math.ceil((1 - (pointer.y - rect.top) / edgeSize) * maxScrollStep);
        } else if (pointer.y > rect.bottom - edgeSize) {
          scrollStep = Math.ceil((1 - (rect.bottom - pointer.y) / edgeSize) * maxScrollStep);
        }

        if (scrollStep !== 0) {
          scrollEl.scrollBy({ top: scrollStep });
          updateSelectionFromPointer();
        }
      }

      selectionAutoScrollFrameRef.current = requestAnimationFrame(tick);
    };

    selectionAutoScrollFrameRef.current = requestAnimationFrame(tick);
  };

  const selectVideoDuringDrag = (filteredIdx: number) => {
    if (!isSelectionDraggingRef.current) return;
    const anchor = selectionDragAnchorRef.current;
    if (anchor === -1) return;

    const dragVideos = filteredVideosRef.current;
    const start = Math.min(anchor, filteredIdx);
    const end = Math.max(anchor, filteredIdx);

    // ベースで起点が選択中なら範囲も選択方向、未選択なら解除方向
    const anchorVideo = dragVideos[anchor];
    const anchorSelected = anchorVideo ? selectionDragBaseIdsRef.current.has(anchorVideo.id) : true;

    // ベースの選択状態をコピーし、範囲内を追加 or 除外
    const next = new Set(selectionDragBaseIdsRef.current);
    for (let i = start; i <= end; i++) {
      const vid = dragVideos[i];
      if (!vid) continue;
      if (anchorSelected) {
        next.add(vid.id);
      } else {
        next.delete(vid.id);
      }
    }
    setSelectedVideoIds(next);
  };

  const saveTagsForSelectedVideos = async () => {
    if (selectedVideos.length === 0) return;

    const newTags = tagInput.split(',').map(tag => tag.trim()).filter(Boolean);
    const finalTags = Array.from(new Set([...pendingTags, ...newTags]));

    if (finalTags.length === 0 && selectedVideoCount > 1) return;

    // 1件選択: PUTで上書き（トグル式編集）、複数選択: POSTで追加のみ
    const method = selectedVideoCount === 1 ? 'PUT' : 'POST';
    const body = selectedVideoCount === 1
      ? { filenames: selectedVideos.map(v => v.filename), tags: finalTags }
      : { filenames: selectedVideos.map(v => v.filename), tags: finalTags };

    const res = await fetch('/api/tags', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to save tags');

    const savedTags = data.tags || {};
    const savedFilenames = new Set(selectedVideos.map(video => video.filename));
    setVideos(prev => prev.map(video => ({
      ...video,
      tags: savedTags[video.filename] || (savedFilenames.has(video.filename) ? [] : video.tags || [])
    })));
    setTagInput('');
    setPendingTags(new Set());
    setSelectedVideoIds(new Set());
  };

  const resetGalleryToAll = () => {
    setSearchQuery('');
    setActiveSearchQuery('');
    setActiveTag('');
    setSelectedVideoIds(new Set());
    setTagInput('');
    setCurrentIndex(0);
  };

  const openTagGallery = (tag: string) => {
    setSearchQuery('');
    setActiveSearchQuery('');
    setActiveTag(tag);
    setSelectedVideoIds(new Set());
    setTagInput('');
    setShowThumbnailGrid(true);
  };

  const openSearchGallery = (searchValue: string) => {
    setSearchQuery(searchValue);
    setActiveSearchQuery(searchValue);
    setActiveTag('');
    setSelectedVideoIds(new Set());
    setTagInput('');
    setShowThumbnailGrid(true);
  };

  const renderPromptText = (prompt: string) => {
    const parts: (string | ReactNode)[] = [];
    let lastIndex = 0;

    for (const match of prompt.matchAll(cameoPattern)) {
      const cameo = match[0];
      const index = match.index ?? 0;

      if (index > lastIndex) {
        parts.push(prompt.slice(lastIndex, index));
      }

      parts.push(
        <button
          key={`${cameo}-${index}`}
          onClick={() => openSearchGallery(cameo)}
          className="pointer-events-auto rounded px-1 text-blue-200 transition-colors hover:bg-blue-500/20 hover:text-blue-100 focus:outline-none focus-visible:bg-blue-500/25"
          title={`"${cameo}" の検索結果を表示`}
        >
          {cameo}
        </button>
      );
      lastIndex = index + cameo.length;
    }

    if (lastIndex < prompt.length) {
      parts.push(prompt.slice(lastIndex));
    }

    return parts.length > 0 ? parts : prompt;
  };

  // showThumbnailGridが変わったときにrenderGridを同期（閉じる時はアニメーション後に消す）
  useEffect(() => {
    if (showThumbnailGrid) {
      setRenderGrid(true);
      setShowSearchBar(true);

      const frameId = requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
      return () => cancelAnimationFrame(frameId);
    } else {
      searchInputRef.current?.blur();
      setShowSearchBar(false);

      const timer = setTimeout(() => setRenderGrid(false), 150);
      return () => clearTimeout(timer);
    }
  }, [showThumbnailGrid]);

  // 選択動画が変わったらpendingTagsを共通タグで初期化
  useEffect(() => {
    if (selectedVideoIds.size > 0) {
      setPendingTags(new Set(selectedVideosCommonTags));
    } else {
      setPendingTags(new Set());
    }
  }, [selectedVideoIds, selectedVideosCommonTags]);

  useEffect(() => {
    if (!showThumbnailGrid) {
      setSelectedVideoIds(new Set());
    }
  }, [showThumbnailGrid]);

  useEffect(() => {
    if (!showThumbnailGrid || selectedVideoCount === 0) return;

    const frameId = requestAnimationFrame(() => {
      tagInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frameId);
  }, [showThumbnailGrid, selectedVideoCount]);

  useEffect(() => {
    const trackSelectionPointer = (event: PointerEvent) => {
      if (!isSelectionDraggingRef.current) return;
      selectionPointerRef.current = { x: event.clientX, y: event.clientY };
      updateSelectionFromPointer();
      startSelectionAutoScroll();
    };

    const stopSelectionDrag = () => {
      isSelectionDraggingRef.current = false;
      selectionPointerRef.current = null;
      if (selectionAutoScrollFrameRef.current !== null) {
        cancelAnimationFrame(selectionAutoScrollFrameRef.current);
        selectionAutoScrollFrameRef.current = null;
      }
    };

    window.addEventListener('pointermove', trackSelectionPointer);
    window.addEventListener('pointerup', stopSelectionDrag);
    window.addEventListener('pointercancel', stopSelectionDrag);
    return () => {
      window.removeEventListener('pointermove', trackSelectionPointer);
      window.removeEventListener('pointerup', stopSelectionDrag);
      window.removeEventListener('pointercancel', stopSelectionDrag);
      stopSelectionDrag();
    };
  }, []);

  // 検索中は検索結果だけを再生対象にする。現在の動画が結果外なら先頭の結果へ移動する。
  useEffect(() => {
    if (!isSearchActive || filteredVideos.length === 0) return;
    if (filteredVideos.some(video => video.id === currentVideoId)) return;

    const firstResultIndex = videos.findIndex(video => video.id === filteredVideos[0].id);
    if (firstResultIndex !== -1) {
      setCurrentIndex(firstResultIndex);
    }
  }, [isSearchActive, filteredVideos, videos, currentVideoId]);

  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const progressRef = useRef<HTMLDivElement | null>(null);
  const touchStartY = useRef<number | null>(null);
  const lastScrollTime = useRef(0);

  useEffect(() => {
    Promise.all([
      fetch('/api/videos').then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to fetch videos');
        return data;
      }),
      fetch('/api/tags').then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to fetch tags');
        return data;
      })
    ])
      .then(([videosData, tagsData]) => {
        const tagMap = tagsData.videos || {};
        setVideos((videosData.videos || []).map((video: Video) => ({
          ...video,
          tags: tagMap[video.filename] || []
        })));
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
    if (playableVideos.length === 0) return;
    const baseIndex = currentPlayableIndex === -1 ? 0 : currentPlayableIndex;
    jumpToWrappedPlayableIndex(baseIndex + 1);
  };
  const goToPrev = () => {
    if (playableVideos.length === 0) return;
    const baseIndex = currentPlayableIndex === -1 ? 0 : currentPlayableIndex;
    jumpToWrappedPlayableIndex(baseIndex - 1);
  };

  const handleIndexJump = () => {
    const num = parseInt(editValue, 10);
    if (!isNaN(num)) {
      const target = Math.max(0, Math.min(num - 1, playableVideos.length - 1));
      jumpToPlayableIndex(target);
    }
    setIsEditingIndex(false);
  };

  const startEditing = () => {
    const displayIndex = isSearchPlaybackActive && currentPlayableIndex !== -1
      ? currentPlayableIndex + 1
      : currentIndex + 1;
    setEditValue(String(displayIndex));
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

      // /: 検索ギャラリーを開く。表示中は検索欄へフォーカスを戻す。
      if (e.key === '/') {
        e.preventDefault();
        if (showThumbnailGrid) {
          setShowSearchBar(true);
          searchInputRef.current?.focus();
        } else {
          setShowThumbnailGrid(true);
        }
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
        if (playableVideos.length === 0) return;
        const randomIndex = Math.floor(Math.random() * playableVideos.length);
        jumpToPlayableIndex(randomIndex);
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
          jumpToPlayableIndex(playableVideos.length - 1);
        } else if (e.metaKey) {
          jumpByPageStep(100);
        } else if (e.shiftKey) {
          jumpByPageStep(10);
        } else {
          goToNext();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (e.metaKey && e.shiftKey) {
          jumpToPlayableIndex(0);
        } else if (e.metaKey) {
          jumpByPageStep(-100);
        } else if (e.shiftKey) {
          jumpByPageStep(-10);
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
  }, [videos, currentIndex, playableVideos, currentPlayableIndex, showThumbnailGrid]);

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
  }, [videos.length, showThumbnailGrid, playableVideos, currentPlayableIndex]); // goToNext/goToPrev が再生対象に依存するため

  // Escapeキーでギャラリーを閉じる
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showThumbnailGrid) {
        if (selectedVideoIds.size > 0) {
          setSelectedVideoIds(new Set());
          setTagInput('');
        } else if (searchQuery) {
          setSearchQuery('');
        } else {
          setShowThumbnailGrid(false);
        }
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showThumbnailGrid, searchQuery, selectedVideoIds]);

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
    const leftThreshold = window.innerWidth * 0.4; // 左側40%を判定範囲に
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
  const displayIndex = isSearchPlaybackActive && currentPlayableIndex !== -1
    ? currentPlayableIndex
    : currentIndex;
  const displayTotal = isSearchPlaybackActive ? playableVideos.length : videos.length;

  // シームレスな切り替えのため、現在・前・次の動画を事前にマウントしておく
  const prevVideo = currentPlayableIndex > 0 ? playableVideos[currentPlayableIndex - 1] : null;
  const nextVideo = currentPlayableIndex !== -1 && currentPlayableIndex < playableVideos.length - 1 ? playableVideos[currentPlayableIndex + 1] : null;
  const renderVideos = [prevVideo, currentVideo, nextVideo].filter(Boolean) as Video[];
  const sidePanelButtonClass = "w-10 h-10 flex items-center justify-center text-white hover:text-blue-400 disabled:opacity-20 transition-all hover:scale-110 active:scale-95 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:ring-offset-0";

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
              onClick={() => jumpToPlayableIndex(0)}
              disabled={displayIndex === 0}
              className={sidePanelButtonClass}
              title="Jump to Newest (⌘+Shift+↑)"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 4h14M12 20V8M7 13l5-5 5 5" />
              </svg>
            </button>
            
            {/* Go Previous */}
            <button 
              onClick={goToPrev}
              className={`${sidePanelButtonClass} -mt-1`}
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
                    {displayIndex + 1}
                  </span>
                )}
              </div>
              <div className="w-4 h-[1px] bg-white/40" />
              <span className="text-[10px] text-white/50 font-mono font-light text-center">
                {displayTotal}
              </span>
            </div>

            {/* Go Next */}
            <button 
              onClick={goToNext}
              className={`${sidePanelButtonClass} -mb-1`}
              title="Next (↓)"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {/* Jump to Oldest */}
            <button 
              onClick={() => jumpToPlayableIndex(playableVideos.length - 1)}
              disabled={displayIndex === displayTotal - 1}
              className={sidePanelButtonClass}
              title="Jump to Oldest (⌘+Shift+↓)"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 20h14M12 4v12M7 11l5 5 5-5" />
              </svg>
            </button>

            <div className="w-6 h-[1px] bg-white/10 my-1" />

            {/* Search Gallery Toggle */}
            <button 
              onClick={() => setShowThumbnailGrid(true)}
              className={sidePanelButtonClass}
              title="Search gallery (/)"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>

            {/* Random Jump */}
            <button 
              onClick={() => {
                if (playableVideos.length === 0) return;
                const randomIndex = Math.floor(Math.random() * playableVideos.length);
                jumpToPlayableIndex(randomIndex);
              }}
              className={sidePanelButtonClass}
              title="Random jump (R)"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <g transform="rotate(90 12 12)">
                  <polyline points="16 3 21 3 21 8" />
                  <line x1="4" y1="20" x2="21" y2="3" />
                  <polyline points="21 16 21 21 16 21" />
                  <line x1="15" y1="15" x2="21" y2="21" />
                  <line x1="4" y1="4" x2="9" y2="9" />
                </g>
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
              <div className="text-white text-base font-light leading-relaxed drop-shadow-2xl mb-2 line-clamp-4">
                {renderPromptText(currentVideo.prompt)}
              </div>
            )}
            {currentVideo.tags && currentVideo.tags.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {currentVideo.tags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => openTagGallery(tag)}
                    className="pointer-events-auto rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/75 backdrop-blur-md border border-white/10 transition-colors hover:bg-blue-500/25 hover:text-blue-100 hover:border-blue-300/50 focus:outline-none focus-visible:border-blue-200"
                    title={`タグ "${tag}" のギャラリーを表示`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 pt-2 border-t border-white/10 text-white/70 text-sm font-medium">
              {currentVideo.account && (
                <span className="tracking-wide">@{currentVideo.account}</span>
              )}
              <span className="opacity-30">|</span>
              <span className="tracking-wide">{date}</span>
              <span className="opacity-30">|</span>
              <button
                onClick={(e) => {
                  e.currentTarget.blur();
                  fetch('/api/videos', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: currentVideo.id })
                  }).catch(err => console.error('Failed to open folder:', err));
                }}
                className="group/file flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer pointer-events-auto focus:outline-none"
                title="Finderでフォルダを開く"
              >
                <span className="font-mono text-xs opacity-50 group-hover/file:opacity-100 truncate max-w-[240px]">
                  {currentVideo.filename || currentVideo.url.split('/').pop()?.replace(/\.mp4$/i, '') || currentVideo.id}
                </span>
                <svg className="w-3 h-3 opacity-0 group-hover/file:opacity-50 transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
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
        
        {/* スクロール可能なコンテンツエリア */}
        <div ref={galleryScrollRef} className="absolute inset-0 overflow-y-auto">
          <div className="max-w-7xl mx-auto p-6 md:p-12 pt-24 md:pt-32" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-10">
              <div className="flex flex-col gap-1">
                <button
                  onClick={resetGalleryToAll}
                  className="w-fit text-left text-2xl font-light tracking-widest uppercase text-white/50 transition-colors hover:text-white/80 focus:outline-none focus-visible:text-white/80"
                  title="All の先頭に戻る"
                >
                  Sora2 Player
                </button>
                {(searchQuery || activeTag) && (
                  <p className="text-xs text-blue-400 font-mono">
                    Showing {filteredVideos.length} of {videos.length}
                    {searchQuery && ` results for "${searchQuery}"`}
                    {activeTag && ` tagged "${activeTagLabel}"`}
                  </p>
                )}
              </div>
            </div>

            <div className="mb-8">
              {(tagCounts.length > 0 || untaggedVideoCount > 0) && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setActiveTag('')}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      activeTag === ''
                        ? 'border-white/40 bg-white/15 text-white'
                        : 'border-white/10 bg-white/5 text-white/50 hover:text-white'
                    }`}
                  >
                    All <span className="ml-1 text-white/40">{videos.length}</span>
                  </button>
                  {untaggedVideoCount > 0 && (
                    <button
                      onClick={() => setActiveTag(UNTAGGED_FILTER)}
                      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                        activeTag === UNTAGGED_FILTER
                          ? 'border-blue-300/60 bg-blue-500/20 text-blue-100'
                          : 'border-white/10 bg-white/5 text-white/60 hover:text-white'
                      }`}
                    >
                      未分類 <span className="ml-1 opacity-60">{untaggedVideoCount}</span>
                    </button>
                  )}
                  {tagCounts.map(([tag, count]) => (
                    <button
                      key={tag}
                      onClick={() => setActiveTag(tag)}
                      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                        activeTag === tag
                          ? 'border-blue-300/60 bg-blue-500/20 text-blue-100'
                          : 'border-white/10 bg-white/5 text-white/60 hover:text-white'
                      }`}
                    >
                      {tag} <span className="ml-1 opacity-60">{count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6 pb-40">
              {renderGrid && filteredVideos.map((video, index) => {
                // 元の配列でのインデックスを探す（動画切り替え用）
                const originalIndex = videos.findIndex(v => v.id === video.id);
                return (
                  <ThumbnailItem 
                    key={video.id}
                    video={video}
                    index={originalIndex}
                    filteredIndex={index}
                    isActive={originalIndex === currentIndex}
                    isSelected={selectedVideoIds.has(video.id)}
                    onToggleSelected={() => toggleSelectedVideo(video.id)}
                    onSelectionDragStart={(clientX, clientY) => startSelectionDrag(index, clientX, clientY)}
                    onSelectionDragEnter={() => selectVideoDuringDrag(index)}
                    onClick={() => {
                      setCurrentIndex(originalIndex);
                      setShowThumbnailGrid(false);
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* 検索バーコンテナ (下部ホバーで表示) */}
        <div
          className="absolute bottom-0 left-0 right-0 h-44 z-[70] flex items-end justify-center pb-10 pointer-events-none"
          onMouseEnter={() => setShowSearchBar(true)}
          onMouseLeave={() => setShowSearchBar(false)}
        >
          <div className={`w-full px-6 pointer-events-auto transition-all duration-200 ${
            selectedVideoCount > 0 ? 'max-w-xl opacity-100' : `max-w-md ${showSearchBar || searchQuery ? 'opacity-100' : 'opacity-0'}`
          }`}>
            <div className="relative group/search">
              {/* 発光をさらに控えめに */}
              <div className={`absolute -inset-0.5 rounded-2xl blur-md opacity-0 group-focus-within/search:opacity-100 transition duration-500 ${
                selectedVideoCount > 0 ? 'bg-emerald-400/20' : 'bg-blue-400/25'
              }`} />
              
              <div className={`relative flex flex-col bg-black/80 backdrop-blur-3xl rounded-2xl overflow-hidden shadow-2xl ${
                selectedVideoCount > 0 ? 'border border-white/5' : 'border border-white/12'
              }`}>
                {selectedVideoCount > 0 ? (
                  <>
                    {(() => {
                      const isSingle = selectedVideoCount === 1;
                      // 1件: 全既存タグ + pendingTags内の新規タグを表示、複数: 既存タグのみ
                      const existingTagNames = tagCounts.map(([tag]) => tag);
                      const allTagNames = isSingle
                        ? Array.from(new Set([...existingTagNames, ...pendingTags]))
                        : existingTagNames;
                      return allTagNames.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5 pb-1.5 max-h-40 overflow-y-auto scrollbar-hide">
                          {allTagNames.map(tag => {
                            const isOn = pendingTags.has(tag);
                            const isPartial = !isOn && selectedVideosAnyTags.has(tag);
                            return (
                              <button
                                key={tag}
                                onClick={() => {
                                  if (isSingle) {
                                    // 1件: トグル式
                                    setPendingTags(prev => {
                                      const next = new Set(prev);
                                      if (next.has(tag)) {
                                        next.delete(tag);
                                      } else {
                                        next.add(tag);
                                      }
                                      return next;
                                    });
                                  } else {
                                    // 複数: 追加のみ
                                    setPendingTags(prev => {
                                      if (prev.has(tag)) return prev;
                                      const next = new Set(prev);
                                      next.add(tag);
                                      return next;
                                    });
                                  }
                                }}
                                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
                                  isOn
                                    ? 'bg-emerald-400/25 text-emerald-200 ring-1 ring-emerald-400/40'
                                    : isPartial
                                      ? 'bg-amber-400/15 text-amber-200/70 ring-1 ring-amber-400/20 hover:bg-amber-400/25'
                                      : 'bg-white/8 text-white/40 hover:bg-white/15 hover:text-white/70'
                                }`}
                              >
                                {tag}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                    <div className="flex items-center">
                      <div className="pl-5 text-emerald-200/45 shrink-0">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
                          <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
                        </svg>
                      </div>
                      <div className="ml-4 flex items-center gap-1 rounded-full bg-emerald-400/10 pl-3 pr-1 py-1 text-xs text-emerald-100/90 whitespace-nowrap">
                        {selectedVideoCount}件を選択中
                        <button
                          onClick={() => { setSelectedVideoIds(new Set()); setTagInput(''); }}
                          className="flex items-center justify-center w-5 h-5 rounded-full hover:bg-white/10 text-emerald-200/60 hover:text-white transition-colors"
                          title="選択を解除"
                        >
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <input
                        ref={tagInputRef}
                        type="text"
                        placeholder={selectedVideoCount === 1 ? '新しいタグを追加（カンマ区切り）' : '追加するタグ（カンマ区切り）'}
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            saveTagsForSelectedVideos().catch(err => console.error(err));
                          }
                        }}
                        className="min-w-0 flex-1 h-14 bg-transparent border-none px-4 text-white text-sm placeholder:text-white/15 focus:outline-none"
                      />
                      <button
                        onClick={() => {
                          setSelectedVideoIds(new Set());
                          setTagInput('');
                        }}
                        className="mr-1 flex h-9 w-9 items-center justify-center rounded-full text-white/30 hover:bg-white/10 hover:text-white transition-colors"
                        title="選択解除"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                      <button
                        onClick={() => saveTagsForSelectedVideos().catch(err => console.error(err))}
                        disabled={selectedVideoCount > 1 && pendingTags.size === 0 && tagInput.trim().length === 0}
                        className="mr-2 flex h-10 items-center gap-1.5 rounded-xl border border-emerald-300/20 bg-emerald-400/15 px-3 text-sm font-medium text-emerald-50 transition-colors hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/5 disabled:text-white/25"
                        title={selectedVideoCount === 1 ? 'タグを確定' : 'タグを追加'}
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          {selectedVideoCount === 1
                            ? <path d="M20 6 9 17l-5-5" />
                            : <path d="M12 5v14M5 12h14" />
                          }
                        </svg>
                        <span className="hidden sm:inline">{selectedVideoCount === 1 ? '確定' : '追加'}</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center w-full">
                    <div className="pl-5 text-white/35 shrink-0">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                    </div>
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search prompts or accounts..."
                      value={searchQuery}
                      onCompositionStart={() => setIsComposing(true)}
                      onCompositionEnd={() => {
                        setIsComposing(false);
                      }}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                      }}
                      onKeyDown={(e) => {
                        const isComposingText = isComposing || e.nativeEvent.isComposing;
                        if (e.key === 'Enter' && !isComposingText) {
                          e.preventDefault();
                          setSearchQuery(e.currentTarget.value);
                          setActiveSearchQuery(e.currentTarget.value);
                        }
                      }}
                      className="w-full h-14 bg-transparent border-none px-4 text-white text-sm placeholder:text-white/25 focus:outline-none"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="pr-3 text-white/30 hover:text-white transition-colors shrink-0"
                        title="検索をクリア"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={() => playFromSearchInput(searchQuery)}
                      className="mr-2 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/90 transition-colors hover:bg-white/10 hover:border-white/20 shrink-0"
                      title="再生"
                    >
                      <svg className="h-4 w-4 fill-current ml-0.5" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
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
                ['/', '検索ギャラリー 開く / フォーカス'],
                ['r', 'ランダムジャンプ'],
                ['m', 'ミュート 切り替え'],
                ['f', 'フルスクリーン 切り替え'],
                ['Esc', 'ギャラリー / このパネルを閉じる'],
                ['?', 'このヘルプを表示 / 非表示'],
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
