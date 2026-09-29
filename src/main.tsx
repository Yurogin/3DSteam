import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./lib/i18n";
import { IconStyleProvider } from "./lib/iconStyle";
import "./index.css";

// Pas de menu contextuel : le clic droit ne sert à rien ici, et le menu du navigateur
// (ou de WebView2) casse l'illusion d'une console. Le collage passe par les boutons dédiés.
addEventListener("contextmenu", (e) => e.preventDefault());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <IconStyleProvider>
        <App />
      </IconStyleProvider>
    </I18nProvider>
  </StrictMode>,
);
