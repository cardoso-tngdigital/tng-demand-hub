import { AuthProvider, useAuth } from "./hooks/useAuth";
import { LoginScreen } from "./screens/LoginScreen";
import { WelcomeScreen } from "./screens/WelcomeScreen";

function AppRouter() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-tng-marine-900">
        <div className="text-sm text-tng-marine-300">Carregando…</div>
      </div>
    );
  }

  return session ? <WelcomeScreen /> : <LoginScreen />;
}

function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}

export default App;
