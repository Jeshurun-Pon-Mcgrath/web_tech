import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/index.css';
class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="empty">
        <h1>Unable to display this page.</h1>
        <p>Reload to recover your workspace. Saved answers remain on the server.</p>
        <button className="button button-primary" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
