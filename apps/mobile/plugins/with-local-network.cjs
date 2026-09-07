const {
  withAndroidManifest,
  withDangerousMod,
} = require("expo/config-plugins");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

// USB adb reverse and the Android emulator can use the local development API.
// All other destinations require HTTPS, including a future hosted API.
module.exports = function withLocalNetwork(config) {
  config = withAndroidManifest(config, (value) => {
    value.modResults.manifest.application[0].$[
      "android:networkSecurityConfig"
    ] = "@xml/network_security_config";
    return value;
  });
  return withDangerousMod(config, [
    "android",
    async (value) => {
      const directory = join(
        value.modRequest.platformProjectRoot,
        "app/src/main/res/xml",
      );
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "network_security_config.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">10.0.2.2</domain>
  </domain-config>
</network-security-config>
`,
      );
      return value;
    },
  ]);
};
