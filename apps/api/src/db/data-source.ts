import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { env, isProduction } from '../config/env';
import { Cart } from '../entities/cart.entity';
import { CartItem } from '../entities/cart-item.entity';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Product } from '../entities/product.entity';
import { User } from '../entities/user.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: env.databaseUrl,
  entities: [User, Product, Cart, CartItem, Order, OrderItem],
  // Fine for this exercise; a real deployment would run generated migrations.
  synchronize: !isProduction,
  logging: false,
});

export async function initDatabase(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
}
