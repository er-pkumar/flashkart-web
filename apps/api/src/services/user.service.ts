import { randomUUID } from 'node:crypto';
import { AppDataSource } from '../db/data-source';
import { User, UserStatus } from '../entities/user.entity';
import { AppError, notFound } from '../errors';

const users = () => AppDataSource.getRepository(User);

/**
 * Stands in for signup. The web client calls this once and keeps the returned
 * id in local storage; real auth would replace it without touching any other
 * service.
 */
export async function createDemoUser(): Promise<User> {
  const handle = randomUUID().slice(0, 8);
  return users().save(
    users().create({
      email: `shopper-${handle}@flashkart.test`,
      name: `Shopper ${handle}`,
      status: UserStatus.Active,
    }),
  );
}

export async function getUser(userId: string): Promise<User> {
  const user = await users().findOneBy({ id: userId });
  if (!user) throw notFound('USER_NOT_FOUND', 'User does not exist');
  if (user.status !== UserStatus.Active) {
    throw new AppError(403, 'USER_BLOCKED', 'This account cannot place orders');
  }
  return user;
}
