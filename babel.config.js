// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      "expo-router/babel",
      // ...any other plugins...
      "react-native-reanimated/plugin", // ✅ MUST be last
    ],
  };
};
