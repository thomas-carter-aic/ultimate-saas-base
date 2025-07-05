/**
 * Event Publisher Port
 * 
 * Interface for publishing domain events to the event streaming system.
 * This port allows the application layer to remain independent of the
 * specific event streaming technology (Kafka, EventBridge, etc.).
 */

import { DomainEvent } from '../../domain/events/UserEvents';

export interface EventPublisher {
  /**
   * Publish a single domain event
   * 
   * @param event - Domain event to publish
   * @returns Promise that resolves when event is published
   */
  publish(event: DomainEvent): Promise<void>;

  /**
   * Publish multiple domain events in a batch
   * 
   * @param events - Array of domain events to publish
   * @returns Promise that resolves when all events are published
   */
  publishBatch(events: DomainEvent[]): Promise<void>;

  /**
   * Publish event with retry mechanism
   * 
   * @param event - Domain event to publish
   * @param maxRetries - Maximum number of retry attempts
   * @returns Promise that resolves when event is published or max retries reached
   */
  publishWithRetry(event: DomainEvent, maxRetries?: number): Promise<void>;
}

/**
 * Event Publishing Configuration
 */
export interface EventPublishingConfig {
  topic: string;
  partition?: number;
  key?: string;
  headers?: Record<string, string>;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}
