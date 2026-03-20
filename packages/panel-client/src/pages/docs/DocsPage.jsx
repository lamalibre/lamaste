import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { BookOpen, ChevronRight, ChevronLeft, Menu, X, List } from 'lucide-react';

// Custom renderer: add IDs to headings for anchor links
const renderer = new marked.Renderer();
renderer.heading = ({ text, depth }) => {
  const id = text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `<h${depth} id="${id}">${text}</h${depth}>`;
};

marked.setOptions({ renderer });

function extractToc(markdown) {
  const headings = [];
  const regex = /^(#{2,3})\s+(.+)$/gm;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const depth = match[1].length;
    const text = match[2].replace(/`([^`]+)`/g, '$1');
    const id = text
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    headings.push({ depth, text, id });
  }
  return headings;
}

function DocsSidebar({ index, currentSlug, sidebarOpen, onClose }) {
  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={onClose} />
          <div className="relative flex h-screen w-72 flex-col overflow-y-auto bg-zinc-900 border-r border-zinc-800">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-4">
              <span className="text-sm font-semibold text-zinc-300">Documentation</span>
              <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <SidebarNav index={index} currentSlug={currentSlug} onLinkClick={onClose} />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <div className="sticky top-0 hidden h-screen w-72 flex-shrink-0 flex-col overflow-y-auto border-r border-zinc-800 bg-zinc-900/50 lg:flex">
        <div className="border-b border-zinc-800 px-4 py-4">
          <Link
            to="/docs"
            className="text-sm font-semibold text-zinc-300 hover:text-cyan-400 flex items-center gap-2"
          >
            <BookOpen size={14} className="text-cyan-400" />
            Documentation
          </Link>
        </div>
        <SidebarNav index={index} currentSlug={currentSlug} />
      </div>
    </>
  );
}

function SidebarNav({ index, currentSlug, onLinkClick }) {
  return (
    <nav className="flex-1 px-3 py-4 space-y-5">
      {index.sections.map((section) => (
        <div key={section.title}>
          <h3 className="px-2 mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {section.title}
          </h3>
          <ul className="space-y-0.5">
            {section.pages.map((page) => (
              <li key={page.slug}>
                <Link
                  to={`/docs/${page.slug}`}
                  onClick={onLinkClick}
                  className={[
                    'block rounded-md px-2 py-1.5 text-sm transition-colors',
                    currentSlug === page.slug
                      ? 'text-cyan-400 bg-zinc-800/50 font-medium'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/30',
                  ].join(' ')}
                >
                  {page.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function TableOfContents({ toc, activeId }) {
  if (toc.length === 0) return null;

  return (
    <div className="sticky top-6 hidden xl:block w-56 flex-shrink-0">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
        <List size={12} />
        On this page
      </h4>
      <ul className="space-y-1 border-l border-zinc-800">
        {toc.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className={[
                'block border-l-2 -ml-px text-xs transition-colors py-1',
                heading.depth === 3 ? 'pl-5' : 'pl-3',
                activeId === heading.id
                  ? 'border-cyan-400 text-cyan-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:border-zinc-600',
              ].join(' ')}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PageNavigation({ prevPage, nextPage }) {
  if (!prevPage && !nextPage) return null;

  return (
    <div className="mt-12 flex items-stretch gap-4 border-t border-zinc-800 pt-6">
      {prevPage ? (
        <Link
          to={`/docs/${prevPage.slug}`}
          className="flex-1 group rounded-lg border border-zinc-800 p-4 hover:border-zinc-700 transition-colors"
        >
          <span className="text-xs text-zinc-500 flex items-center gap-1">
            <ChevronLeft size={12} />
            Previous
          </span>
          <span className="mt-1 block text-sm text-zinc-300 group-hover:text-cyan-400 transition-colors">
            {prevPage.title}
          </span>
        </Link>
      ) : (
        <div className="flex-1" />
      )}
      {nextPage ? (
        <Link
          to={`/docs/${nextPage.slug}`}
          className="flex-1 group rounded-lg border border-zinc-800 p-4 hover:border-zinc-700 transition-colors text-right"
        >
          <span className="text-xs text-zinc-500 flex items-center justify-end gap-1">
            Next
            <ChevronRight size={12} />
          </span>
          <span className="mt-1 block text-sm text-zinc-300 group-hover:text-cyan-400 transition-colors">
            {nextPage.title}
          </span>
        </Link>
      ) : (
        <div className="flex-1" />
      )}
    </div>
  );
}

export default function DocsPage() {
  const { '*': slug } = useParams();
  const navigate = useNavigate();
  const contentRef = useRef(null);

  const [index, setIndex] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState('');

  // Reducer for markdown fetch state — avoids synchronous setState in effects
  const [docState, dispatchDoc] = useReducer(
    (state, action) => {
      switch (action.type) {
        case 'fetch':
          return { content: '', loading: true, error: null };
        case 'success':
          return { content: action.content, loading: false, error: null };
        case 'error':
          return { content: '', loading: false, error: action.error };
        default:
          return state;
      }
    },
    { content: '', loading: true, error: null },
  );
  const { content, loading, error } = docState;

  // Load navigation index
  useEffect(() => {
    fetch('/docs/_index.json')
      .then((r) => r.json())
      .then(setIndex)
      .catch((err) => dispatchDoc({ type: 'error', error: `Failed to load docs index: ${err.message}` }));
  }, []);

  // Flatten all pages for prev/next navigation
  const allPages = useMemo(() => {
    if (!index) return [];
    return index.sections.flatMap((s) => s.pages);
  }, [index]);

  const currentSlug = slug || allPages[0]?.slug;

  // Redirect to first page if no slug
  useEffect(() => {
    if (!slug && allPages.length > 0) {
      navigate(`/docs/${allPages[0].slug}`, { replace: true });
    }
  }, [slug, allPages, navigate]);

  // Find current page and neighbors
  const currentPage = useMemo(
    () => allPages.find((p) => p.slug === currentSlug),
    [allPages, currentSlug],
  );
  const currentIndex = allPages.indexOf(currentPage);
  const prevPage = currentIndex > 0 ? allPages[currentIndex - 1] : null;
  const nextPage = currentIndex < allPages.length - 1 ? allPages[currentIndex + 1] : null;

  // Find current section for breadcrumb
  const currentSection = useMemo(() => {
    if (!index || !currentPage) return null;
    return index.sections.find((s) => s.pages.some((p) => p.slug === currentSlug));
  }, [index, currentPage, currentSlug]);

  // Load markdown content when slug changes
  useEffect(() => {
    if (!currentPage) return;
    let cancelled = false;

    dispatchDoc({ type: 'fetch' });

    fetch(`/docs/${currentPage.file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Document not found (${r.status})`);
        return r.text();
      })
      .then((md) => {
        if (!cancelled) {
          dispatchDoc({ type: 'success', content: md });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          dispatchDoc({ type: 'error', error: err.message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentPage]);

  // Scroll to top when page changes
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [currentSlug]);

  // Extract table of contents
  const toc = useMemo(() => extractToc(content), [content]);

  // Render markdown
  const html = useMemo(() => (content ? marked.parse(content) : ''), [content]);

  // Scroll spy for table of contents
  const handleScroll = useCallback(() => {
    if (!contentRef.current) return;
    const headings = contentRef.current.querySelectorAll('h2[id], h3[id]');
    let current = '';
    for (const heading of headings) {
      const rect = heading.getBoundingClientRect();
      if (rect.top <= 100) {
        current = heading.id;
      }
    }
    setActiveHeadingId(current);
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  if (!index) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="text-zinc-500 text-sm">Loading documentation...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-950">
      <DocsSidebar
        index={index}
        currentSlug={currentSlug}
        sidebarOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div ref={contentRef} className="flex-1 overflow-y-auto">
        {/* Mobile docs sidebar toggle */}
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="sticky top-4 left-4 z-40 rounded-md bg-zinc-900 border border-zinc-800 p-2 text-zinc-400 hover:text-zinc-100 lg:hidden m-4"
          aria-label="Open docs navigation"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="flex gap-8 max-w-5xl mx-auto px-6 py-8 lg:px-8">
          <div className="flex-1 min-w-0">
            {/* Breadcrumb */}
            {currentSection && currentPage && (
              <div className="mb-6 flex items-center gap-2 text-xs text-zinc-500">
                <Link to="/docs" className="hover:text-zinc-300">
                  Docs
                </Link>
                <ChevronRight size={10} />
                <span>{currentSection.title}</span>
                <ChevronRight size={10} />
                <span className="text-zinc-400">{currentPage.title}</span>
              </div>
            )}

            {/* Content */}
            {loading && <div className="text-zinc-500 text-sm py-12">Loading...</div>}

            {error && (
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-6 text-sm text-yellow-400">
                <p className="font-semibold mb-2">Page Not Available</p>
                <p className="text-yellow-500/80">{error}</p>
                <Link
                  to="/docs/what-is-portlama"
                  className="mt-4 inline-block text-cyan-400 hover:underline"
                >
                  Go to Introduction
                </Link>
              </div>
            )}

            {!loading && !error && (
              <>
                <article
                  className="prose prose-invert prose-zinc max-w-none
                    prose-headings:font-mono prose-headings:scroll-mt-20
                    prose-a:text-cyan-400 prose-a:no-underline hover:prose-a:underline
                    prose-code:text-cyan-300 prose-code:before:content-none prose-code:after:content-none
                    prose-code:rounded prose-code:bg-zinc-800 prose-code:px-1.5 prose-code:py-0.5
                    prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800
                    prose-blockquote:border-cyan-400/30 prose-blockquote:text-zinc-400
                    prose-strong:text-zinc-200
                    prose-th:text-zinc-300 prose-td:text-zinc-400
                    prose-hr:border-zinc-800
                    prose-img:rounded-lg"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
                />
                <PageNavigation prevPage={prevPage} nextPage={nextPage} />
              </>
            )}
          </div>

          <TableOfContents toc={toc} activeId={activeHeadingId} />
        </div>
      </div>
    </div>
  );
}
