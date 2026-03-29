import chalk from 'chalk';

// eslint-disable-next-line no-control-regex
const ansiPattern = new RegExp('\x1b\\[[0-9;]*m', 'g');
const stripAnsi = (str) => str.replace(ansiPattern, '');

/**
 * Print an array of lines inside a bordered box with a title separator
 * after the first 3 lines.
 * @param {string[]} lines
 */
function printBox(lines) {
  const maxLineWidth = Math.max(...lines.map((l) => stripAnsi(l).length));
  const boxInnerWidth = Math.max(maxLineWidth + 2, 62);

  const border = chalk.cyan;
  const topBorder = border(`╔${'═'.repeat(boxInnerWidth)}╗`);
  const bottomBorder = border(`╚${'═'.repeat(boxInnerWidth)}╝`);
  const midBorder = border(`╠${'═'.repeat(boxInnerWidth)}╣`);

  const padLine = (line) => {
    const visibleLength = stripAnsi(line).length;
    const padding = boxInnerWidth - visibleLength;
    return `${border('║')}${line}${' '.repeat(Math.max(0, padding))}${border('║')}`;
  };

  console.log('');
  console.log(topBorder);

  // Title section (first 3 lines: empty, title, empty)
  for (let i = 0; i < 3; i++) {
    console.log(padLine(lines[i]));
  }

  // Separator
  console.log(midBorder);

  // Remaining content lines
  for (let i = 3; i < lines.length; i++) {
    console.log(padLine(lines[i]));
  }

  console.log(bottomBorder);
  console.log('');
}

/**
 * Print the post-install summary box with all the information the user needs
 * to download their client certificate, import it, and access the panel.
 *
 * In redeploy mode, prints a shorter summary since the user already has
 * their certificate and knows how to access the panel.
 *
 * @param {{ ip: string, pkiDir: string, installedVersion?: string, vendorVersion?: string }} ctx - Shared installer context.
 */
export async function printSummary(ctx) {
  const ip = ctx.ip;
  const panelUrl = `https://${ip}:9292`;

  // Redeploy mode: short summary
  if (ctx.installedVersion !== undefined) {
    const lines = [
      '',
      `   ${chalk.green.bold('Panel updated successfully!')}`,
      '',
      `   ${chalk.white.bold('Version:')} ${chalk.dim(ctx.installedVersion || 'unknown')} ${chalk.white('→')} ${chalk.cyan(ctx.vendorVersion || 'unknown')}`,
      '',
      `   ${chalk.white.bold('Panel:')}   ${chalk.cyan.underline(panelUrl)}`,
      '',
      `   ${chalk.dim('Your certificates, nginx config, and OS settings are unchanged.')}`,
      `   ${chalk.dim('Refresh your browser to see the updated panel.')}`,
      '',
    ];

    printBox(lines);
    return;
  }

  // Full install mode: complete summary with certificate instructions
  const scpCmd = `scp root@${ip}:${ctx.pkiDir}/client.p12 .`;

  const lines = [
    '',
    `   ${chalk.green.bold('Portlama installed successfully!')}`,
    '',
    `   ${chalk.white.bold('1.')} ${chalk.white('Download your client certificate:')}`,
    '',
    `      ${chalk.cyan(scpCmd)}`,
    '',
    `   ${chalk.white.bold('2.')} ${chalk.white('Import client.p12 into your browser:')}`,
    '',
    `      ${chalk.white.bold('macOS:')}  ${chalk.white('Double-click the file → Keychain Access')}`,
    `              ${chalk.white('→ select "System" keychain (not "login")')}`,
    `              ${chalk.white('→ enter the password below when prompted')}`,
    `              ${chalk.white('→ find cert in System keychain → double-click')}`,
    `              ${chalk.white('→ Trust → Always Trust')}`,
    `              ${chalk.dim('(ignore any "Local Items" import error — System is what matters)')}`,
    '',
    `      ${chalk.white.bold('Linux:')}  ${chalk.white('Chrome → Settings → Privacy & Security')}`,
    `              ${chalk.white('→ Security → Manage certificates → Import')}`,
    '',
    `      ${chalk.white.bold('Windows:')} ${chalk.white('Double-click the file → Certificate Import')}`,
    `               ${chalk.white('Wizard → enter the password below')}`,
    '',
    `   ${chalk.white.bold('3.')} ${chalk.white('Certificate password:')}`,
    '',
    `      ${chalk.yellow.bold(`cat ${ctx.pkiDir}/.p12-password`)}`,
    '',
    `   ${chalk.white.bold('4.')} ${chalk.white('Open the Portlama panel:')}`,
    '',
    `      ${chalk.cyan.underline(panelUrl)}`,
    '',
    `      ${chalk.white('(Your browser will warn about the self-signed cert.')}`,
    `       ${chalk.white('This is expected — click "Advanced" → "Proceed")')}`,
    '',
    `   ${chalk.white.bold('5.')} ${chalk.white('Bind admin cert to macOS Keychain')} ${chalk.yellow('(recommended)')}`,
    `      ${chalk.dim('Makes the private key non-extractable — the P12 file')}`,
    `      ${chalk.dim('and password can no longer grant panel access.')}`,
    '',
    `      ${chalk.cyan('npx @lamalibre/install-portlama-admin')}`,
    '',
    `      ${chalk.dim('Run on your Mac after importing the P12 above.')}`,
    `      ${chalk.dim('One-way operation — recovery requires server console.')}`,
    '',
    `   ${chalk.green('You can now disconnect from SSH.')}`,
    `   ${chalk.green('The panel is running and accessible from your browser.')}`,
    '',
  ];

  printBox(lines);
}
