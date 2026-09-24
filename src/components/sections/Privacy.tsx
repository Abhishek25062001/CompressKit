import { motion } from 'framer-motion';
import { ArrowRight, EyeOff, HardDrive, Lock, ServerOff, ShieldCheck } from 'lucide-react';
import { Link } from '../common/Link';

const POINTS = [
  {
    icon: ServerOff,
    title: 'No uploads',
    body: 'Files are read by your browser and processed on your device. They never leave this tab.',
  },
  {
    icon: EyeOff,
    title: 'No tracking scripts',
    body: 'CompressKit ships without analytics or third-party trackers, and needs no account.',
  },
  {
    icon: HardDrive,
    title: 'Self-hosted engines',
    body: 'The video engine, the AI model and the codecs are served from this site, not a third-party CDN, and run locally.',
  },
  {
    icon: Lock,
    title: 'Hidden details removed',
    body: 'Re-encoded files drop camera details and GPS location. The Remove location tool strips them from any photo or video without re-encoding it.',
  },
];

export function Privacy() {
  return (
    <section aria-labelledby="privacy-title" id="privacy" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28">
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
              Every tool processes your files directly in your browser. Your photos, videos and documents are not uploaded to any server.
            </p>
            <p className="mt-4 text-sm text-pretty text-muted">
              Your files live only in this tab's memory and are released when you remove them or close the page. The
              only things kept on your device are your theme, your tool settings, and the engines and AI model once
              they are downloaded.
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

/** One line on each tool page, linking to the full privacy section on the home page. */
export function PrivacyNote() {
  return (
    <section aria-label="Privacy" className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-24">
      <div className="card flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="font-semibold text-fg">Your files never leave your device</p>
            <p className="text-sm text-muted">No uploads, no account and no tracking. Everything runs in this browser tab.</p>
          </div>
        </div>
        <Link to="/#privacy" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg text-sm font-medium text-accent-text hover:underline">
          How privacy works <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
