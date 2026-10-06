import { Layers, ShieldCheck, WifiOff, Zap } from 'lucide-react';
import type { Highlight } from '../../features/toolContent';
import { IN_NATIVE_APP } from '../../utils/nativeApp';
import { HighlightGrid } from '../sections/HighlightGrid';
import { Hero } from '../sections/Hero';
import { Privacy } from '../sections/Privacy';
import { StepList } from '../sections/StepList';
import { ToolDirectory } from '../tools/ToolDirectory';

const WHY: Highlight[] = [
  {
    icon: ShieldCheck,
    title: 'Private by design',
    body: 'Files are processed by your browser and never uploaded. There is no account and no tracking script.',
  },
  {
    icon: Zap,
    title: 'Fast on your own device',
    // Remove Background is switched off for now; with it on, this ended: "…through WebCodecs, and the background remover runs on your graphics card."
    body: 'Videos are encoded by your hardware encoder through WebCodecs, right on your device.',
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
  ['Choose a tool', 'Browse the tools above by category, or search for the job you have in mind.'],
  ['Add your files', 'Drop, paste or pick them. They are read by your browser, not sent anywhere.'],
  ['Download', 'Check the result and save it. Close the tab and nothing is left behind.'],
];

export function HomePage() {
  return (
    <>
      <Hero />
      <ToolDirectory />
      {!IN_NATIVE_APP && (
        <>
          <StepList id="how-it-works" eyebrow="How it works" title="Three steps. No uploads." steps={STEPS} />
          <HighlightGrid id="features" eyebrow="Why ofctools" title="Serious tools, zero setup" items={WHY} />
          <Privacy />
        </>
      )}
    </>
  );
}
