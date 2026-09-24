import { Layers, ShieldCheck, WifiOff, Zap } from 'lucide-react';
import type { Highlight } from '../../features/toolContent';
import { HighlightGrid } from '../sections/HighlightGrid';
import { Hero } from '../sections/Hero';
import { Privacy } from '../sections/Privacy';
import { StepList } from '../sections/StepList';
import { ToolGrid } from '../tools/ToolGrid';

const WHY: Highlight[] = [
  {
    icon: ShieldCheck,
    title: 'Private by design',
    body: 'Files are processed by your browser and never uploaded. There is no account and no tracking script.',
  },
  {
    icon: Zap,
    title: 'Fast on your own device',
    body: 'Videos use your hardware encoder through WebCodecs, and the background remover runs on your graphics card.',
  },
  {
    icon: WifiOff,
    title: 'Works offline',
    body: 'Install it as an app. After your first visit the tools work without a connection, and engines are kept after first use.',
  },
  {
    icon: Layers,
    title: 'Built for batches',
    body: 'Add many files at once, process them in parallel and download everything as a single ZIP.',
  },
];

const STEPS: [string, string][] = [
  ['Choose a tool', 'Pick one below, or drop a file above to see which tools can open it.'],
  ['Add your files', 'Drop, paste or pick them. They are read by your browser, not sent anywhere.'],
  ['Download', 'Check the result and save it. Close the tab and nothing is left behind.'],
];

export function HomePage() {
  return (
    <>
      <Hero />
      <ToolGrid />
      <StepList id="how-it-works" eyebrow="How it works" title="Three steps. No uploads." steps={STEPS} />
      <HighlightGrid id="features" eyebrow="Why CompressKit" title="Serious tools, zero setup" items={WHY} />
      <Privacy />
    </>
  );
}
