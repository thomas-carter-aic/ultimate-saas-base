/**
 * Event Publisher Port for Tenant Service
 * 
 * Interface for publishing tenant domain events to the event streaming system.
 */

export interface EventPublisher {
  /**
   * Publish a single domain event
   */
  publish(event: any): Promise<void>;

  /**
   * Publish multiple domain events in a batch
   */
  publishBatch(events: any[]): Promise<void>;

  /**
   * Publish event with retry mechanism
   */
  publishWithRetry(event: any, maxRetries?: number): Promise<void>;
}
