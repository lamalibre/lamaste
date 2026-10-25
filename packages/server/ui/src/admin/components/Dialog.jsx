import { X } from 'lucide-react';

/** A modal card over the page; a click on the card never closes it. */
export function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <div
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-zinc-800 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-zinc-500 hover:text-zinc-300"
        >
          <X size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}

/** Cancel and a confirming button (red when destructive). */
export function DialogButtons({
  confirmLabel,
  destructive,
  disabled = false,
  isPending,
  onConfirm,
  onCancel,
}) {
  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={onCancel}
        className="flex-1 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:text-white"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={isPending || disabled}
        className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
          destructive ? 'bg-red-600 hover:bg-red-500' : 'bg-cyan-600 hover:bg-cyan-500'
        }`}
      >
        {isPending ? 'Please wait...' : confirmLabel}
      </button>
    </div>
  );
}

/** A confirmation: a title, a message and Cancel / confirm. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
  isPending,
}) {
  return (
    <Modal onClose={onCancel}>
      <h2 className="mb-2 text-lg font-bold text-white">{title}</h2>
      <p className="mb-6 text-sm text-zinc-400">{message}</p>
      <DialogButtons
        confirmLabel={confirmLabel}
        destructive={destructive}
        isPending={isPending}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </Modal>
  );
}
