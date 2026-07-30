import type { ConnectionStatus } from '@/lib/realtime';

/**
 * The reconnecting strip.
 *
 * It has to be impossible to miss, because a stale board that looks live is the
 * worst failure a synchronous game can have — you would be making decisions
 * against a position that no longer exists. So this sits at the top of the
 * viewport and the action bar disables itself while it is showing.
 */
export function ConnectionStrip({ status }: { readonly status: ConnectionStatus }) {
  if (status === 'live') return null;

  return (
    <div
      role="status"
      className="flex h-8 items-center justify-center border-b border-border bg-surface text-sm text-warning"
    >
      {status === 'connecting' ? 'Connecting…' : 'Reconnecting… the board may be out of date'}
    </div>
  );
}
