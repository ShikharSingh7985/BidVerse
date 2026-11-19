import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import AppHeader from './AppHeader.jsx';
import Sidebar from './Sidebar.jsx';

export default function AppLayout() {
  const dialogRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  function closeMenu() {
    dialogRef.current?.close();
  }

  function openMenu() {
    dialogRef.current.showModal();
    setMenuOpen(true);
  }

  useEffect(() => {
    closeMenu();
  }, [pathname]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 64rem)');
    function closeOnDesktop(event) {
      if (event.matches) closeMenu();
    }
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <a
        href="#main-content"
        className="fixed inset-s-4 top-3 z-50 -translate-y-24 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-ink focus:translate-y-0"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh lg:block">
        <Sidebar />
      </aside>
      <dialog
        ref={dialogRef}
        id="mobile-navigation"
        aria-label="Navigation"
        onClose={() => setMenuOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeMenu();
        }}
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(18rem,calc(100vw_-_2rem))] max-w-none overflow-y-auto overscroll-contain bg-sidebar p-0 shadow-2xl backdrop:bg-slate-950/50"
      >
        <Sidebar onClose={closeMenu} />
      </dialog>
      <div className="min-w-0">
        <AppHeader menuOpen={menuOpen} onOpenMenu={openMenu} />
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 pt-8 pb-12 outline-none sm:px-8 sm:pt-10 lg:px-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
