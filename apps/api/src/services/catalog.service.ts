import { AppDataSource } from '../db/data-source';
import { Product, ProductStatus } from '../entities/product.entity';
import { keys, redis } from '../redis/client';

export type ProductView = {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  totalStock: number;
  available: number;
  saleEndsAt: string | null;
};

const products = () => AppDataSource.getRepository(Product);

/**
 * Seeds the Redis admission counters from durable stock.
 *
 * Uses SET NX so a restart never clobbers a counter that already has in-flight
 * reservations drawn against it.
 */
export async function primeStockCounters(): Promise<void> {
  const all = await products().findBy({ status: ProductStatus.Active });
  if (all.length === 0) return;

  const pipeline = redis.pipeline();
  for (const product of all) {
    pipeline.set(keys.stock(product.id), product.stock, 'NX');
  }
  await pipeline.exec();
}

export async function listProducts(): Promise<ProductView[]> {
  const all = await products().find({
    where: { status: ProductStatus.Active },
    order: { createdAt: 'ASC' },
  });
  if (all.length === 0) return [];

  const counters = await redis.mget(all.map((product) => keys.stock(product.id)));

  return all.map((product, index) => {
    const counter = counters[index];
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      priceCents: product.priceCents,
      totalStock: product.totalStock,
      saleEndsAt: product.saleEndsAt ? product.saleEndsAt.toISOString() : null,
      // Durable stock is the fallback if the counter has not been primed yet.
      available: counter === null || counter === undefined ? product.stock : Number(counter),
    };
  });
}

export async function findProduct(productId: string): Promise<Product | null> {
  return products().findOneBy({ id: productId });
}
