import { Monitor, Moon, Sun } from 'lucide-react';
import { SegmentedControl } from '../common/SegmentedControl';
import { useThemeStore, type ThemePreference } from '../../store/themeStore';

export function ThemeToggle() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  return (
    <SegmentedControl<ThemePreference>
      label="Color theme"
      size="sm"
      value={preference}
      onChange={setPreference}
      segments={[
        { value: 'light', label: <Sun className="h-3.5 w-3.5" />, ariaLabel: 'Light theme' },
        { value: 'dark', label: <Moon className="h-3.5 w-3.5" />, ariaLabel: 'Dark theme' },
        { value: 'system', label: <Monitor className="h-3.5 w-3.5" />, ariaLabel: 'Use system theme' },
      ]}
    />
  );
}
