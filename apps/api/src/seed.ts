import 'reflect-metadata';
import { AppDataSource, initDatabase } from './db/data-source';
import { Product, ProductStatus } from './entities/product.entity';
import { keys, redis } from './redis/client';

const CATALOGUE = [
  { sku: 'FK-KB-AURORA', name: 'Aurora Mechanical Keyboard', priceCents: 749_00, stock: 25 },
  { sku: 'FK-HP-NIMBUS', name: 'Nimbus ANC Headphones', priceCents: 1_299_00, stock: 10 },
  { sku: 'FK-PB-VOLT20', name: 'Volt 20K Power Bank', priceCents: 199_00, stock: 100 },
  { sku: 'FK-MN-LUMEN4K', name: 'Lumen 4K Monitor', priceCents: 2_499_00, stock: 5 },
  { sku: 'FK-MS-DRIFT', name: 'Drift Wireless Mouse', priceCents: 149_00, stock: 50 },
];

/** Wipes the domain tables and every Redis key, then reloads the flash sale. */
async function seed(): Promise<void> {
  await initDatabase();

  // Truncate rather than delete: one statement, and it resets dependent tables
  // in foreign-key order for us.
  await AppDataSource.query(
    'TRUNCATE TABLE order_items, orders, cart_items, carts, products, users CASCADE',
  );

  await AppDataSource.getRepository(Product).save(
    CATALOGUE.map((item) =>
      AppDataSource.getRepository(Product).create({
        sku: item.sku,
        name: item.name,
        priceCents: item.priceCents,
        totalStock: item.stock,
        stock: item.stock,
        status: ProductStatus.Active,
        saleStartsAt: null,
        // A live window so the sale countdown has something to show.
        saleEndsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      }),
    ),
  );

  const stale = await redis.keys('fk:*');
  if (stale.length > 0) await redis.del(stale);

  const products = await AppDataSource.getRepository(Product).find();
  const pipeline = redis.pipeline();
  for (const product of products) {
    pipeline.set(keys.stock(product.id), product.stock);
  }
  await pipeline.exec();

  console.log('Seeded %d products:', products.length);
  for (const product of products) {
    console.log('  %s  stock=%d %s', product.id, product.stock, product.name);
  }
  console.log('\nUsers are provisioned on demand via POST /api/users.');
}

seed()
  .then(async () => {
    await AppDataSource.destroy();
    await redis.quit();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
