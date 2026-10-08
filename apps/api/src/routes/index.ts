import { Router } from 'express';
import { getOrders, postCheckout } from '../controllers/checkout.controller';
import { getProducts } from '../controllers/product.controller';
import { deleteReservation, postReservation } from '../controllers/reservation.controller';
import { getMe, postUser } from '../controllers/user.controller';
import { asyncHandler } from '../middleware/async-handler';
import { currentUser } from '../middleware/current-user';

export const router = Router();

router.get('/products', asyncHandler(getProducts));

// Stand-in for signup; real auth would replace both of these.
router.post('/users', asyncHandler(postUser));
router.get('/users/me', currentUser, asyncHandler(getMe));

router.post('/cart/reserve', currentUser, asyncHandler(postReservation));
router.delete('/reservations/:reservationId', currentUser, asyncHandler(deleteReservation));

router.post('/order/checkout', currentUser, asyncHandler(postCheckout));
router.get('/orders', currentUser, asyncHandler(getOrders));
