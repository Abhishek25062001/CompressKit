import { Pause, Play } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { formatBytes, formatDuration } from '../../utils/format';
import { Button } from '../common/Button';

interface VideoCompareProps {
  original: Blob;
  originalSize: number;
  originalDuration?: number;
  compressedUrl: string;
  compressedSize: number;
  compressedDuration?: number;
}

function Panel({
  label,
  url,
  size,
  duration,
  videoRef,
  onEnded,
}: {
  label: string;
  url: string | null;
  size: number;
  duration?: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  onEnded: () => void;
}) {
  const [unplayable, setUnplayable] = useState(false);
  return (
    <figure className="min-w-0">
      <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-black">
        {url && !unplayable && (
          <video
            ref={videoRef}
            src={url}
            controls
            playsInline
            muted
            preload="metadata"
            onError={() => setUnplayable(true)}
            onEnded={onEnded}
            className="h-full w-full object-contain"
          />
        )}
        {unplayable && (
          <p className="flex h-full items-center justify-center p-4 text-center text-xs text-white/80">
            Your browser can't play this format, but the file is fine to download.
          </p>
        )}
      </div>
      <figcaption className="mt-2 flex items-center justify-between text-xs">
        <span className="font-medium text-fg">{label}</span>
        <span className="tabular text-muted">
          {formatBytes(size)} · {formatDuration(duration)}
        </span>
      </figcaption>
    </figure>
  );
}

export function VideoCompare(props: VideoCompareProps) {
  const originalUrl = useObjectUrl(props.original);
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const toggleBoth = () => {
    const videos = [a.current, b.current].filter((v): v is HTMLVideoElement => !!v);
    if (playing) {
      videos.forEach((v) => v.pause());
      setPlaying(false);
    } else {
      const t = videos[0]?.currentTime ?? 0;
      videos.forEach((v) => {
        v.currentTime = t;
        void v.play().catch(() => undefined);
      });
      setPlaying(true);
    }
  };

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel label="Original" url={originalUrl} size={props.originalSize} duration={props.originalDuration} videoRef={a} onEnded={() => setPlaying(false)} />
        <Panel label="Compressed" url={props.compressedUrl} size={props.compressedSize} duration={props.compressedDuration} videoRef={b} onEnded={() => setPlaying(false)} />
      </div>
      <div className="mt-3 flex justify-center">
        <Button size="sm" onClick={toggleBoth} icon={playing ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}>
          {playing ? 'Pause both' : 'Play both in sync'}
        </Button>
      </div>
    </div>
  );
}
