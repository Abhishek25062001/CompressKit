import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Palette } from '../theme';
import type { WebSiteState } from '../web/useWebSite';

interface StartupScreenProps {
  palette: Palette;
  state: Exclude<WebSiteState, { status: 'ready' }>;
  onRetry: () => void;
}

function progressText(state: Extract<WebSiteState, { status: 'starting' }>): {
  title: string;
  detail: string;
} {
  if (state.stage === 'unpacking') {
    return {
      title: 'Setting up the tools',
      detail: 'This happens once after the app is installed or updated.',
    };
  }
  return { title: 'Getting the tools ready', detail: '' };
}

function errorText(state: Extract<WebSiteState, { status: 'error' }>): {
  title: string;
  detail: string;
} {
  if (state.missingBuild) {
    return {
      title: 'The tools are missing from this build',
      detail:
        'On your computer, run "npm run web:sync" in the app folder, then build and install the app again.',
    };
  }
  return { title: 'The tools could not start', detail: state.message };
}

/** Shown while the local web server starts, and when it cannot. */
export function StartupScreen({ palette, state, onRetry }: StartupScreenProps) {
  const failed = state.status === 'error';
  const { title, detail } = failed ? errorText(state) : progressText(state);
  return (
    <View
      style={[styles.screen, { backgroundColor: palette.bg }]}
      accessibilityLiveRegion="polite"
    >
      {!failed && <ActivityIndicator size="large" color={palette.accent} />}
      <Text style={[styles.title, { color: palette.fg }]}>{title}</Text>
      {detail !== '' && (
        <Text style={[styles.detail, { color: palette.muted }]}>{detail}</Text>
      )}
      {failed && (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: palette.accent, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[styles.buttonLabel, { color: palette.accentFg }]}>
            Try again
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  detail: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  button: {
    marginTop: 8,
    minHeight: 48,
    paddingHorizontal: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
});
