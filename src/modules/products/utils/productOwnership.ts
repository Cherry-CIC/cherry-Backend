type ProductOwnershipData = {
  userId?: unknown;
  user_id?: unknown;
};

export const SELF_PURCHASE_ERROR = 'You cannot buy your own listing';

export const productBelongsToUser = (
  product: ProductOwnershipData,
  userId: string,
): boolean => {
  const sellerId =
    typeof product.userId === 'string'
      ? product.userId
      : typeof product.user_id === 'string'
        ? product.user_id
        : null;

  return sellerId === userId;
};
