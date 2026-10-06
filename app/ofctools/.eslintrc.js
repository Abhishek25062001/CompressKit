module.exports = {
  root: true,
  extends: '@react-native',
  // webroot holds the web app's built (minified) files; they are not this project's source.
  ignorePatterns: ['webroot/', 'android/', 'ios/', 'vendor/'],
};
