import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, File, Folder, Trash2, Upload, Loader2, Home } from 'lucide-react';
import { useToast } from './Toast.jsx';
import { apiFetch } from '../lib/api.js';

// --- API functions ---

async function fetchFiles(siteId, dirPath) {
  const params = dirPath && dirPath !== '.' ? `?path=${encodeURIComponent(dirPath)}` : '';
  return apiFetch(`/api/sites/${siteId}/files${params}`);
}

async function uploadFiles(siteId, dirPath, files) {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  const params = dirPath && dirPath !== '.' ? `?path=${encodeURIComponent(dirPath)}` : '';
  return apiFetch(`/api/sites/${siteId}/files${params}`, {
    method: 'POST',
    body: formData,
  });
}

async function deleteFileApi(siteId, filePath) {
  return apiFetch(`/api/sites/${siteId}/files`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  });
}

// --- Helpers ---

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleString();
}

// --- Breadcrumbs ---

function Breadcrumbs({ currentPath, onNavigate }) {
  const parts = currentPath === '.' ? [] : currentPath.split('/');

  return (
    <div className="flex items-center gap-1 text-sm text-zinc-400 overflow-x-auto">
      <button
        type="button"
        onClick={() => onNavigate('.')}
        className="flex items-center gap-1 hover:text-cyan-400 shrink-0"
      >
        <Home size={14} />
      </button>
      {parts.map((part, i) => {
        const pathUpTo = parts.slice(0, i + 1).join('/');
        const isLast = i === parts.length - 1;
        return (
          <span key={pathUpTo} className="flex items-center gap-1 shrink-0">
            <ChevronRight size={12} className="text-zinc-600" />
            {isLast ? (
              <span className="text-zinc-200">{part}</span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(pathUpTo)}
                className="hover:text-cyan-400"
              >
                {part}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

// --- Delete Confirmation ---

function DeleteFileConfirmation({ fileName, onConfirm, onCancel, isPending }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="text-lg font-semibold text-white mb-2">Delete File</h3>
        <p className="text-zinc-400 text-sm mb-6">
          Are you sure you want to delete{' '}
          <span className="text-cyan-400 font-mono">{fileName}</span>?
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="flex items-center gap-2 rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            {isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Main Component ---

export default function FileBrowser({ site, onBack }) {
  const queryClient = useQueryClient();
  const addToast = useToast();
  const fileInputRef = useRef(null);

  const [currentPath, setCurrentPath] = useState('.');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const filesQuery = useQuery({
    queryKey: ['site-files', site.id, currentPath],
    queryFn: () => fetchFiles(site.id, currentPath),
    refetchInterval: 5_000,
  });

  const uploadMutation = useMutation({
    mutationFn: ({ files }) => uploadFiles(site.id, currentPath, files),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['site-files', site.id] });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      const msg = data.warning
        ? `${data.files.length} file(s) uploaded. ${data.warning}`
        : `${data.files.length} file(s) uploaded`;
      addToast(msg);
    },
    onError: (err) => {
      addToast(err.message, 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (filePath) => deleteFileApi(site.id, filePath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-files', site.id] });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      addToast('File deleted');
      setDeleteTarget(null);
    },
    onError: (err) => {
      addToast(err.message, 'error');
      setDeleteTarget(null);
    },
  });

  const handleNavigate = useCallback((path) => {
    setCurrentPath(path);
  }, []);

  const handleFileClick = useCallback((file) => {
    if (file.type === 'directory') {
      setCurrentPath(file.relativePath);
    }
  }, []);

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        uploadMutation.mutate({ files });
      }
      // Reset input so same file can be re-uploaded
      e.target.value = '';
    },
    [uploadMutation],
  );

  const files = filesQuery.data?.files || [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 mb-3"
        >
          <ArrowLeft size={14} />
          Back to Sites
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">
              {site.name}
              <span className="text-zinc-500 font-normal ml-2 text-base">Files</span>
            </h1>
            <p className="text-zinc-500 text-sm mt-1 font-mono">{site.fqdn}</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploadMutation.isPending}
              className="flex items-center gap-2 rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload size={14} />
                  Upload
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Breadcrumbs */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-t-lg px-4 py-3">
        <Breadcrumbs currentPath={currentPath} onNavigate={handleNavigate} />
      </div>

      {/* File Table */}
      {filesQuery.isLoading ? (
        <div className="bg-zinc-900 border border-t-0 border-zinc-800 rounded-b-lg p-8 text-center">
          <Loader2 size={24} className="mx-auto text-zinc-500 animate-spin" />
        </div>
      ) : filesQuery.isError ? (
        <div className="bg-zinc-900 border border-t-0 border-zinc-800 rounded-b-lg p-6">
          <p className="text-red-400 text-sm">Failed to load files</p>
        </div>
      ) : files.length === 0 ? (
        <div className="bg-zinc-900 border border-t-0 border-zinc-800 rounded-b-lg p-8 text-center">
          <p className="text-zinc-500 text-sm">This directory is empty.</p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-t-0 border-zinc-800 rounded-b-lg overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left text-zinc-500 text-xs uppercase font-semibold py-2 px-4">
                  Name
                </th>
                <th className="text-left text-zinc-500 text-xs uppercase font-semibold py-2 px-4 hidden sm:table-cell">
                  Size
                </th>
                <th className="text-left text-zinc-500 text-xs uppercase font-semibold py-2 px-4 hidden md:table-cell">
                  Modified
                </th>
                <th className="text-right text-zinc-500 text-xs uppercase font-semibold py-2 px-4 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr
                  key={file.relativePath}
                  className={`border-b border-zinc-800/50 ${
                    file.type === 'directory' ? 'cursor-pointer hover:bg-zinc-800/50' : ''
                  }`}
                  onClick={() => handleFileClick(file)}
                >
                  <td className="py-2.5 px-4 text-sm">
                    <span className="inline-flex items-center gap-2">
                      {file.type === 'directory' ? (
                        <Folder size={14} className="text-cyan-400 shrink-0" />
                      ) : (
                        <File size={14} className="text-zinc-500 shrink-0" />
                      )}
                      <span
                        className={`font-mono ${
                          file.type === 'directory' ? 'text-cyan-400' : 'text-zinc-200'
                        }`}
                      >
                        {file.name}
                      </span>
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-sm text-zinc-500 font-mono hidden sm:table-cell">
                    {file.type === 'file' ? formatBytes(file.size) : '\u2014'}
                  </td>
                  <td className="py-2.5 px-4 text-sm text-zinc-600 hidden md:table-cell">
                    {formatDate(file.modifiedAt)}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(file);
                      }}
                      className="inline-flex items-center p-1 text-zinc-600 hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <DeleteFileConfirmation
          fileName={deleteTarget.name}
          onConfirm={() => deleteMutation.mutate(deleteTarget.relativePath)}
          onCancel={() => setDeleteTarget(null)}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
