'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { Video } from '../types';
import { thumbnailCache } from '../thumbnail-cache';

type ThumbnailItemProps = {
  video: Video;
  index: number;
  isActive: boolean;
  isSelected: boolean;
  onClick: () => void;
  onSelectionDragStart: (clientX: number, clientY: number) => void;
  onSelectionDragEnter: () => void;
  filteredIndex: number;
};

export const ThumbnailItem = memo(function ThumbnailItem({
  video,
  index,
  isActive,
  isSelected,
  onClick,
  onSelectionDragStart,
  onSelectionDragEnter,
  filteredIndex
}: ThumbnailItemProps) {
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

  const handleLoadedData = () => {
    if (cachedUrl || !videoRef.current) return;

    try {
      const videoEl = videoRef.current;
      const canvas = document.createElement('canvas');

      const targetWidth = 300;
      const scale = targetWidth / videoEl.videoWidth;
      canvas.width = targetWidth;
      canvas.height = videoEl.videoHeight * scale;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/webp', 0.6);
        thumbnailCache.set(video.url, dataUrl);
        setCachedUrl(dataUrl);

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

  useEffect(() => {
    if (isActive && containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: 'auto', block: 'center' });
    }
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      data-filtered-index={filteredIndex}
      data-active={isActive}
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
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cachedUrl}
          alt=""
          onError={() => {
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
          className="h-full w-full object-cover opacity-0"
          preload="metadata"
          muted
          playsInline
        />
      ) : null}

      {!cachedUrl && shouldLoad && (
        <div className="absolute inset-0 bg-gradient-to-b from-white/3 to-transparent animate-pulse" />
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

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
}, (prevProps, nextProps) => {
  return (
    prevProps.isActive === nextProps.isActive &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.filteredIndex === nextProps.filteredIndex &&
    prevProps.index === nextProps.index &&
    prevProps.video.id === nextProps.video.id &&
    prevProps.video.thumbnail === nextProps.video.thumbnail &&
    prevProps.video.tags?.join(',') === nextProps.video.tags?.join(',')
  );
});
