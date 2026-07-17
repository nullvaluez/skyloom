'use client';

import { Component } from 'react';

/**
 * Catches render/WebGL errors inside Fly mode (context loss, shader
 * compile failures, asset errors) so a broken flight never takes down
 * the tracker underneath.
 */
export class FlyErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Fly mode error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-zinc-950">
          <div className="text-center">
            <p className="text-lg font-medium text-zinc-100">
              Fly mode hit a rendering error
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              This is usually a lost WebGL context or a failed asset load.
            </p>
            <div className="mt-4 flex items-center justify-center gap-4">
              <button
                onClick={this.handleRetry}
                className="text-primary hover:underline"
              >
                Try again
              </button>
              <button
                onClick={this.props.onExit}
                className="text-zinc-400 hover:underline"
              >
                Exit Fly Mode
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
