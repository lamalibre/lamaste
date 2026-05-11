export default function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="flex flex-col items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-400" />
        <p className="mt-4 text-sm text-zinc-500">Connecting to panel server...</p>
      </div>
    </div>
  );
}
