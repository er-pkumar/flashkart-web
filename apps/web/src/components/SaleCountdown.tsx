import { formatClock, useCountdown } from '../hooks/useCountdown';

/** Time left in the flash sale itself, separate from any reservation hold. */
export function SaleCountdown({ endsAt }: { endsAt: string | null }) {
  const secondsLeft = useCountdown(endsAt);

  if (!endsAt) return <small className="countdown">Open sale</small>;
  if (secondsLeft <= 0) return <small className="countdown ended">Sale ended</small>;

  return <small className="countdown">Ends in {formatClock(secondsLeft)}</small>;
}
