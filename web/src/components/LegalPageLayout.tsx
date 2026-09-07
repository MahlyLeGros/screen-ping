import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getAccessToken } from "../lib/api";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import LegalLinks from "./LegalLinks";
import SkipLink from "./SkipLink";

interface LegalPageLayoutProps {
  title: string;
  intro: string;
  children: ReactNode;
}

export default function LegalPageLayout({ title, intro, children }: LegalPageLayoutProps) {
  useDocumentTitle(title);
  const navigate = useNavigate();
  const access = getAccessToken();

  function goBack() {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(access ? "/" : "/login");
  }

  return (
    /* app-bg uses overflow-hidden for the dashboard; legal pages must scroll. */
    <div className="app-bg overflow-y-auto overflow-x-hidden">
      <SkipLink />
      <header className="app-header">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
          <p className="brand-glow font-display text-lg font-extrabold tracking-tight">
            <Link to={access ? "/" : "/login"} className="flex items-center gap-2" aria-label="Screen Ping home">
              <img
                src="/logo.png"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 select-none"
                draggable={false}
              />
              <span>Screen Ping</span>
            </Link>
          </p>
          <button type="button" onClick={goBack} className="btn-ghost">
            Back
          </button>
        </div>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-5xl flex-none px-3 py-3 sm:px-4 sm:py-4">
        <div className="mx-auto max-w-3xl space-y-4 pb-8">
          <div className="flex justify-center">
            <LegalLinks />
          </div>
          <article className="panel space-y-5 p-5 sm:p-6">
            <header className="space-y-2">
              <h1 className="font-display text-2xl font-bold text-white">{title}</h1>
              <p className="text-sm text-slate-400">{intro}</p>
            </header>
            <div className="space-y-5 text-sm leading-7 text-slate-200">{children}</div>
          </article>
        </div>
      </main>
    </div>
  );
}
