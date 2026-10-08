import {
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
import { CartItem } from './cart-item.entity';
import { User } from './user.entity';

export enum CartStatus {
  Active = 'ACTIVE',
  Converted = 'CONVERTED',
  Abandoned = 'ABANDONED',
}

/**
 * A shopping cart. Carts are kept rather than deleted so a CONVERTED cart stays
 * as a record of what the buyer assembled before ordering.
 *
 * The partial unique index enforces at most one ACTIVE cart per user while
 * still allowing any number of historical CONVERTED or ABANDONED ones.
 */
@Entity('carts')
@Index('uq_carts_one_active_per_user', ['userId'], {
  unique: true,
  where: "status = 'ACTIVE'",
})
export class Cart {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, (user) => user.carts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'enum', enum: CartStatus, default: CartStatus.Active })
  status!: CartStatus;

  @OneToMany(() => CartItem, (item) => item.cart, { cascade: ['insert', 'update'] })
  items?: CartItem[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
