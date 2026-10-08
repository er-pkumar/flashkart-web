import { useState } from 'react';
import { formatPrice, type Product } from '../api';
import { SaleCountdown } from './SaleCountdown';

type Props = {
  product: Product;
  disabled: boolean;
  onAddToCart: (productId: string, quantity: number) => void;
};

const MAX_PER_ORDER = 5;

/**
 * One flash-sale product: price, remaining stock, sale countdown and the button
 * that reserves units.
 *
 * Only the quantity dropdown is local state. Stock is not kept here at all; it
 * comes from the parent on every poll, so the card always renders what the
 * server last said rather than a number this component tried to predict.
 */
export function ProductCard({ product, disabled, onAddToCart }: Props) {
  const [quantity, setQuantity] = useState(1);

  const soldOut = product.available <= 0;
  const selectableMax = Math.min(MAX_PER_ORDER, Math.max(product.available, 1));
  const sold = product.totalStock - product.available;
  const soldPercent = product.totalStock === 0 ? 0 : (sold / product.totalStock) * 100;

  return (
    <article className="card">
      <header>
        <h3>{product.name}</h3>
        <span className="price">{formatPrice(product.priceCents)}</span>
      </header>

      <SaleCountdown endsAt={product.saleEndsAt} />

      <div className="stock">
        <div className="bar">
          <div className="fill" style={{ width: `${soldPercent}%` }} />
        </div>
        <small>{soldOut ? 'Sold out' : `${product.available} of ${product.totalStock} left`}</small>
      </div>

      <footer>
        <select
          value={quantity}
          disabled={soldOut || disabled}
          onChange={(event) => setQuantity(Number(event.target.value))}
        >
          {Array.from({ length: selectableMax }, (_, index) => index + 1).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={soldOut || disabled}
          onClick={() => onAddToCart(product.id, quantity)}
        >
          {soldOut ? 'Sold out' : 'Add to Cart'}
        </button>
      </footer>
    </article>
  );
}
