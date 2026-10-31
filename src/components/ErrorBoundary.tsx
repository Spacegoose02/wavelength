import { Component, type ReactNode } from 'react';

interface State {
  error?: Error;
}

/** Keeps one broken page from blanking the whole app — shows the error instead. */
export class ErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void; fallback?: (retry: () => void, error: Error) => ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[Wavelength] page crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // smaller parts (the player bar, Now Playing) show their own short note
    if (this.props.fallback) return this.props.fallback(() => this.setState({ error: undefined }), error);
    return (
      <div className="page">
        <div className="crash">
          <h2>This page hit an error</h2>
          <p className="muted">The rest of Wavelength still works. Copy the details below if you report it.</p>
          <pre>{`${error.name}: ${error.message}\n\n${(error.stack ?? '').split('\n').slice(1, 8).join('\n')}`}</pre>
          <div className="row gap">
            <button className="btn primary" onClick={() => this.setState({ error: undefined })}>Try again</button>
            {/* a full reload fixes stale code left behind by live updates during development */}
            <button className="btn" onClick={() => location.reload()}>Reload app</button>
            {this.props.onReset && <button className="btn" onClick={() => { this.setState({ error: undefined }); this.props.onReset!(); }}>Go home</button>}
          </div>
        </div>
      </div>
    );
  }
}
