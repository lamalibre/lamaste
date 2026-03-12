/**
 * Generate a macOS launchd plist for the Chisel client.
 *
 * The plist configures the Chisel client to connect to the VPS tunnel server
 * and forward all configured tunnel ports via reverse tunneling.
 *
 * @param {Array<{ port: number }>} tunnels - Current tunnel list
 * @param {string} domain - Base domain (e.g., "example.com")
 * @returns {string} Complete plist XML content
 */
export function generatePlist(tunnels, domain) {
  // XML-escape a string value (domain may contain special characters in edge cases)
  const esc = (str) =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const programArgs = [
    '        <string>/usr/local/bin/chisel</string>',
    '        <string>client</string>',
    '        <string>--tls-skip-verify</string>',
    `        <string>https://tunnel.${esc(domain)}:443</string>`,
  ];

  for (const tunnel of tunnels) {
    programArgs.push(
      `        <string>R:127.0.0.1:${tunnel.port}:127.0.0.1:${tunnel.port}</string>`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.portlama.chisel</string>

    <key>ProgramArguments</key>
    <array>
${programArgs.join('\n')}
    </array>

    <key>KeepAlive</key>
    <true/>

    <key>RunAtLoad</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/usr/local/var/log/chisel.log</string>

    <key>StandardErrorPath</key>
    <string>/usr/local/var/log/chisel.error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
`;
}
