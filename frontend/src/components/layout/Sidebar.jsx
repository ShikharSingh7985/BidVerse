import { FilePlus2, Gavel, LayoutList, X } from 'lucide-react';
import { Link, NavLink } from 'react-router';
import { paths } from '../../paths.js';

const navigation = [
  { to: paths.auctions, label: 'Auctions', icon: LayoutList },
  { to: paths.createRfq, label: 'Create RFQ', icon: FilePlus2 },
];

export default function Sidebar({ onClose }) {
  return (
    <div className="flex h-full flex-col bg-sidebar px-4 text-white">
      <div className="flex h-[4.5rem] shrink-0 items-center justify-between border-b border-sidebar-line px-2">
        <Link to={paths.auctions} onClick={onClose} className="flex items-center gap-3 rounded-lg">
          <span className="grid size-9 place-items-center rounded-lg bg-linear-to-br from-[#8175fa] to-accent">
            <Gavel size={19} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="text-xl font-semibold tracking-tight">BidVerse</span>
        </Link>
        {onClose && (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            className="grid size-10 place-items-center rounded-lg text-sidebar-muted hover:bg-sidebar-active hover:text-white"
          >
            <X size={21} aria-hidden="true" />
          </button>
        )}
      </div>
      <nav aria-label="Main navigation" className="py-5">
        <ul className="grid gap-1">
          {navigation.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-sidebar-active text-white'
                      : 'text-sidebar-muted hover:bg-sidebar-active hover:text-white'
                  }`
                }
              >
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
