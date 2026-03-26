const { withInfoPlist } = require('expo/config-plugins');

module.exports = function withATS(config) {
  return withInfoPlist(config, (c) => {
    c.modResults.NSAppTransportSecurity = {
      NSAllowsArbitraryLoads: true,
      NSAllowsLocalNetworking: true,
    };
    return c;
  });
};
