import { Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./views/Loginpage";
import ResearchApp from "./views/ResearchApp";
import SettingsPage from "./views/Settingspage";
import { useAuth } from "./state/auth";

export default function AppRoutes() {
  const { session } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/app"
        element={session ? <ResearchApp /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/settings"
        element={session ? <SettingsPage /> : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<Navigate to={session ? "/app" : "/login"} replace />} />
    </Routes>
  );
}