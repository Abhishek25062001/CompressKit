import { Eraser, PenLine, Type, Upload } from 'lucide-react';
import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { SIGNATURE_FONTS, signatureFromDrawing, signatureFromImage, signatureFromText, type SignatureFont } from '../../features/pdf/signature';
import { usePdfStore } from '../../store/pdfStore';
import { useUiStore } from '../../store/uiStore';
import { Button } from '../common/Button';
import { SegmentedControl } from '../common/SegmentedControl';
import { Select } from '../common/Select';
import { Switch } from '../common/Switch';

type Mode = 'draw' | 'type' | 'upload';

const INKS = [
  { value: '#111827', label: 'Black' },
  { value: '#1d4ed8', label: 'Blue' },
] as const;

function InkPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <SegmentedControl
      label="Ink color"
      size="sm"
      value={value}
      onChange={onChange}
      segments={INKS.map((ink) => ({
        value: ink.value,
        ariaLabel: `${ink.label} ink`,
        label: (
          <>
            <span className="h-3 w-3 rounded-full" style={{ background: ink.value }} aria-hidden /> {ink.label}
          </>
        ),
      }))}
    />
  );
}

function DrawPad({ ink, onDone }: { ink: string; onDone: (canvas: HTMLCanvasElement) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  // Match the backing store to the displayed size, so strokes are sharp on high-DPI screens.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
  }, []);

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = e.currentTarget.width / rect.width;
    return { x: (e.clientX - rect.left) * ratio, y: (e.clientY - rect.top) * ratio };
  };

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = point(e);
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const from = last.current;
    if (!from) return;
    const to = point(e);
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const ratio = e.currentTarget.width / e.currentTarget.getBoundingClientRect().width;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.6 * ratio * (e.pressure > 0 && e.pointerType === 'pen' ? 0.6 + e.pressure : 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    last.current = to;
    setEmpty(false);
  };
  const onUp = () => {
    last.current = null;
  };
  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <canvas
          ref={canvasRef}
          aria-label="Signature pad. Draw your signature with a mouse, finger or pen."
          role="img"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="h-40 w-full touch-none rounded-xl border border-border bg-white"
          style={{ cursor: 'crosshair' }}
        />
        {empty && (
          <span className="pointer-events-none absolute inset-x-0 bottom-8 mx-6 border-b border-dashed border-gray-300 pb-1 text-center text-xs text-gray-400">
            Sign here
          </span>
        )}
      </div>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={clear} icon={<Eraser className="h-3.5 w-3.5" aria-hidden />}>
          Clear
        </Button>
        <Button variant="primary" size="sm" disabled={empty} onClick={() => canvasRef.current && onDone(canvasRef.current)}>
          Use signature
        </Button>
      </div>
    </div>
  );
}

/** Creates the signature: drawn on a pad, typed in a handwriting font, or uploaded from a photo. */
export function SignatureMaker() {
  const [mode, setMode] = useState<Mode>('draw');
  const [ink, setInk] = useState<string>(INKS[0].value);
  const [name, setName] = useState('');
  const [font, setFont] = useState<SignatureFont>('script');
  const [removeBackground, setRemoveBackground] = useState(true);
  const [working, setWorking] = useState(false);
  const setSignature = usePdfStore((s) => s.setSignature);
  const notice = useUiStore((s) => s.pushNotice);
  const nameId = useId();
  const fileId = useId();

  const finish = async (make: () => Promise<Awaited<ReturnType<typeof signatureFromText>>>) => {
    setWorking(true);
    try {
      const asset = await make();
      if (asset) setSignature(asset);
      else notice({ tone: 'warning', title: 'No signature found', message: 'The signature came out empty. Try again with darker ink.' });
    } catch {
      notice({ tone: 'error', title: "We couldn't read that image", message: 'Try a JPG or PNG photo of your signature.' });
    } finally {
      setWorking(false);
    }
  };

  const css = SIGNATURE_FONTS.find((f) => f.value === font)?.css;

  return (
    <div className="space-y-4">
      <SegmentedControl
        label="How to create your signature"
        size="sm"
        value={mode}
        onChange={setMode}
        segments={[
          { value: 'draw', label: <><PenLine className="h-3.5 w-3.5" aria-hidden /> Draw</> },
          { value: 'type', label: <><Type className="h-3.5 w-3.5" aria-hidden /> Type</> },
          { value: 'upload', label: <><Upload className="h-3.5 w-3.5" aria-hidden /> Upload</> },
        ]}
      />
      {mode !== 'upload' && <InkPicker value={ink} onChange={setInk} />}

      {mode === 'draw' && <DrawPad ink={ink} onDone={(canvas) => void finish(() => signatureFromDrawing(canvas))} />}

      {mode === 'type' && (
        <div className="space-y-3">
          <div>
            <label htmlFor={nameId} className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">
              Your name
            </label>
            <input
              id={nameId}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Abhishek Jaiswal"
              className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-fg placeholder:text-subtle hover:border-border-strong focus-visible:border-accent"
            />
          </div>
          <Select label="Style" value={font} onChange={setFont} options={SIGNATURE_FONTS.map((f) => ({ value: f.value, label: f.label }))} />
          <div
            aria-hidden
            className="flex h-24 items-center justify-center overflow-hidden rounded-xl border border-border bg-white px-4 text-4xl whitespace-nowrap"
            style={{ fontFamily: css, fontStyle: font === 'italic' ? 'italic' : 'normal', color: ink }}
          >
            {name || <span className="text-base text-gray-400">Preview</span>}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" size="sm" disabled={!name.trim() || working} onClick={() => void finish(() => signatureFromText(name.trim(), font, ink))}>
              Use signature
            </Button>
          </div>
        </div>
      )}

      {mode === 'upload' && (
        <div className="space-y-3">
          <Switch
            label="Remove white background"
            description="Makes the paper transparent, so only the ink shows on the page."
            checked={removeBackground}
            onChange={setRemoveBackground}
          />
          <input
            id={fileId}
            type="file"
            accept="image/*,.heic,.heif"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void finish(() => signatureFromImage(file, removeBackground));
            }}
          />
          <label
            htmlFor={fileId}
            className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-border-strong/80 px-4 py-6 text-center text-sm text-muted transition-colors hover:border-accent/60 hover:text-fg"
          >
            <Upload className="h-5 w-5" aria-hidden />
            {working ? 'Preparing…' : 'Choose a photo of your signature'}
            <span className="text-xs">Sign on white paper, then take a clear, well-lit photo.</span>
          </label>
        </div>
      )}
    </div>
  );
}
