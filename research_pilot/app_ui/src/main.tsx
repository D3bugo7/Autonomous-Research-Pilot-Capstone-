import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./routes";
import "./index.css";
import { AuthProvider } from "./state/auth";
import { SettingsProvider } from "./state/settings";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <React.StrictMode>
      <SettingsProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
     </SettingsProvider>
    </React.StrictMode>
  </AuthProvider>
);