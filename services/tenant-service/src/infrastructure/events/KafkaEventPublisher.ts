/**
 * Kafka Event Publisher Implementation for Tenant Service
 * 
 * Reuses the same Kafka event publisher implementation from User Service
 * but configured for tenant-specific events and topics.
 */

import { Kafka, Producer, ProducerRecord } from 'kafkajs';
import { EventPublisher } from '../../application/ports/EventPublisher';
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
}

export class KafkaEventPublisher implements EventPublisher {
  private kafka: Kafka;
  private producer: Producer;
  private isConnected: boolean = false;

  constructor(
    private readonly config: KafkaConfig,
    private readonly logger: Logger
  ) {
    this.kafka = new Kafka({
      clientId: config.clientId,
      brokers: config.brokers,
      ssl: config.ssl,
      sasl: config.sasl
    });

    this.producer = this.kafka.producer({
      maxInFlightRequests: 1,
      idempotent: true,
      transactionTimeout: 30000
    });
  }

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
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

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

  async publish(event: any): Promise<void> {
    await this.ensureConnected();

    try {
      const topic = this.getTopicForEvent(event);
      const message = this.createKafkaMessage(event);

      const record: ProducerRecord = {
        topic,
        messages: [message]
      };

      await this.producer.send(record);
      
      this.logger.info('Event published successfully', {
        eventId: event.eventId,
        eventType: event.eventType,
        topic
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

  async publishBatch(events: any[]): Promise<void> {
    // Implementation similar to User Service
    for (const event of events) {
      await this.publish(event);
    }
  }

  async publishWithRetry(event: any, maxRetries: number = 3): Promise<void> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        await this.publish(event);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt <= maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('Failed to publish event after retries');
  }

  private async ensureConnected(): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
  }

  private getTopicForEvent(event: any): string {
    const topicMapping: Record<string, string> = {
      'TenantCreated': 'tenant-lifecycle-events',
      'TenantActivated': 'tenant-lifecycle-events',
      'TenantSuspended': 'tenant-lifecycle-events',
      'TenantCancelled': 'tenant-lifecycle-events',
      'TenantSettingsUpdated': 'tenant-configuration-events',
      'TenantResourceLimitsUpdated': 'tenant-configuration-events',
      'TenantResourceLimitExceeded': 'tenant-usage-events',
      'TenantBillingUpdated': 'tenant-billing-events',
      'TenantUsageUpdated': 'tenant-usage-events',
      'TenantTrialExpiring': 'tenant-lifecycle-events',
      'TenantTrialExpired': 'tenant-lifecycle-events'
    };

    return topicMapping[event.eventType] || 'tenant-events';
  }

  private createKafkaMessage(event: any) {
    const eventPayload = {
      ...event,
      publishedAt: new Date().toISOString(),
      version: '1.0'
    };

    return {
      key: event.aggregateId,
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
