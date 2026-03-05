import { Component, type ReactNode } from "react";
import { api } from "../lib/api";
import { getErrorBoundaryStrings } from "../lib/i18n";

type State = {
  hasError: boolean;
  message: string;
};

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {
    hasError: false,
    message: ""
  };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "Unknown error"
    };
  }

  componentDidCatch(error: unknown) {
    console.error("Unhandled UI error:", error);
    const err = error instanceof Error ? error : new Error(String(error));
    const url = window.location.href.replace(/\?.*$/, "").replace(/token=[^&\s]+/gi, "token=***");
    api.reportClientError({
      message: err.message,
      stack: err.stack,
      page: url
    }).catch(() => undefined);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    const { title, description, reload } = getErrorBoundaryStrings();

    return (
      <div className="page" style={{ justifyContent: "center", minHeight: "100dvh" }}>
        <div className="card error-box" style={{ maxWidth: 560, margin: "0 auto" }}>
          <h2 style={{ marginBottom: 10 }}>{title}</h2>
          <p style={{ marginBottom: 14 }}>{description}</p>
          {this.state.message && (
            <p style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, wordBreak: "break-word", marginBottom: 14 }}>
              {this.state.message}
            </p>
          )}
          <button className="btn primary" onClick={this.handleReload}>{reload}</button>
        </div>
      </div>
    );
  }
}
