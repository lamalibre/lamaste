// Filter the ExperimentalWarning that node:sqlite emits on first import.
// Imported as the very first import in index.js so its top-level code runs
// before any module that touches node:sqlite (currently lib/enrollment.js).
//
// `process.on('warning')` adds a listener but does not replace Node's default
// stderr printer — both fire. We drop all existing listeners (just the
// default printer at startup), then install a single filtered listener.
// Non-SQLite warnings continue to print.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message)) return;
  console.warn(warning);
});
