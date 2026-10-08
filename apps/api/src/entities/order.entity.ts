import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderItem } from './order-item.entity';
import { User } from './user.entity';

export const ORDER_IDEMPOTENCY_CONSTRAINT = 'uq_orders_idempotency_key';
export const ORDER_RESERVATION_CONSTRAINT = 'uq_orders_reservation_id';

export enum OrderStatus {
  /** Created, awaiting payment. Stock is already committed. */
  Pending = 'PENDING',
  Confirmed = 'CONFIRMED',
  Cancelled = 'CANCELLED',
  Failed = 'FAILED',
}

/**
 * A placed order. The two unique indexes carry real correctness weight:
 *
 * - idempotency key: a retried checkout returns the original order instead of
 *   buying twice.
 * - reservation id: a Redis reservation is spendable exactly once, even if two
 *   requests race with different idempotency keys. It is nullable because a
 *   normal (non-flash) order has no reservation, and Postgres permits many
 *   NULLs in a unique index.
 *
 * They are named explicitly so checkout can map a unique violation back to the
 * constraint that caused it.
 */
@Entity('orders')
@Check('order_total_non_negative', '"total_amount_cents" >= 0')
@Index(ORDER_IDEMPOTENCY_CONSTRAINT, ['idempotencyKey'], { unique: true })
@Index(ORDER_RESERVATION_CONSTRAINT, ['reservationId'], { unique: true })
@Index('idx_orders_user_created', ['userId', 'createdAt'])
@Index('idx_orders_status', ['status'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  // Orders are financial records: a user row must not take them with it.
  @ManyToOne(() => User, (user) => user.orders, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.Pending })
  status!: OrderStatus;

  /** Sum of the line totals, denormalised so order history needs no join. */
  @Column({ name: 'total_amount_cents', type: 'int' })
  totalAmountCents!: number;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'reservation_id', type: 'uuid', nullable: true })
  reservationId!: string | null;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: ['insert'] })
  items?: OrderItem[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
