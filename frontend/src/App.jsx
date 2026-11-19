import { ArrowLeft, SearchX } from 'lucide-react';
import { createBrowserRouter, Link, Navigate } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import AuctionsPage from './auctions/AuctionsPage.jsx';
import AuctionDetailsPage from './auctions/details/AuctionDetailsPage.jsx';
import PagePlaceholder from './components/PagePlaceholder.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import { paths } from './paths.js';
import CreateRfqPage from './rfqs/CreateRfqPage.jsx';

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to={paths.auctions} replace /> },
      {
        path: paths.auctions,
        handle: { label: 'Auctions' },
        element: <AuctionsPage />,
      },
      {
        path: paths.createRfq,
        handle: { label: 'Create RFQ', auctionParent: true, hideCreateAction: true },
        element: <CreateRfqPage />,
      },
      {
        path: paths.auctionDetails,
        handle: { label: 'Auction details', auctionParent: true },
        element: <AuctionDetailsPage />,
      },
      {
        path: '*',
        handle: { label: 'Page not found', auctionParent: true },
        element: (
          <PagePlaceholder title="Page not found" icon={SearchX} message="Check the address or return to the auction list.">
            <Link to={paths.auctions} className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline">
              <ArrowLeft size={16} aria-hidden="true" />
              Back to auctions
            </Link>
          </PagePlaceholder>
        ),
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
