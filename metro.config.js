const { withAndroidBundleResponse } = require('./scripts/metroBundleMiddleware.cjs');

module.exports = {
  server: {
    enhanceMiddleware: withAndroidBundleResponse,
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};
