/**
 * Logger Port for Tenant Service
 * 
 * Interface for structured logging throughout the tenant service.
 */

export interface Logger {
  debug(message: string, meta?: Record<string, any>): void;
  info(message: string, meta?: Record<string, any>): void;
  warn(message: string, meta?: Record<string, any>): void;
  error(message: string, meta?: Record<string, any>): void;
  fatal(message: string, meta?: Record<string, any>): void;
  child(context: Record<string, any>): Logger;
}

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal'
}

export interface LoggingConfig {
  level: LogLevel;
  format: 'json' | 'text';
  destination: 'console' | 'file' | 'both';
  filename?: string;
  maxFileSize?: string;
  maxFiles?: number;
  enableTracing?: boolean;
  enableMetrics?: boolean;
}
