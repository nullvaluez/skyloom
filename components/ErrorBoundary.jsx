'use client';

import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Error boundary component for catching and handling React errors
 * Specifically designed for map components which may fail due to bad data
 */
export class MapErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Map component error:', error, errorInfo);

    // You could send to error reporting service here
    // reportError(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-background">
          <div className="flex max-w-md flex-col items-center gap-4 text-center p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>

            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Map Failed to Load</h2>
              <p className="text-sm text-muted-foreground">
                There was an error loading the flight tracker map. This might be a temporary issue.
              </p>
            </div>

            {this.state.error?.message && (
              <div className="w-full rounded-lg bg-destructive/10 p-3 text-left">
                <code className="text-xs text-destructive">
                  {this.state.error.message}
                </code>
              </div>
            )}

            <Button onClick={this.handleRetry} className="mt-2">
              <RotateCcw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Generic error boundary for any component
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Component error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex h-full items-center justify-center bg-background p-4">
          <div className="text-center">
            <p className="text-lg font-medium">Something went wrong</p>
            <button
              onClick={this.handleRetry}
              className="mt-2 text-primary hover:underline"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default MapErrorBoundary;
