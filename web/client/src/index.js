/**
 * DivineBridge web-client bundle entry point.
 *
 * Exposes mediasoup-client's Device class (and auto-detected browser handlers)
 * as window.mediasoupClient so sfu-client.js can use it without a bundler.
 *
 * Build:  npm run build    → minified production bundle
 *         npm run build:dev → sourcemap development bundle
 * Output: ../static/js/sfu-bundle.js   (global name: mediasoupClient)
 */
'use strict';

const { Device, detectDevice } = require('mediasoup-client');

module.exports = { Device, detectDevice };
