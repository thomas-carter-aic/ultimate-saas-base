/**
 * Kafka Event Publisher Implementation
 * 
 * Concrete implementation of EventPublisher using Apache Kafka.
 * This adapter handles publishing domain events to Kafka topics with
 * proper error handling, retry logic, and monitoring integration.
 */

import { Kafka, Producer, ProducerRecord, RecordMetadata } from 'kafkajs';
import { EventPublisher, EventPublishingConfig } from '../../application/ports/EventPublisher';
import { DomainEvent } from '../../domain/events/UserEvents';
import { Logger } from '../../application/ports/Logger';

export interface KafkaConfig {
  clientId: string;
  brokers: string[];
  ssl?: boolean;
  sasl?: {
    mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
    username: string;
    password: string;
  };
  connectionTimeout?: number;
  requestTimeout?: number;
  retry?: {
    initialRetryTime?: number;
    retries?: number;
  };
}

export class KafkaEventPublisher implements EventPublisher {
  private kafka: Kafka;
  private producer: Producer;
  private isConnected: boolean = false;
  private readonly defaultTopic: string;
  private readonly defaultConfig: EventPublishingConfig;

  constructor(
    private readonly config: KafkaConfig,
    private readonly logger: Logger,
    defaultTopic: string = 'user-events'
  ) {
    // Initialize Kafka client with configuration
    this.kafka = new Kafka({
      clientId: config.clientId,
      brokers: config.brokers,
      ssl: config.ssl,
      sasl: config.sasl,
      connectionTimeout: config.connectionTimeout || 3000,
      requestTimeout: config.requestTimeout || 30000,
      retry: config.retry || {
        initialRetryTime: 100,
        retries: 8
      }
    });

    // Create producer instance
    this.producer = this.kafka.producer({
      maxInFlightRequests: 1, // Ensure message ordering
      idempotent: true, // Prevent duplicate messages
      transactionTimeout: 30000,
      retry: {
        initialRetryTime: 100,
        retries: 5
      }
    });

    this.defaultTopic = defaultTopic;
    this.defaultConfig = {
      topic: defaultTopic,
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000
    };

    // Set up event handlers
    this.setupEventHandlers();
  }

  /**
   * Initialize Kafka producer connection
   */
  async connect(): Promise<void> {
    try {
      await this.producer.connect();
      this.isConnected = true;
      
      this.logger.info('Kafka producer connected successfully', {
        clientId: this.config.clientId,
        brokers: this.config.brokers
      });
    } catch (error) {
      this.logger.error('Failed to connect Kafka producer', {
        error: error instanceof Error ? error.message : 'Unknown error',
        clientId: this.config.clientId
      });
      throw error;
    }
  }

