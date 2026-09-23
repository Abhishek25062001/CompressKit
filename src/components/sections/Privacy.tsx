import { motion } from 'framer-motion';
import { EyeOff, HardDrive, Lock, ServerOff } from 'lucide-react';

const POINTS = [
  {
    icon: ServerOff,
    title: 'No uploads',
    body: 'Files are read from your device by the browser and encoded in Web Workers. They never leave this tab.',
  },
  {
    icon: EyeOff,
    title: 'No tracking scripts',
    body: 'CompressKit ships without analytics or third-party trackers, and needs no account.',
  },
  {
    icon: HardDrive,
    title: 'Self-hosted engines',
    body: 'The video engine and codecs are served from this site, not a third-party CDN, and run locally.',
  },
  {
    icon: Lock,
    title: 'Metadata removed',
    body: 'Files CompressKit re-encodes drop embedded metadata such as camera details and GPS location. Files it keeps as the original are returned untouched.',
  },
];

export function Privacy() {
  return (
    <section aria-labelledby="privacy-title" id="privacy" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
      <div className="card relative overflow-hidden p-6 sm:p-12">
        <div
          className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full opacity-60 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, var(--accent-soft), transparent)' }}
          aria-hidden
        />
        <div className="relative grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
          <div>
            <p className="mb-3 font-mono text-xs tracking-[0.18em] text-accent-text uppercase">Privacy</p>
            <h2 id="privacy-title" className="text-3xl font-semibold tracking-[-0.03em] text-balance text-fg sm:text-4xl">
              Your files stay on your device.
            </h2>
            <p className="mt-4 text-pretty text-muted">
              CompressKit processes your files directly in your browser. Your images and videos are not uploaded to our servers.
            </p>
            <p className="mt-4 text-sm text-pretty text-muted">
              Your files live only in this tab's memory and are released when you remove them or close the page. The
              only things stored on your device are your theme and compression preferences.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {POINTS.map((p, i) => (
              <motion.li
                key={p.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                className="rounded-xl border border-border bg-surface-2/60 p-5"
              >
                <p.icon className="mb-3 h-5 w-5 text-accent-text" aria-hidden />
                <h3 className="text-sm font-semibold text-fg">{p.title}</h3>
                <p className="mt-1 text-sm text-muted">{p.body}</p>
              </motion.li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
