import type { Reservation } from '../api';
import { formatClock, useCountdown } from '../hooks/useCountdown';

type Props = {
  reservation: Reservation;
  productName: string;
  busy: boolean;
  onCheckout: () => void;
  onRelease: () => void;
  onExpire: () => void;
};

/**
 * The live 5-minute hold.
 *
 * The countdown is display only. It runs off `expiresAt`, the absolute
 * timestamp the server returned, and when it reaches zero it tells the parent
 * rather than deciding anything itself. Redis is the real clock: the hold
 * expires there whether or not this tab is open.
 */
export function ReservationPanel({
  reservation,
  productName,
  busy,
  onCheckout,
  onRelease,
  onExpire,
}: Props) {
  const secondsLeft = useCountdown(reservation.expiresAt, onExpire);
  const expired = secondsLeft <= 0;

  return (
    <aside className="reservation">
      <div>
        <strong>
          {reservation.quantity} × {productName}
        </strong>
        <span className="timer">
          {expired ? 'Hold expired' : `Reserved for ${formatClock(secondsLeft)}`}
        </span>
      </div>
      <div className="actions">
        <button type="button" className="ghost" disabled={busy} onClick={onRelease}>
          Release
        </button>
        <button type="button" disabled={busy || expired} onClick={onCheckout}>
          {busy ? 'Placing order…' : 'Buy now'}
        </button>
      </div>
    </aside>
  );
}
