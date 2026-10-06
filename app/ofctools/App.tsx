import { useState } from 'react';
import { StatusBar, StyleSheet, useColorScheme, View } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { paletteFor } from './src/theme';
import { StartupScreen } from './src/ui/StartupScreen';
import { useWebSite } from './src/web/useWebSite';
import { WebApp } from './src/web/WebApp';

function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

/**
 * The frame around the tools: it keeps them clear of the status bar, notch and gesture area, and
 * colors those areas like the page inside. The page reports its own theme, because it has its own
 * light/dark switch; until it does, the phone's setting is used.
 */
function Shell() {
  const insets = useSafeAreaInsets();
  const systemDark = useColorScheme() === 'dark';
  const [pageDark, setPageDark] = useState<boolean | null>(null);
  const dark = pageDark ?? systemDark;
  const palette = paletteFor(dark);
  const { state, retry } = useWebSite();

  return (
    <View
      style={[
        styles.shell,
        {
          backgroundColor: palette.bg,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      {state.status === 'ready' ? (
        // A new address means a new server, so the page is loaded afresh.
        <WebApp
          key={state.site.origin}
          site={state.site}
          palette={palette}
          onThemeChange={setPageDark}
          onRestart={retry}
        />
      ) : (
        <StartupScreen palette={palette} state={state} onRetry={retry} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
});

export default App;
