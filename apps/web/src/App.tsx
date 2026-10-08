import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type Order, type Product, type Reservation, type User } from './api';
import { OrderList } from './components/OrderList';
import { ProductCard } from './components/ProductCard';
import { ReservationPanel } from './components/ReservationPanel';

/** A reservation plus the idempotency key minted for its one allowed checkout. */
type ActiveHold = { reservation: Reservation; idempotencyKey: string };

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [hold, setHold] = useState<ActiveHold | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const [nextUser, nextProducts, nextOrders] = await Promise.all([
      api.me(),
      api.listProducts(),
      api.listOrders(),
    ]);
    setUser(nextUser);
    setProducts(nextProducts);
    setOrders(nextOrders);
  }, []);

  useEffect(() => {
    refresh().catch((error: Error) => setNotice({ tone: 'error', text: error.message }));
    // Stock moves under us during a flash sale, so keep the view close to live.
    const timer = setInterval(() => {
      api.listProducts().then(setProducts).catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const handleError = useCallback(
    (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      setNotice({
        tone: 'error',
        text: apiError?.message ?? (error as Error).message ?? 'Something went wrong',
      });
      // These codes mean the hold is gone; drop it so the UI stays honest.
      if (apiError && ['RESERVATION_EXPIRED', 'RESERVATION_ALREADY_USED', 'SOLD_OUT'].includes(apiError.code)) {
        setHold(null);
      }
      refresh().catch(() => undefined);
    },
    [refresh],
  );

  const addToCart = useCallback(
    async (productId: string, quantity: number) => {
      setBusy(true);
      setNotice(null);
      try {
        const reservation = await api.reserve(productId, quantity);
        setHold({ reservation, idempotencyKey: crypto.randomUUID() });
        setNotice({ tone: 'info', text: 'Units held. Complete checkout before the timer runs out.' });
        setProducts(await api.listProducts());
      } catch (error) {
        handleError(error);
      } finally {
        setBusy(false);
      }
    },
    [handleError],
  );

  const checkout = useCallback(async () => {
    if (!hold) return;
    setBusy(true);
    setNotice(null);
    try {
      const { replayed } = await api.checkout(hold.reservation.reservationId, hold.idempotencyKey);
      setHold(null);
      setNotice({
        tone: 'info',
        text: replayed ? 'Order already placed — returned the original.' : 'Order confirmed.',
      });
      await refresh();
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }, [handleError, hold, refresh]);

  const release = useCallback(async () => {
    if (!hold) return;
    setBusy(true);
    try {
      await api.release(hold.reservation.reservationId);
      setHold(null);
      setNotice({ tone: 'info', text: 'Hold released.' });
      await refresh();
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }, [handleError, hold, refresh]);

  const expire = useCallback(() => {
    setHold(null);
    setNotice({ tone: 'error', text: 'Your hold expired and the units went back on sale.' });
    refresh().catch(() => undefined);
  }, [refresh]);

  const heldProductName =
    products.find((product) => product.id === hold?.reservation.productId)?.name ?? 'item';

  return (
    <div className="page">
      <header className="masthead">
        <h1>Flashkart</h1>
        <span className="user">{user?.name ?? "connecting…"}</span>
      </header>

      {notice && <p className={`notice ${notice.tone}`}>{notice.text}</p>}

      {hold && (
        <ReservationPanel
          reservation={hold.reservation}
          productName={heldProductName}
          busy={busy}
          onCheckout={checkout}
          onRelease={release}
          onExpire={expire}
        />
      )}

      <section>
        <h2>Flash sale</h2>
        <div className="grid">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              disabled={busy || hold !== null}
              onAddToCart={addToCart}
            />
          ))}
        </div>
        {products.length === 0 && <p className="empty">No products. Run `npm run seed`.</p>}
      </section>

      <section>
        <h2>Your orders</h2>
        <OrderList orders={orders} />
      </section>
    </div>
  );
}
