/**
 * Billing Service Port
 * 
 * Interface for billing and payment processing operations.
 * This port enables the application to integrate with various billing
 * providers (Stripe, PayPal, etc.) without tight coupling.
 */

import { BillingInfo } from '../../domain/entities/Tenant';

export interface BillingService {
  /**
   * Setup billing for a new tenant
   * 
   * @param request - Billing setup request
   * @returns Promise resolving to billing setup result
   */
  setupBilling(request: {
    tenantId: string;
    ownerId: string;
    plan: string;
    billingInfo: Partial<BillingInfo>;
  }): Promise<{
    success: boolean;
    billingInfo: Partial<BillingInfo>;
    error?: string;
  }>;

  /**
   * Process payment for a tenant
   * 
   * @param request - Payment processing request
   * @returns Promise resolving to payment result
   */
  processPayment(request: {
    tenantId: string;
    amount: number;
    currency: string;
    description?: string;
    metadata?: Record<string, any>;
  }): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
  }>;

  /**
   * Update payment method for a tenant
   * 
   * @param request - Payment method update request
   * @returns Promise resolving to update result
   */
  updatePaymentMethod(request: {
    tenantId: string;
    paymentMethod: {
      type: 'card' | 'bank' | 'invoice';
      token?: string;
      last4?: string;
      expiryMonth?: number;
      expiryYear?: number;
    };
  }): Promise<{
    success: boolean;
    error?: string;
  }>;

  /**
   * Change tenant subscription plan
   * 
   * @param request - Plan change request
   * @returns Promise resolving to plan change result
   */
  changePlan(request: {
    tenantId: string;
    newPlan: string;
    effectiveDate?: Date;
    prorationBehavior?: 'create_prorations' | 'none';
  }): Promise<{
    success: boolean;
    proratedAmount?: number;
    nextBillingDate?: Date;
    error?: string;
  }>;

  /**
   * Cancel tenant subscription
   * 
   * @param request - Cancellation request
   * @returns Promise resolving to cancellation result
   */
  cancelSubscription(request: {
    tenantId: string;
    cancelAt?: Date;
    reason?: string;
  }): Promise<{
    success: boolean;
    cancelledAt?: Date;
    refundAmount?: number;
    error?: string;
  }>;

  /**
   * Get billing history for a tenant
   * 
   * @param request - Billing history request
   * @returns Promise resolving to billing history
   */
  getBillingHistory(request: {
    tenantId: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<{
    success: boolean;
    invoices?: Array<{
      id: string;
      amount: number;
      currency: string;
      status: string;
      createdAt: Date;
      paidAt?: Date;
      description?: string;
    }>;
    error?: string;
  }>;

  /**
   * Generate invoice for tenant usage
   * 
   * @param request - Invoice generation request
   * @returns Promise resolving to invoice generation result
   */
  generateInvoice(request: {
    tenantId: string;
    billingPeriod: {
      start: Date;
      end: Date;
    };
    usage: {
      baseAmount: number;
      overageCharges?: Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        amount: number;
      }>;
    };
  }): Promise<{
    success: boolean;
    invoiceId?: string;
    amount?: number;
    dueDate?: Date;
    error?: string;
  }>;

  /**
   * Calculate usage-based charges
   * 
   * @param request - Usage calculation request
   * @returns Promise resolving to usage charges
   */
  calculateUsageCharges(request: {
    tenantId: string;
    plan: string;
    usage: {
      users: number;
      storageGB: number;
      apiCalls: number;
      aiInteractions: number;
    };
    billingPeriod: {
      start: Date;
      end: Date;
    };
  }): Promise<{
    success: boolean;
    charges?: {
      baseAmount: number;
      overageCharges: Array<{
        resource: string;
        included: number;
        used: number;
        overage: number;
        unitPrice: number;
        amount: number;
      }>;
      totalAmount: number;
    };
    error?: string;
  }>;

  /**
   * Validate payment method
   * 
   * @param request - Payment method validation request
   * @returns Promise resolving to validation result
   */
  validatePaymentMethod(request: {
    type: 'card' | 'bank';
    token: string;
  }): Promise<{
    valid: boolean;
    details?: {
      last4?: string;
      brand?: string;
      expiryMonth?: number;
      expiryYear?: number;
    };
    error?: string;
  }>;

  /**
   * Get billing metrics and analytics
   * 
   * @param request - Metrics request
   * @returns Promise resolving to billing metrics
   */
  getBillingMetrics(request: {
    tenantId?: string;
    timeRange?: {
      start: Date;
      end: Date;
    };
  }): Promise<{
    success: boolean;
    metrics?: {
      totalRevenue: number;
      monthlyRecurringRevenue: number;
      averageRevenuePerUser: number;
      churnRate: number;
      planDistribution: Array<{
        plan: string;
        count: number;
        revenue: number;
      }>;
    };
    error?: string;
  }>;

  /**
   * Handle webhook events from billing provider
   * 
   * @param request - Webhook event request
   * @returns Promise resolving to webhook handling result
   */
  handleWebhook(request: {
    eventType: string;
    data: any;
    signature?: string;
  }): Promise<{
    success: boolean;
    processed: boolean;
    error?: string;
  }>;
}
