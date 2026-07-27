import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // PERMANENT. A bundle id cannot be changed once the app has shipped
  // to either store — it is the app's identity there forever. Was
  // com.visionboard.app, which predated the Vantage name; changed
  // before first submission because after that it is immutable.
  appId: 'com.vantage.app',
  appName: 'Vantage',
  webDir: 'dist',

  // ── Server (dev live-reload) ────────────────────────────────────────────
  // Uncomment and set your LAN IP to enable live reload during dev:
  // server: {
  //   url: 'http://192.168.x.x:51414',
  //   cleartext: true,
  // },

  // ── Plugin configuration ────────────────────────────────────────────────
  plugins: {
    SplashScreen: {
      launchShowDuration: 1800,
      launchAutoHide: true,
      backgroundColor: '#0f1117',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      iosSpinnerStyle: 'large',
      spinnerColor: '#1a7a4a',
      splashFullScreen: true,
      splashImmersive: true,
    },

    StatusBar: {
      style: 'DARK',           // light text on dark background
      backgroundColor: '#0f1117',
      overlaysWebView: true,   // web content extends under status bar
    },

    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },

    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#1a7a4a',
    },
  },

  // ── Android-specific ────────────────────────────────────────────────────
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false, // set true for dev builds
  },

  // ── iOS-specific ────────────────────────────────────────────────────────
  ios: {
    contentInset: 'automatic',
    scrollEnabled: true,
  },
};

export default config;
