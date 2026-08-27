const IS_EAS_BUILD = process.env.EAS_BUILD === 'true';
// Debug / Expo run:ios uses Apple's development APNs. Store and TestFlight
// profiles (EAS production/preview) require the production environment.
const APS_ENVIRONMENT =
  process.env.EAS_BUILD_PROFILE === 'development' || !IS_EAS_BUILD
    ? 'development'
    : 'production';

export default {
  expo: {
    name: 'Divine Bridge',
    slug: 'divinebridge',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: 'io.divinebridge.app',
    userInterfaceStyle: 'dark',
    newArchEnabled: false,
    splash: {
      backgroundColor: '#faf6ef',
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'io.divinebridge.app',
      googleServicesFile: process.env.GOOGLE_SERVICE_INFO_PLIST ?? './GoogleService-Info.plist',
      entitlements: {
        'aps-environment': APS_ENVIRONMENT,
      },
      infoPlist: {
        NSCameraUsageDescription: 'Divine Bridge uses your camera for video prayer sessions.',
        NSMicrophoneUsageDescription: 'Divine Bridge uses your microphone for audio prayer sessions.',
        NSPhotoLibraryUsageDescription: 'Divine Bridge needs access to your photos so you can share them in group chats.',
        NSPhotoLibraryAddUsageDescription: 'Divine Bridge needs permission to save shared photos and videos to your device.',
        UIBackgroundModes: ['audio', 'voip', 'fetch', 'remote-notification'],
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: true,
          NSAllowsLocalNetworking: true,
          NSExceptionDomains: {
            'metro.divinebridge.io': {
              NSIncludesSubdomains: true,
              NSTemporaryExceptionAllowsInsecureHTTPLoads: true,
              NSTemporaryExceptionMinimumTLSVersion: 'TLSv1.0',
            },
          },
        },
      },
      config: {
        googleSignIn: {
          reservedClientId: 'com.googleusercontent.apps.853408757178-lenf52a2i54vnmlg56ml13r78eproef0',
        },
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#0A0F1E',
      },
      package: 'io.divinebridge.app',
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
      permissions: [
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.INTERNET',
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.VIBRATE',
        'android.permission.RECEIVE_BOOT_COMPLETED',
        'android.permission.WAKE_LOCK',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_MEDIA_AUDIO',
      ],
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [
            {
              scheme: 'https',
              host: 'divinebridge.io',
              pathPrefix: '/join',
            },
          ],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    web: {
      bundler: 'metro',
      output: 'static',
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#faf6ef',
        },
      ],
      'expo-font',
      [
        'expo-build-properties',
        {
          ios: {
            deploymentTarget: '17.0',
          },
          android: {
            compileSdkVersion: 35,
            targetSdkVersion: 35,
            minSdkVersion: 24,
          },
        },
      ],
      [
        'expo-camera',
        {
          cameraPermission: 'Divine Bridge uses your camera for video prayer sessions.',
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: 'Divine Bridge needs access to your photos so you can share them in group chats.',
        },
      ],
      [
        'expo-media-library',
        {
          photosPermission: "Divine Bridge needs access to your library so you can choose media to share in group chats.",
          savePhotosPermission: 'Divine Bridge needs permission to save shared photos and videos to your device.',
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/notification-icon.png',
          color: '#F59E0B',
          sounds: [],
          mode: APS_ENVIRONMENT,
          enableBackgroundRemoteNotifications: true,
        },
      ],
      './plugins/withATS.js',
      '@sentry/react-native/expo',
      'expo-web-browser',
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: 'e1dd06ba-dda2-4c47-ba99-13f9c8443005',
      },
    },
    owner: 'kubwayo',
  },
};
