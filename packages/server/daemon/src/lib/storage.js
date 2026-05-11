/**
 * Shim — storage registry + credential encryption now lives in
 * `@lamalibre/lamaste/server`. This file preserves the daemon-local API
 * (no dataDir parameter) by resolving the data dir from env/config and
 * forwarding to the core library.
 */

import {
  encryptCredential as encryptCredentialCore,
  decryptCredential as decryptCredentialCore,
  registerStorageServer as registerStorageServerCore,
  removeStorageServer as removeStorageServerCore,
  listStorageServers as listStorageServersCore,
  bindPluginStorage as bindPluginStorageCore,
  unbindPluginStorage as unbindPluginStorageCore,
  listBindings as listBindingsCore,
  getBinding as getBindingCore,
  getPluginStorageConfig as getPluginStorageConfigCore,
} from '@lamalibre/lamaste/server';

function dataDir() {
  return process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';
}

export function encryptCredential(plaintext) {
  return encryptCredentialCore(plaintext, dataDir());
}

export function decryptCredential(packed) {
  return decryptCredentialCore(packed, dataDir());
}

export function registerStorageServer(input) {
  return registerStorageServerCore(dataDir(), input);
}

export function removeStorageServer(id) {
  return removeStorageServerCore(dataDir(), id);
}

export function listStorageServers() {
  return listStorageServersCore(dataDir());
}

export function bindPluginStorage(pluginName, storageServerId) {
  return bindPluginStorageCore(dataDir(), pluginName, storageServerId);
}

export function unbindPluginStorage(pluginName) {
  return unbindPluginStorageCore(dataDir(), pluginName);
}

export function listBindings() {
  return listBindingsCore(dataDir());
}

export function getBinding(pluginName) {
  return getBindingCore(dataDir(), pluginName);
}

export function getPluginStorageConfig(pluginName) {
  return getPluginStorageConfigCore(dataDir(), pluginName);
}
