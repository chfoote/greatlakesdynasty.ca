import { Component, type ReactNode } from 'react';

// Keep navigation available if a page download fails during a deployment or
// connection interruption. Retry only after the visitor explicitly refreshes.
export default class PageLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div role="alert" className="p-4 text-sm text-gray-600 dark:text-gray-300">
      <p>We couldn’t load this page. Please refresh to try again.</p>
      <button type="button" onClick={() => window.location.reload()} className="mt-3 font-semibold text-brand-500">Refresh page</button>
    </div>;
  }
}
