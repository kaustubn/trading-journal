import React from 'react';

interface Props {
  children: React.ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  message: string;
}

// Contains render errors so one broken section can't blank the whole app.
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || 'Something went wrong' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? ' ' + this.props.name : ''}]`, error, info);
  }

  handleReset = () => this.setState({ hasError: false, message: '' });

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '1rem 1.25rem',
          margin: '0.75rem 0',
          background: '#fff5f5',
          border: '1px solid #ffd0d0',
          borderRadius: 8,
          color: '#b12727',
          fontSize: 14,
        }}>
          <strong>{this.props.name || 'This section'} couldn't load.</strong>
          <div style={{ opacity: 0.8, margin: '4px 0 8px' }}>{this.state.message}</div>
          <button
            onClick={this.handleReset}
            style={{
              background: '#b12727', color: 'white', border: 'none',
              padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 13,
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
