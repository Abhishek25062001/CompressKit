import { MotionConfig } from 'framer-motion';
import { useEffect } from 'react';
import { Notices } from './components/common/Notices';
import { Footer } from './components/layout/Footer';
import { Header } from './components/layout/Header';
import { Features } from './components/sections/Features';
import { Hero } from './components/sections/Hero';
import { HowItWorks } from './components/sections/HowItWorks';
import { Privacy } from './components/sections/Privacy';
import { Workspace } from './components/workspace/Workspace';
import { useApplyTheme } from './hooks/useApplyTheme';
import { useCapabilitiesStore } from './store/capabilitiesStore';

export default function App() {
  useApplyTheme();
  const detect = useCapabilitiesStore((s) => s.detect);

  useEffect(() => {
    void detect();
    // Dropping a file outside the drop zone must not navigate away from the app.
    const prevent = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, [detect]);

  return (
    <MotionConfig reducedMotion="user">
      <a
        href="#compress"
        className="sr-only z-50 rounded-lg bg-surface px-4 py-2 text-sm font-medium text-fg shadow focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to compressor
      </a>
      <Header />
      <main>
        <Hero />
        <Workspace />
        <Features />
        <HowItWorks />
        <Privacy />
      </main>
      <Footer />
      <Notices />
    </MotionConfig>
  );
}
