import { Link } from "react-router-dom";

import LegalLinks from "../components/LegalLinks";
import SkipLink from "../components/SkipLink";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function NotFoundPage() {
  useDocumentTitle("Page not found");

  return (
    <div className="app-bg flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <SkipLink />
      <main id="main-content" className="panel w-full max-w-md space-y-5 p-6 text-center">
        <p className="font-display text-6xl font-extrabold text-brand-400">404</p>
        <h1 className="font-display text-xl font-bold text-white">Page not found</h1>
        <p className="text-sm text-slate-400">
          This link does not exist or may have moved. Check the URL or go back to Screen Ping.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link to="/" className="btn-primary">
            Go to dashboard
          </Link>
          <Link to="/login" className="btn-secondary">
            Log in
          </Link>
        </div>
        <LegalLinks className="justify-center pt-2" />
      </main>
    </div>
  );
}
