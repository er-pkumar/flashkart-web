import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ProductStatus {
  Draft = 'DRAFT',
  Active = 'ACTIVE',
  Archived = 'ARCHIVED',
}

/**
 * Durable product state. `stock` is the source of truth for how many units are
 * still sellable; Redis only holds a fast, approximate admission counter.
 *
 * The CHECK constraints are the last line of defence against overselling: even
 * if every layer above them had a bug, Postgres would reject the row.
 */
@Entity('products')
@Check('product_stock_non_negative', '"stock" >= 0')
@Check('product_stock_within_total', '"stock" <= "total_stock"')
@Check('product_price_non_negative', '"price_cents" >= 0')
@Index('idx_products_status_sale_start', ['status', 'saleStartsAt'])
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('uq_products_sku', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  sku!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  /** Stored in minor units (paise/cents) to keep money out of floating point. */
  @Column({ name: 'price_cents', type: 'int' })
  priceCents!: number;

  /** Units allocated to the sale. Never changes once the sale opens. */
  @Column({ name: 'total_stock', type: 'int' })
  totalStock!: number;

  /** Units still sellable. Only ever decremented inside a checkout transaction. */
  @Column({ type: 'int' })
  stock!: number;

  /** Only ACTIVE products accept reservations. */
  @Column({ type: 'enum', enum: ProductStatus, default: ProductStatus.Draft })
  status!: ProductStatus;

  /** Flash-sale window. NULL on either side means unbounded. */
  @Column({ name: 'sale_starts_at', type: 'timestamptz', nullable: true })
  saleStartsAt!: Date | null;

  @Column({ name: 'sale_ends_at', type: 'timestamptz', nullable: true })
  saleEndsAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
