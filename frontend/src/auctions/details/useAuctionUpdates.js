import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getAuctionUpdatesUrl, refreshAuctionQueries } from '../../api/rfqs.js';

const connectTimeout = 10_000;
const heartbeatTimeout = 45_000;
const maxReconnectDelay = 30_000;

export default function useAuctionUpdates(rfqId, setConnectedRfqId) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!rfqId || typeof WebSocket !== 'function') return;

    let socket;
    let watchdog;
    let reconnectTimer;
    let attempts = 0;
    let disposed = false;

    function retry() {
      const delay = Math.min(1000 * 2 ** attempts, maxReconnectDelay);
      attempts = Math.min(attempts + 1, 5);
      reconnectTimer = setTimeout(connect, delay);
    }

    function fail(connection) {
      if (disposed || socket !== connection) return;
      socket = undefined;
      clearTimeout(watchdog);
      setConnectedRfqId(null);
      connection.close();
      retry();
    }

    function startWatchdog(connection, timeout) {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => fail(connection), timeout);
    }

    function connect() {
      if (disposed) return;
      let connection;
      try {
        connection = new WebSocket(getAuctionUpdatesUrl(rfqId));
      } catch {
        retry();
        return;
      }

      socket = connection;
      startWatchdog(connection, connectTimeout);
      connection.addEventListener('open', () => {
        if (disposed || socket !== connection) return;
        attempts = 0;
        setConnectedRfqId(rfqId);
        startWatchdog(connection, heartbeatTimeout);
        // Catch up on commits that happened before or between connections.
        void refreshAuctionQueries(queryClient, rfqId);
      });
      connection.addEventListener('message', ({ data }) => {
        if (disposed || socket !== connection) return;
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          return;
        }
        if (event?.rfq_id !== rfqId || !['heartbeat', 'auction_updated'].includes(event.type)) return;
        startWatchdog(connection, heartbeatTimeout);
        if (event.type === 'auction_updated') void refreshAuctionQueries(queryClient, rfqId);
      });
      connection.addEventListener('error', () => fail(connection));
      connection.addEventListener('close', () => fail(connection));
    }

    connect();
    return () => {
      disposed = true;
      clearTimeout(watchdog);
      clearTimeout(reconnectTimer);
      socket?.close();
      setConnectedRfqId((current) => current === rfqId ? null : current);
    };
  }, [rfqId, queryClient, setConnectedRfqId]);
}
