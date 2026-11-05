import { Component, type ReactNode } from 'react';
import { useRouteStore } from '../../store/routeStore';
import { Button } from './Button';

interface Props {
  /** Changing this, usually the tool id, clears a previous error. */
  resetKey: string;
  children: ReactNode;
}

interface State {
  resetKey: string;
  error: Error | null;
}

/** Keeps a failed tool on its own page instead of replacing the whole site. */
export class ToolErrorBoundary extends Component<Props, State> {
  state: State = { resetKey: this.props.resetKey, error: null };

  static getDerivedStateFromError(error: Error): Pick<State, 'error'> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Pick<State, 'resetKey' | 'error'> | null {
    if (props.resetKey === state.resetKey) return null;
    return { resetKey: props.resetKey, error: null };
  }

  componentDidCatch(error: Error): void {
    console.error('[ofctools] Tool failed:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-xl px-4 sm:px-6">
        <div className="card p-6 text-center">
          <p className="text-sm font-medium text-fg">This tool hit a problem</p>
          <p className="mt-2 text-sm text-muted">The rest of ofctools is still open. Try again, or go back to all tools.</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" size="sm" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <Button variant="secondary" size="sm" onClick={() => useRouteStore.getState().navigate('/#tools')}>
              All tools
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
