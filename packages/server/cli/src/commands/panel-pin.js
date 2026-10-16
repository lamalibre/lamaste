/**
 * lamaste-server panel-pin — the public-key pin of the panel's IP listener.
 *
 * The panel's IP address (`https://<ip>:9292`) is served with a self-signed
 * certificate, so the clients that reach it there pin its public key the
 * first time they connect: `lamaste-agent setup` (and `panel reset-pin`),
 * and the desktop app, which shows the pin with the server. This prints the
 * pin from the certificate itself, read on the relay — compare the two to
 * know a client pinned the panel and not something in between.
 */

import chalk from 'chalk';
import { emit } from '../ndjson.js';
import { readPanelIdentity } from '../panel-identity.js';

/**
 * @param {{ json: boolean }} options
 */
export async function runPanelPin({ json }) {
  const identity = await readPanelIdentity();
  const pin = `sha256//${identity.pin}`;
  if (json) {
    emit({
      pin,
      address: identity.address,
      port: identity.port,
      certificate: identity.certPath,
    });
    return;
  }
  console.log(
    `${chalk.bold('Panel:')}       https://${identity.address}:${identity.port} ${chalk.dim(`(${identity.certPath})`)}`,
  );
  console.log(`${chalk.bold('Key pin:')}     ${chalk.cyan(pin)}`);
  console.log(
    chalk.dim(
      'Agents and the desktop app pin this key the first time they connect; the pin they show must be this one.',
    ),
  );
}
