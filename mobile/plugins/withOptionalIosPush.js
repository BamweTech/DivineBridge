const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

/**
 * Personal Apple teams cannot provision Push Notifications. When `enabled` is
 * false, strip `aps-environment` and `remote-notification` after other plugins
 * (including expo-notifications) have added them.
 */
module.exports = function withOptionalIosPush(config, { enabled = false } = {}) {
  if (enabled) return config;

  config = withEntitlementsPlist(config, (c) => {
    delete c.modResults['aps-environment'];
    return c;
  });

  config = withInfoPlist(config, (c) => {
    const modes = c.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) {
      c.modResults.UIBackgroundModes = modes.filter((m) => m !== 'remote-notification');
    }
    return c;
  });

  return config;
};
