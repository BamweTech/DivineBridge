const { withInfoPlist } = require('expo/config-plugins');

module.exports = function withATS(config) {
  return withInfoPlist(config, (c) => {
    const metroHost =
      process.env.DB_DEV_METRO_HOST ||
      c?.expo?.extra?.devMetroHost ||
      c?.extra?.devMetroHost ||
      'metro.divinebridge.io';

    c.modResults.NSAppTransportSecurity = {
      NSAllowsArbitraryLoads: true,
      NSAllowsLocalNetworking: true,
      NSExceptionDomains: {
        [metroHost]: {
          NSIncludesSubdomains: true,
          NSTemporaryExceptionAllowsInsecureHTTPLoads: true,
          NSTemporaryExceptionMinimumTLSVersion: 'TLSv1.0',
        },
      },
    };
    c.modResults.DBMetroHost = metroHost;
    return c;
  });
};
