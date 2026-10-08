import { formatPrice, type Order } from '../api';

export function OrderList({ orders }: { orders: Order[] }) {
  if (orders.length === 0) {
    return <p className="empty">No orders yet.</p>;
  }

  return (
    <ul className="orders">
      {orders.map((order) => (
        <li key={order.id}>
          <div className="lines">
            {order.items.map((item) => (
              <span key={item.productId}>
                {item.quantity} × {item.productName}
              </span>
            ))}
          </div>
          <span className="meta">
            {formatPrice(order.totalAmountCents)} · {order.status} ·{' '}
            {new Date(order.createdAt).toLocaleTimeString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
