/**
 * Winston Logger Implementation for Tenant Service
 * 
 * Reuses the same Winston logger implementation from User Service
 * but configured for tenant-specific logging context.
 */

import winston from 'winston';
import { Logger, LogLevel, LoggingConfig } from '../../application/ports/Logger';
import { trace } from '@opentelemetry/api';

export class WinstonLogger implements Logger {
  private logger: winston.Logger;
  private contextData: Record<string, any> = {};

  constructor(config: LoggingConfig) {
    this.logger = winston.createLogger({
      level: config.level,
      format: this.createFormat(config),
      transports: this.createTransports(config),
      exitOnError: false,
      silent: false
    });

    this.logger.on('error', (error) => {
      console.error('Logger error:', error);
    });
  }

  debug(message: string, meta?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, meta);
  }

  info(message: string, meta?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, meta);
  }

  warn(message: string, meta?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, meta);
  }

  error(message: string, meta?: Record<string, any>): void {
    this.log(LogLevel.ERROR, message, meta);
  }

  fatal(message: string, meta?: Record<string, any>): void {
    this.log(LogLevel.FATAL, message, meta);
  }

  child(context: Record<string, any>): Logger {
    const childLogger = new WinstonLogger({
      level: this.logger.level as LogLevel,
      format: 'json',
      destination: 'console'
    });
    
    childLogger.contextData = { ...this.contextData, ...context };
    return childLogger;
  }

  private log(level: LogLevel, message: string, meta?: Record<string, any>): void {
    const span = trace.getActiveSpan();
    const traceContext = span ? {
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId
    } : {};

    const logData = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: 'tenant-service',
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      ...traceContext,
      ...this.contextData,
      ...meta
    };

    this.logger.log(level, message, logData);

    if (span) {
      span.addEvent('log', {
        'log.severity': level,
        'log.message': message,
        ...meta
      });
    }
  }

  private createFormat(config: LoggingConfig): winston.Logform.Format {
    const formats: winston.Logform.Format[] = [
      winston.format.timestamp(),
      winston.format.errors({ stack: true })
    ];

    if (config.format === 'json') {
      formats.push(winston.format.json());
    } else {
      formats.push(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length > 0 ? 
            `\n${JSON.stringify(meta, null, 2)}` : '';
          return `${timestamp} [${level}]: ${message}${metaStr}`;
        })
      );
    }

    return winston.format.combine(...formats);
  }

  private createTransports(config: LoggingConfig): winston.transport[] {
    const transports: winston.transport[] = [];

    if (config.destination === 'console' || config.destination === 'both') {
      transports.push(new winston.transports.Console({
        handleExceptions: true,
        handleRejections: true
      }));
    }

    if (config.destination === 'file' || config.destination === 'both') {
      const filename = config.filename || 'tenant-service.log';
      
      transports.push(new winston.transports.File({
        filename,
        handleExceptions: true,
        handleRejections: true,
        maxsize: this.parseSize(config.maxFileSize || '10MB'),
        maxFiles: config.maxFiles || 5,
        tailable: true
      }));
    }

    return transports;
  }

  private parseSize(sizeStr: string): number {
    const units: Record<string, number> = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024
    };

    const match = sizeStr.match(/^(\d+)([A-Z]{1,2})$/i);
    if (!match) {
      return 10 * 1024 * 1024;
    }

    const [, size, unit] = match;
    return parseInt(size, 10) * (units[unit.toUpperCase()] || 1);
  }
}
