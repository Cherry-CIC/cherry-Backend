export interface Order {
  id: string;
  userId: string; // ID of the user who placed the order
  email?: string; // Email of the user (stored for reporting purposes)
  amount: number; // amount in the smallest currency unit (e.g., pence)
  productId?: string;
  productName?: string;
  shipping?: {
    address: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postal_code?: string;
      country?: string;
    };
    name?: string;
  };
  status?: 'completed' | 'pending' | 'failed'; // Order status for tracking
  createdAt: Date;
}