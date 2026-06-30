import { Switch, Route } from "wouter";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import NotFound from "@/pages/not-found";
  import { Home } from "./pages/Home";
  import { useEffect, Component, type ReactNode } from "react";

  const queryClient = new QueryClient();

  class ErrorBoundary extends Component<
    { children: ReactNode },
    { error: Error | null }
  > {
    constructor(props: { children: ReactNode }) {
      super(props);
      this.state = { error: null };
    }
    static getDerivedStateFromError(error: Error) {
      return { error };
    }
    render() {
      if (this.state.error) {
        return (
          <div style={{ padding: "2rem", fontFamily: "monospace", color: "#f87171", background: "#0f172a", minHeight: "100vh" }}>
            <h2 style={{ color: "#ef4444", marginBottom: "1rem" }}>Erreur d'exécution</h2>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.875rem" }}>
              {this.state.error.message}{"\n\n"}{this.state.error.stack}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              style={{ marginTop: "1rem", padding: "0.5rem 1rem", background: "#1e40af", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
            >
              Réessayer
            </button>
          </div>
        );
      }
      return this.props.children;
    }
  }

  function App() {
    useEffect(() => {
      document.documentElement.classList.add("dark");
    }, []);

    return (
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <Switch>
            <Route path="/" component={Home} />
            <Route component={NotFound} />
          </Switch>
        </QueryClientProvider>
      </ErrorBoundary>
    );
  }

  export default App;
  