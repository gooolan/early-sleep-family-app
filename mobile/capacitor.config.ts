import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.goolan.earlysleepfamily",
  appName: "双人早睡",
  webDir: "dist",
  android: {
    allowMixedContent: true,
  },
  plugins: {
    CapacitorUpdater: {
      appReadyTimeout: 10_000,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
      autoUpdate: "off",
      responseTimeout: 60,
      statsUrl: "",
    },
  },
};

export default config;
