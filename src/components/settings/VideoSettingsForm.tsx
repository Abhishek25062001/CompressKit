import { CODEC_LABEL, CONTAINER_CODECS } from '../../features/video/videoParams';
import { useCapabilitiesStore } from '../../store/capabilitiesStore';
import { FFMPEG_FALLBACK_CODEC } from '../../utils/mediaCapabilities';
import type {
  AudioBitrate,
  VideoCodecId,
  VideoContainer,
  VideoEngineChoice,
  VideoFps,
  VideoResolution,
  VideoSettings,
} from '../../types/settings';
import { Select, type SelectOption } from '../common/Select';
import { Slider } from '../common/Slider';

interface Props {
  value: VideoSettings;
  onChange: (patch: Partial<VideoSettings>) => void;
}

const RESOLUTIONS: SelectOption<VideoResolution>[] = [
  { value: 'original', label: 'Original (recommended)' },
  { value: 2160, label: '4K · 2160p' },
  { value: 1440, label: '1440p' },
  { value: 1080, label: '1080p' },
  { value: 720, label: '720p' },
  { value: 480, label: '480p' },
  { value: 360, label: '360p' },
];

const FPS: SelectOption<VideoFps>[] = [
  { value: 'original', label: 'Original' },
  { value: 60, label: 'Max 60 fps' },
  { value: 30, label: 'Max 30 fps' },
  { value: 24, label: 'Max 24 fps' },
];

const AUDIO: SelectOption<AudioBitrate>[] = [
  { value: 192, label: '192 kbps' },
  { value: 160, label: '160 kbps' },
  { value: 128, label: '128 kbps' },
  { value: 96, label: '96 kbps' },
  { value: 64, label: '64 kbps' },
  { value: 'remove', label: 'Remove audio' },
];

function qualityLabel(q: number): string {
  if (q >= 80) return `${q} · very high`;
  if (q >= 60) return `${q} · high`;
  if (q >= 40) return `${q} · medium`;
  return `${q} · low`;
}

export function VideoSettingsForm({ value, onChange }: Props) {
  const video = useCapabilitiesStore((s) => s.video);
  const webCodecs = useCapabilitiesStore((s) => s.browser.webCodecs);

  const codecOptions: SelectOption<VideoCodecId>[] = CONTAINER_CODECS[value.container].map((c) => {
    const hw = video.webcodecs[c];
    const sw = video.ffmpeg[c];
    const suffix = hw ? '' : sw ? ' (software, slower)' : ` (unavailable, uses ${CODEC_LABEL[FFMPEG_FALLBACK_CODEC[value.container]]})`;
    return { value: c, label: `${CODEC_LABEL[c]}${suffix}` };
  });

  const engines: SelectOption<VideoEngineChoice>[] = [
    { value: 'auto', label: 'Automatic (recommended)' },
    { value: 'webcodecs', label: webCodecs ? 'WebCodecs (hardware)' : 'WebCodecs (not supported here)', disabled: !webCodecs },
    { value: 'ffmpeg', label: 'FFmpeg.wasm (most compatible)' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Select<VideoContainer>
          label="Format"
          value={value.container}
          options={[
            { value: 'mp4', label: 'MP4' },
            { value: 'webm', label: 'WebM' },
          ]}
          onChange={(container) => onChange({ container })}
        />
        <Select label="Codec" value={value.codec} options={codecOptions} onChange={(codec) => onChange({ codec })} />
      </div>
      <Slider
        label="Quality"
        min={1}
        max={100}
        value={value.quality}
        onChange={(quality) => onChange({ quality })}
        format={qualityLabel}
        hint="Mapped to CRF for FFmpeg and to a bitrate target for WebCodecs."
      />
      <div className="grid grid-cols-2 gap-3">
        <Select label="Resolution" value={value.resolution} options={RESOLUTIONS} onChange={(resolution) => onChange({ resolution })} />
        <Select label="Frame rate" value={value.fps} options={FPS} onChange={(fps) => onChange({ fps })} />
      </div>
      <Select label="Audio" value={value.audioBitrate} options={AUDIO} onChange={(audioBitrate) => onChange({ audioBitrate })} />
      <Select
        label="Engine"
        value={value.engine}
        options={engines}
        onChange={(engine) => onChange({ engine })}
        hint="Automatic uses fast hardware encoding when available and falls back to FFmpeg."
      />
    </div>
  );
}
