import { ChevronRight, Menu, Plus } from 'lucide-react';
import { Link, useMatches } from 'react-router';
import { paths } from '../../paths.js';
import { primaryButtonClass } from '../buttonStyles.js';

export default function AppHeader({ menuOpen, onOpenMenu }) {
  const { label = 'Auctions', auctionParent, hideCreateAction } = useMatches().at(-1)?.handle ?? {};

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white">
      <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between gap-3 px-4 sm:px-8 lg:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-label="Open navigation"
            aria-controls="mobile-navigation"
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            onClick={onOpenMenu}
            className="grid size-10 shrink-0 place-items-center rounded-lg border border-line text-muted hover:bg-canvas hover:text-ink lg:hidden"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <Link to={paths.auctions} className="rounded-sm text-lg font-semibold tracking-tight sm:hidden">
            BidVerse
          </Link>
          <nav aria-label="Breadcrumb" className="hidden min-w-0 sm:block">
            <ol className="flex items-center gap-2.5 text-sm">
              {auctionParent && (
                <li className="flex items-center gap-2.5">
                  <Link to={paths.auctions} className="rounded-sm text-muted hover:text-ink">Auctions</Link>
                  <ChevronRight size={15} className="text-muted" aria-hidden="true" />
                </li>
              )}
              <li aria-current="page" className="truncate font-semibold text-ink">{label}</li>
            </ol>
          </nav>
        </div>
        {!hideCreateAction && (
          <Link
            to={paths.createRfq}
            className={`${primaryButtonClass} shrink-0 whitespace-nowrap`}
          >
            <Plus size={17} aria-hidden="true" />
            New RFQ
          </Link>
        )}
      </div>
    </header>
  );
}
