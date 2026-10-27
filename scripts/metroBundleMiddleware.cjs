/**
 * Avoid Android's multipart bundle downloader on Windows: large responses can
 * fail HTTP chunk parsing or arrive corrupted before Hermes compiles them.
 * https://github.com/expo/expo/issues/49111
 * Plain JavaScript responses avoid that multipart reader and retain error handling.
 */
function withAndroidBundleResponse(middleware, _server, platform = process.platform) {
  return function androidBundleResponse(req, res, next) {
    const url = new URL(req.url, 'http://metro.local');
    if (platform === 'win32' && url.pathname.endsWith('.bundle') && url.searchParams.get('platform') === 'android') {
      req.headers.accept = 'application/javascript';
    }
    return middleware(req, res, next);
  };
}

module.exports = { withAndroidBundleResponse };
