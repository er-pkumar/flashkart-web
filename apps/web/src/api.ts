export type Product = {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  totalStock: number;
  available: number;
  saleEndsAt: string | null;
};

export type Reservation = {
  reservationId: string;
  productId: string;
  quantity: number;
  expiresAt: string;
};

export type OrderItem = {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
};

export type Order = {
  id: string;
  status: string;
  totalAmountCents: number;
  createdAt: string;
  items: OrderItem[];
};

export type User = {
  id: string;
  email: string;
  name: string;
};

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const USER_KEY = 'flashkart:userId';

/**
 * Stands in for signup: provision a user once, then keep its id locally.
 * Real auth would hand us a token here instead.
 */
async function ensureUserId(): Promise<string> {
  const existing = localStorage.getItem(USER_KEY);
  if (existing) return existing;

  const response = await fetch('/api/users', { method: 'POST' });
  if (!response.ok) throw new ApiError('SIGNUP_FAILED', 'Could not create a demo user');

  const { user } = (await response.json()) as { user: User };
  localStorage.setItem(USER_KEY, user.id);
  return user.id;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const userId = await ensureUserId();
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId,
      ...init.headers,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as { error?: { code: string; message: string } } | null)?.error;
    throw new ApiError(
      error?.code ?? 'UNKNOWN',
      error?.message ?? `Request failed (${response.status})`,
    );
  }
  return payload as T;
}

export const api = {
  me: () => request<{ user: User }>('/users/me').then((r) => r.user),

  listProducts: () => request<{ products: Product[] }>('/products').then((r) => r.products),

  reserve: (productId: string, quantity: number) =>
    request<Reservation>('/cart/reserve', {
      method: 'POST',
      body: JSON.stringify({ productId, quantity }),
    }),

  release: (reservationId: string) =>
    request<{ released: boolean }>(`/reservations/${reservationId}`, { method: 'DELETE' }),

  /**
   * The idempotency key is tied to the reservation, so retrying a failed or
   * timed-out checkout returns the original order instead of charging twice.
   */
  checkout: (reservationId: string, idempotencyKey: string) =>
    request<{ order: Order; replayed: boolean }>('/order/checkout', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ reservationId }),
    }),

  listOrders: () => request<{ orders: Order[] }>('/orders').then((r) => r.orders),
};

export function formatPrice(cents: number): string {
  return `₹${(cents / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
