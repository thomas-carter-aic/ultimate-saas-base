/**
 * Stripe Webhook Handler
 * 
 * Handles Stripe webhook events for billing-related operations.
 * Processes payment events, subscription changes, and billing failures.
 */

import Stripe from 'stripe';
import { TenantRepository } from '../../domain/repositories/TenantRepository';
import { EventPublisher } from '../../application/ports/EventPublisher';
import { Logger } from '../../application/ports/Logger';
import { TenantEventFactory } from '../../domain/events/TenantEvents';

export interface WebhookEvent {
  id: string;
  type: string;
  data: {
    object: any;
    previous_attributes?: any;
  };
  created: number;
}

export class StripeWebhookHandler {
  private stripe: Stripe;

  constructor(
    private tenantRepository: TenantRepository,
    private eventPublisher: EventPublisher,
    private logger: Logger,
    stripeSecretKey: string
  ) {
    this.stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16'
    });
  }

  /**
   * Process Stripe webhook event
   */
  async handleWebhook(rawBody: string, signature: string, endpointSecret: string): Promise<void> {
    try {
      // Verify webhook signature
      const event = this.stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);

      this.logger.info('Processing Stripe webhook', {
        eventId: event.id,
        eventType: event.type,
        created: new Date(event.created * 1000)
      });

      // Route to appropriate handler
      switch (event.type) {
        case 'customer.subscription.created':
          await this.handleSubscriptionCreated(event);
          break;

        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event);
          break;

        case 'invoice.payment_succeeded':
          await this.handlePaymentSucceeded(event);
          break;

        case 'invoice.payment_failed':
          await this.handlePaymentFailed(event);
          break;

        case 'customer.subscription.trial_will_end':
          await this.handleTrialWillEnd(event);
          break;

        case 'invoice.upcoming':
          await this.handleUpcomingInvoice(event);
          break;

        case 'customer.created':
          await this.handleCustomerCreated(event);
          break;

        case 'customer.updated':
          await this.handleCustomerUpdated(event);
          break;

        case 'payment_method.attached':
          await this.handlePaymentMethodAttached(event);
          break;

        case 'setup_intent.succeeded':
          await this.handleSetupIntentSucceeded(event);
          break;

        default:
          this.logger.info('Unhandled webhook event type', {
            eventType: event.type,
            eventId: event.id
          });
      }

      this.logger.info('Webhook processed successfully', {
        eventId: event.id,
        eventType: event.type
      });

    } catch (error) {
      this.logger.error('Error processing webhook', error as Error, {
        signature: signature.substring(0, 20) + '...',
        bodyLength: rawBody.length
      });
      throw error;
    }
  }

  /**
   * Handle subscription created event
   */
  private async handleSubscriptionCreated(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    
    try {
      // Find tenant by customer ID
      const tenant = await this.findTenantByCustomerId(subscription.customer as string);
      if (!tenant) {
        this.logger.warn('Tenant not found for subscription created', {
          customerId: subscription.customer,
          subscriptionId: subscription.id
        });
        return;
      }

      // Update tenant billing info
      const updatedTenant = {
        ...tenant,
        billingInfo: {
          ...tenant.billingInfo,
          subscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end
        },
        status: subscription.status === 'active' ? 'active' : tenant.status,
        updatedAt: new Date()
      };

      await this.tenantRepository.update(updatedTenant as any);

      // Publish event
      const domainEvent = TenantEventFactory.createTenantBillingUpdatedEvent(
        tenant.id,
        updatedTenant.billingInfo
      );
      await this.eventPublisher.publish(domainEvent);

      this.logger.info('Subscription created processed', {
        tenantId: tenant.id,
        subscriptionId: subscription.id,
        status: subscription.status
      });

    } catch (error) {
      this.logger.error('Error handling subscription created', error as Error, {
        subscriptionId: subscription.id,
        customerId: subscription.customer
      });
      throw error;
    }
  }

  /**
   * Handle subscription updated event
   */
  private async handleSubscriptionUpdated(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    const previousAttributes = event.data.previous_attributes as any;

    try {
      const tenant = await this.findTenantByCustomerId(subscription.customer as string);
      if (!tenant) {
        this.logger.warn('Tenant not found for subscription updated', {
          customerId: subscription.customer,
          subscriptionId: subscription.id
        });
        return;
      }

      // Check what changed
      const changes: string[] = [];
      if (previousAttributes?.status) {
        changes.push(`status: ${previousAttributes.status} → ${subscription.status}`);
      }
      if (previousAttributes?.cancel_at_period_end !== undefined) {
        changes.push(`cancel_at_period_end: ${previousAttributes.cancel_at_period_end} → ${subscription.cancel_at_period_end}`);
      }

      // Update tenant
      const updatedTenant = {
        ...tenant,
        billingInfo: {
          ...tenant.billingInfo,
          subscriptionStatus: subscription.status,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end
        },
        status: this.mapSubscriptionStatusToTenantStatus(subscription.status),
        updatedAt: new Date()
      };

      await this.tenantRepository.update(updatedTenant as any);

      // Publish event
      const domainEvent = TenantEventFactory.createTenantBillingUpdatedEvent(
        tenant.id,
        updatedTenant.billingInfo
      );
      await this.eventPublisher.publish(domainEvent);

      this.logger.info('Subscription updated processed', {
        tenantId: tenant.id,
        subscriptionId: subscription.id,
        changes: changes.join(', ')
      });

    } catch (error) {
      this.logger.error('Error handling subscription updated', error as Error, {
        subscriptionId: subscription.id,
        customerId: subscription.customer
      });
      throw error;
    }
  }

  /**
   * Handle subscription deleted event
   */
  private async handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;

    try {
      const tenant = await this.findTenantByCustomerId(subscription.customer as string);
      if (!tenant) {
        this.logger.warn('Tenant not found for subscription deleted', {
          customerId: subscription.customer,
          subscriptionId: subscription.id
        });
        return;
      }

      // Update tenant status to cancelled
      const updatedTenant = {
        ...tenant,
        status: 'cancelled',
        billingInfo: {
          ...tenant.billingInfo,
          subscriptionStatus: 'canceled',
          cancelledAt: new Date()
        },
        updatedAt: new Date()
      };

      await this.tenantRepository.update(updatedTenant as any);

      // Publish event
      const domainEvent = TenantEventFactory.createTenantCancelledEvent(
        tenant.id,
        'Subscription cancelled in Stripe'
      );
      await this.eventPublisher.publish(domainEvent);

      this.logger.info('Subscription deleted processed', {
        tenantId: tenant.id,
        subscriptionId: subscription.id
      });

    } catch (error) {
      this.logger.error('Error handling subscription deleted', error as Error, {
        subscriptionId: subscription.id,
        customerId: subscription.customer
      });
      throw error;
    }
  }

  /**
   * Handle payment succeeded event
   */
  private async handlePaymentSucceeded(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;

    try {
      const tenant = await this.findTenantByCustomerId(invoice.customer as string);
      if (!tenant) {
        this.logger.warn('Tenant not found for payment succeeded', {
          customerId: invoice.customer,
          invoiceId: invoice.id
        });
        return;
      }

      // Update tenant billing info
      const updatedTenant = {
        ...tenant,
        billingInfo: {
          ...tenant.billingInfo,
          lastPaymentDate: new Date(invoice.status_transitions.paid_at! * 1000),
          lastPaymentAmount: invoice.amount_paid / 100, // Convert from cents
          paymentStatus: 'current'
        },
        updatedAt: new Date()
      };

      await this.tenantRepository.update(updatedTenant as any);

      // Publish event
      const domainEvent = TenantEventFactory.createTenantPaymentSucceededEvent(
        tenant.id,
        {
          amount: invoice.amount_paid / 100,
          currency: invoice.currency,
          invoiceId: invoice.id,
          paidAt: new Date(invoice.status_transitions.paid_at! * 1000)
        }
      );
      await this.eventPublisher.publish(domainEvent);

      this.logger.info('Payment succeeded processed', {
        tenantId: tenant.id,
        invoiceId: invoice.id,
        amount: invoice.amount_paid / 100,
        currency: invoice.currency
      });

    } catch (error) {
      this.logger.error('Error handling payment succeeded', error as Error, {
        invoiceId: invoice.id,
        customerId: invoice.customer
      });
      throw error;
    }
  }

  /**
   * Handle payment failed event
   */
  private async handlePaymentFailed(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;

    try {
      const tenant = await this.findTenantByCustomerId(invoice.customer as string);
      if (!tenant) {
        this.logger.warn('Tenant not found for payment failed', {
          customerId: invoice.customer,
          invoiceId: invoice.id
        });
        return;
      }

      // Update tenant billing info
      const updatedTenant = {
        ...tenant,
        billingInfo: {
          ...tenant.billingInfo,
          paymentStatus: 'failed',
          lastFailedPaymentDate: new Date(),
          lastFailedPaymentAmount: invoice.amount_due / 100
        },
        status: 'suspended', // Suspend tenant on payment failure
        updatedAt: new Date()
      };

      await this.tenantRepository.update(updatedTenant as any);

      // Publish event
      const domainEvent = TenantEventFactory.createTenantPaymentFailedEvent(
        tenant.id,
        {
          amount: invoice.amount_due / 100,
          currency: invoice.currency,
          invoiceId: invoice.id,
          failureReason: 'Payment failed in Stripe'
        }
      );
      await this.eventPublisher.publish(domainEvent);

      this.logger.info('Payment failed processed', {
        tenantId: tenant.id,
        invoiceId: invoice.id,
        amount: invoice.amount_due / 100,
        currency: invoice.currency
      });

    } catch (error) {
      this.logger.error('Error handling payment failed', error as Error, {
        invoiceId: invoice.id,
        customerId: invoice.customer
      });
      throw error;
    }
  }

  /**
   * Handle trial will end event
   */
  private async handleTrialWillEnd(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;

    try {
      const tenant = await this.findTenantByCustomerId(subscription.customer as string);
      if (!tenant) {
        this.logger.warn('Tenant not found for trial will end', {
          customerId: subscription.customer,
          subscriptionId: subscription.id
        });
        return;
      }

      // Publish event for trial ending soon
      const domainEvent = TenantEventFactory.createTenantTrialEndingSoonEvent(
        tenant.id,
        new Date(subscription.trial_end! * 1000)
      );
      await this.eventPublisher.publish(domainEvent);

      this.logger.info('Trial will end processed', {
        tenantId: tenant.id,
        subscriptionId: subscription.id,
        trialEnd: new Date(subscription.trial_end! * 1000)
      });

    } catch (error) {
      this.logger.error('Error handling trial will end', error as Error, {
        subscriptionId: subscription.id,
        customerId: subscription.customer
      });
      throw error;
    }
  }

  /**
   * Handle upcoming invoice event
   */
  private async handleUpcomingInvoice(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;

    try {
      const tenant = await this.findTenantByCustomerId(invoice.customer as string);
      if (!tenant) {
        this.logger.warn('Tenant not found for upcoming invoice', {
          customerId: invoice.customer,
          invoiceId: invoice.id
        });
        return;
      }

      // Publish event for upcoming billing
      const domainEvent = TenantEventFactory.createTenantUpcomingBillingEvent(
        tenant.id,
        {
          amount: invoice.amount_due / 100,
          currency: invoice.currency,
          dueDate: new Date(invoice.due_date! * 1000)
        }
      );
      await this.eventPublisher.publish(domainEvent);

      this.logger.info('Upcoming invoice processed', {
        tenantId: tenant.id,
        invoiceId: invoice.id,
        amount: invoice.amount_due / 100,
        dueDate: new Date(invoice.due_date! * 1000)
      });

    } catch (error) {
      this.logger.error('Error handling upcoming invoice', error as Error, {
        invoiceId: invoice.id,
        customerId: invoice.customer
      });
      throw error;
    }
  }

  /**
   * Handle customer created event
   */
  private async handleCustomerCreated(event: Stripe.Event): Promise<void> {
    const customer = event.data.object as Stripe.Customer;

    this.logger.info('Customer created in Stripe', {
      customerId: customer.id,
      email: customer.email
    });

    // This event is mainly for logging/monitoring
    // Tenant should already be created with customer ID
  }

  /**
   * Handle customer updated event
   */
  private async handleCustomerUpdated(event: Stripe.Event): Promise<void> {
    const customer = event.data.object as Stripe.Customer;

    try {
      const tenant = await this.findTenantByCustomerId(customer.id);
      if (!tenant) {
        this.logger.info('Customer updated but no associated tenant found', {
          customerId: customer.id
        });
        return;
      }

      // Update tenant billing info if email changed
      if (customer.email && customer.email !== tenant.billingInfo.billingEmail) {
        const updatedTenant = {
          ...tenant,
          billingInfo: {
            ...tenant.billingInfo,
            billingEmail: customer.email
          },
          updatedAt: new Date()
        };

        await this.tenantRepository.update(updatedTenant as any);

        this.logger.info('Tenant billing email updated from Stripe', {
          tenantId: tenant.id,
          customerId: customer.id,
          newEmail: customer.email
        });
      }

    } catch (error) {
      this.logger.error('Error handling customer updated', error as Error, {
        customerId: customer.id
      });
      throw error;
    }
  }

  /**
   * Handle payment method attached event
   */
  private async handlePaymentMethodAttached(event: Stripe.Event): Promise<void> {
    const paymentMethod = event.data.object as Stripe.PaymentMethod;

    try {
      const tenant = await this.findTenantByCustomerId(paymentMethod.customer as string);
      if (!tenant) {
        this.logger.info('Payment method attached but no associated tenant found', {
          customerId: paymentMethod.customer,
          paymentMethodId: paymentMethod.id
        });
        return;
      }

      // Update tenant with new payment method
      const updatedTenant = {
        ...tenant,
        billingInfo: {
          ...tenant.billingInfo,
          paymentMethodId: paymentMethod.id,
          paymentMethodType: paymentMethod.type,
          lastFour: paymentMethod.card?.last4 || undefined
        },
        updatedAt: new Date()
      };

      await this.tenantRepository.update(updatedTenant as any);

      this.logger.info('Payment method attached processed', {
        tenantId: tenant.id,
        paymentMethodId: paymentMethod.id,
        type: paymentMethod.type
      });

    } catch (error) {
      this.logger.error('Error handling payment method attached', error as Error, {
        paymentMethodId: paymentMethod.id,
        customerId: paymentMethod.customer
      });
      throw error;
    }
  }

  /**
   * Handle setup intent succeeded event
   */
  private async handleSetupIntentSucceeded(event: Stripe.Event): Promise<void> {
    const setupIntent = event.data.object as Stripe.SetupIntent;

    this.logger.info('Setup intent succeeded', {
      setupIntentId: setupIntent.id,
      customerId: setupIntent.customer,
      paymentMethodId: setupIntent.payment_method
    });

    // This is mainly for logging - payment method attached event will handle the update
  }

  /**
   * Find tenant by Stripe customer ID
   */
  private async findTenantByCustomerId(customerId: string): Promise<any | null> {
    try {
      // This would need to be implemented in the repository
      // For now, we'll use a search approach
      const tenants = await this.tenantRepository.search({
        limit: 1
      });

      // Find tenant with matching customer ID in billing info
      for (const tenant of tenants) {
        if (tenant.billingInfo?.customerId === customerId) {
          return tenant;
        }
      }

      return null;
    } catch (error) {
      this.logger.error('Error finding tenant by customer ID', error as Error, {
        customerId
      });
      throw error;
    }
  }

  /**
   * Map Stripe subscription status to tenant status
   */
  private mapSubscriptionStatusToTenantStatus(subscriptionStatus: string): string {
    const statusMap: Record<string, string> = {
      'active': 'active',
      'trialing': 'trial',
      'past_due': 'suspended',
      'canceled': 'cancelled',
      'unpaid': 'suspended',
      'incomplete': 'suspended',
      'incomplete_expired': 'cancelled'
    };

    return statusMap[subscriptionStatus] || 'suspended';
  }
}
