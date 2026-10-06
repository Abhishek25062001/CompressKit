const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // The web app's build is served to the WebView as files; it is never part of the app's own
    // bundle. The first entry is Metro's own default, which setting this list would otherwise drop.
    blockList: [/\/__tests__\/.*/, /[/\\]webroot[/\\].*/],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
