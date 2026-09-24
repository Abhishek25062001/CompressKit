import { motion } from 'framer-motion';
import { ArrowLeftRight, Cpu, Layers, ShieldCheck, SplitSquareHorizontal, WifiOff, type LucideIcon } from 'lucide-react';
import { SectionHeading } from './SectionHeading';

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ShieldCheck,
    title: 'Private by design',
    body: 'Files are read and processed by your browser in background workers. They are never uploaded.',
  },
  {
    icon: Cpu,
    title: 'Hardware-accelerated video',
    body: 'Uses WebCodecs for fast encoding when your browser supports it, with FFmpeg.wasm as a universal fallback.',
  },
  {
    icon: ArrowLeftRight,
    title: 'Convert, crop, trim and PDF',
    body: 'Convert images and videos, crop photos to passport or social media sizes, trim videos or split them for WhatsApp Status, and turn photos into PDFs, merge, split or reorder pages.',
  },
  {
    icon: Layers,
    title: 'Batch processing',
    body: 'Add many files at once, compress them in parallel and download everything as a single ZIP.',
  },
  {
    icon: SplitSquareHorizontal,
    title: 'See the difference',
    body: 'A before and after slider for images and side by side playback for videos.',
  },
  {
    icon: WifiOff,
    title: 'Installable and offline ready',
    body: 'Install it as an app. After your first visit the interface works offline, and the video engine is cached after its first use.',
  },
];

export function Features() {
  return (
    <section aria-labelledby="features-title" id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
      <SectionHeading
        id="features-title"
        eyebrow="Features"
        title="Serious compression, zero setup"
        description="Real encoders running on your own device, wrapped in an interface that stays out of your way."
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <motion.li
            key={f.title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ delay: (i % 3) * 0.06, duration: 0.45 }}
            className="card group p-6 transition-colors hover:border-border-strong"
          >
            <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
              <f.icon className="h-5 w-5" aria-hidden />
            </span>
            <h3 className="font-semibold text-fg">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.body}</p>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
