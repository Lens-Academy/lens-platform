import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";

// Prefix title with environment label (e.g., "ONE - Lens Academy")
const envLabel = import.meta.env.VITE_ENV_LABEL;
if (envLabel) {
  document.title = `${envLabel} - ${document.title}`;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
