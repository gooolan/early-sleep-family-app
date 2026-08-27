import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.goolan.earlysleepfamily",
  appName: "双人早睡",
  webDir: "dist",
  android: {
    allowMixedContent: true,
  },
};

export default config;
