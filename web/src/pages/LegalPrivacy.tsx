import LegalPageLayout from "../components/LegalPageLayout";
import { DATA_RETENTION, LEGAL_CONTACT } from "../content/legal";

export default function LegalPrivacyPage() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      intro="This page explains what data Screen Ping processes, why, and how to ask for help, deletion, or correction."
    >
      <section className="space-y-2">
        <h2 className="section-heading">Data we process</h2>
        <ul className="list-inside list-disc space-y-1 text-slate-300">
          <li>Account: username, email, hashed password, optional Google account link, avatar, creation date, and email verification status.</li>
          <li>Social graph: friend requests, accepted friends, blocks, online presence, and AFK status.</li>
          <li>Content: images, videos, sounds, captions, and send history between authorized users.</li>
          <li>Security: session tokens, anti-abuse limits, verification codes, and reasonable technical logs.</li>
          <li>Local storage: login tokens in the browser and ping drafts saved locally.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="section-heading">Purposes</h2>
        <ul className="list-inside list-disc space-y-1 text-slate-300">
          <li>Provide the core service of sending and receiving multimedia pings.</li>
          <li>Secure accounts, limit spam, and prevent abusive use.</li>
          <li>Allow account creation, recovery, and sensitive changes via email verification codes.</li>
          <li>Let you sign in with Google. Google then shares your verified email and a Google account id.</li>
          <li>Deliver pings in real time and show friends&apos; presence status.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="section-heading">Retention</h2>
        <p>
          Temporary media is intended to expire after about <strong>{DATA_RETENTION.mediaTtlHours} hours</strong>.
          Refresh tokens may remain valid for up to <strong>{DATA_RETENTION.refreshTokenDays} days</strong>.
          Verification codes generally expire after <strong>{DATA_RETENTION.verificationCodeMinutes} minutes</strong>.
        </p>
        <p>
          Some account and history data may be kept while the account exists, or for as long as needed for
          security, moderation, and normal operation of the service.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="section-heading">Sharing and hosting</h2>
        <p>
          Data is shared only with the components needed to run the service, including hosting,
          authentication, and email delivery. Media is intended to be accessible only to parties authorized
          by the service.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="section-heading">Your rights</h2>
        <p>
          To request deletion, correction, or ask a privacy question, contact{" "}
          <a className="text-brand-300 underline" href={`mailto:${LEGAL_CONTACT.privacyEmail}`}>{LEGAL_CONTACT.privacyEmail}</a>.
        </p>
        <p>
          An account-deletion feature is also available in account settings.
        </p>
      </section>
    </LegalPageLayout>
  );
}