  /**
   * Disconnect Kafka producer
   */
  async disconnect(): Promise<void> {
    try {
      if (this.isConnected) {
        await this.producer.disconnect();
        this.isConnected = false;
        
        this.logger.info('Kafka producer disconnected successfully');
      }
    } catch (error) {
      this.logger.error('Error disconnecting Kafka producer', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Publish a single domain event to Kafka
   * 
   * @param event - Domain event to publish
   * @returns Promise that resolves when event is published
   */
  async publish(event: DomainEvent): Promise<void> {
    await this.ensureConnected();

    try {
      const topic = this.getTopicForEvent(event);
      const message = this.createKafkaMessage(event);

      const record: ProducerRecord = {
        topic,
        messages: [message]
      };

      const metadata = await this.producer.send(record);
      
      this.logger.info('Event published successfully', {
        eventId: event.eventId,
        eventType: event.eventType,
        topic,
        partition: metadata[0].partition,
        offset: metadata[0].offset
      });

    } catch (error) {
      this.logger.error('Failed to publish event', {
        eventId: event.eventId,
        eventType: event.eventType,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Publish multiple domain events in a batch
   * 
   * @param events - Array of domain events to publish
   * @returns Promise that resolves when all events are published
   */
  async publishBatch(events: DomainEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    await this.ensureConnected();

    try {
      // Group events by topic for efficient batching
      const eventsByTopic = this.groupEventsByTopic(events);
      
      // Create producer records for each topic
      const records: ProducerRecord[] = Object.entries(eventsByTopic).map(([topic, topicEvents]) => ({
        topic,
        messages: topicEvents.map(event => this.createKafkaMessage(event))
      }));

      // Send all records in parallel
      const results = await Promise.all(
        records.map(record => this.producer.send(record))
      );

      // Log successful batch publication
      const totalEvents = events.length;
      const totalPartitions = results.flat().length;
      
      this.logger.info('Event batch published successfully', {
        eventCount: totalEvents,
        topicCount: records.length,
        partitionCount: totalPartitions,
        eventTypes: [...new Set(events.map(e => e.eventType))]
      });

    } catch (error) {
      this.logger.error('Failed to publish event batch', {
        eventCount: events.length,
        eventTypes: [...new Set(events.map(e => e.eventType))],
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Publish event with retry mechanism
   * 
   * @param event - Domain event to publish
   * @param maxRetries - Maximum number of retry attempts
   * @returns Promise that resolves when event is published or max retries reached
   */
  async publishWithRetry(event: DomainEvent, maxRetries: number = 3): Promise<void> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        await this.publish(event);
        
        if (attempt > 1) {
          this.logger.info('Event published successfully after retry', {
            eventId: event.eventId,
            eventType: event.eventType,
            attempt
          });
        }
        
        return; // Success, exit retry loop
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt <= maxRetries) {
          const delay = this.calculateRetryDelay(attempt);
          
          this.logger.warn('Event publish failed, retrying', {
            eventId: event.eventId,
            eventType: event.eventType,
            attempt,
            maxRetries,
            retryDelay: delay,
            error: lastError.message
          });
          
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    this.logger.error('Event publish failed after all retries', {
      eventId: event.eventId,
      eventType: event.eventType,
      maxRetries,
      error: lastError?.message
    });
    
    throw lastError || new Error('Failed to publish event after retries');
  }

  /**
   * Set up Kafka producer event handlers for monitoring
   */
  private setupEventHandlers(): void {
    this.producer.on('producer.connect', () => {
      this.logger.info('Kafka producer connected');
    });

    this.producer.on('producer.disconnect', () => {
      this.logger.info('Kafka producer disconnected');
      this.isConnected = false;
    });

    this.producer.on('producer.network.request_timeout', (payload) => {
      this.logger.warn('Kafka producer request timeout', {
        broker: payload.broker,
        clientId: payload.clientId,
        correlationId: payload.correlationId
      });
    });
  }

  /**
   * Ensure producer is connected before publishing
   */
  private async ensureConnected(): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
  }

  /**
   * Determine the appropriate Kafka topic for an event
   * 
   * @param event - Domain event
   * @returns Kafka topic name
   */
  private getTopicForEvent(event: DomainEvent): string {
    // Route events to specific topics based on event type
    const topicMapping: Record<string, string> = {
      'UserCreated': 'user-lifecycle-events',
      'UserVerified': 'user-lifecycle-events',
      'UserDeactivated': 'user-lifecycle-events',
      'UserLoggedIn': 'user-activity-events',
      'UserLoggedOut': 'user-activity-events',
      'UserFeatureUsed': 'user-activity-events',
      'UserAIInteraction': 'ai-interaction-events',
      'UserErrorReported': 'error-events',
      'UserProfileUpdated': 'user-profile-events',
      'UserPreferencesChanged': 'user-profile-events',
      'UserPasswordChanged': 'user-security-events',
      'UserRoleAdded': 'user-security-events',
      'UserRoleRemoved': 'user-security-events'
    };

    return topicMapping[event.eventType] || this.defaultTopic;
  }

  /**
   * Create Kafka message from domain event
   * 
   * @param event - Domain event
   * @returns Kafka message object
   */
  private createKafkaMessage(event: DomainEvent) {
    const eventPayload = {
      ...event,
      publishedAt: new Date().toISOString(),
      version: '1.0'
    };

    return {
      key: event.aggregateId, // Use aggregate ID as partition key for ordering
      value: JSON.stringify(eventPayload),
      timestamp: event.occurredAt.getTime().toString(),
      headers: {
        'event-type': event.eventType,
        'aggregate-type': event.aggregateType,
        'tenant-id': event.tenantId,
        'event-version': event.eventVersion.toString(),
        'content-type': 'application/json'
      }
    };
  }

  /**
   * Group events by their target topics
   * 
   * @param events - Array of domain events
   * @returns Events grouped by topic
   */
  private groupEventsByTopic(events: DomainEvent[]): Record<string, DomainEvent[]> {
    return events.reduce((groups, event) => {
      const topic = this.getTopicForEvent(event);
      if (!groups[topic]) {
        groups[topic] = [];
      }
      groups[topic].push(event);
      return groups;
    }, {} as Record<string, DomainEvent[]>);
  }

  /**
   * Calculate exponential backoff delay for retries
   * 
   * @param attempt - Current attempt number
   * @returns Delay in milliseconds
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = this.defaultConfig.retryDelay || 1000;
    const maxDelay = 30000; // Maximum 30 seconds
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.1 * delay;
    return Math.floor(delay + jitter);
  }

  /**
   * Sleep for specified milliseconds
   * 
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
