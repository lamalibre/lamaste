// Filter the ExperimentalWarning that node:sqlite emits on first import.
// Imported as the very first import in server/index.ts so its top-level code
// runs before any module that touches node:sqlite (currently lib/state-db.ts
// and the domain modules that go through it).
//
// `process.on('warning')` adds a listener but does not replace Node's default
// stderr printer — both fire. We drop all existing listeners (just the
// default printer at startup), then install a single filtered listener.
// Non-SQLite warnings continue to print.
process.removeAllListeners('warning');
process.on('warning', (warning: Error) => {
  if (warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message)) return;
  console.warn(warning);
});
