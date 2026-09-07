import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ForgotPasswordPage from "./pages/ForgotPassword";
import Layout from "./components/Layout";
import DashboardPage from "./pages/Dashboard";
import LegalAbusePage from "./pages/LegalAbuse";
import LegalAcceptancePage from "./pages/LegalAcceptance";
import LegalMentionsPage from "./pages/LegalMentions";
import LegalPaymentsPage from "./pages/LegalPayments";
import LegalPrivacyPage from "./pages/LegalPrivacy";
import LegalTermsPage from "./pages/LegalTerms";
import LinkDesktopPage from "./pages/LinkDesktop";
import LoginPage from "./pages/Login";
import NotFoundPage from "./pages/NotFoundPage";
import ResetPasswordPage from "./pages/ResetPassword";
import SettingsPage from "./pages/Settings";
import { startIridescentFill } from "./lib/iridescentFill";
import "./index.css";

startIridescentFill();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/link-desktop" element={<LinkDesktopPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/mentions-legales" element={<LegalMentionsPage />} />
        <Route path="/cgu" element={<LegalTermsPage />} />
        <Route path="/privacy" element={<LegalPrivacyPage />} />
        <Route path="/abuse" element={<LegalAbusePage />} />
        <Route path="/payments" element={<LegalPaymentsPage />} />
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/legal/acceptance" element={<LegalAcceptancePage />} />
          <Route path="/send" element={<Navigate to="/" replace />} />
          <Route path="/friends" element={<Navigate to="/" replace />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
