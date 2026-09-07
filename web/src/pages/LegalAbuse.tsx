import LegalPageLayout from "../components/LegalPageLayout";
import { LEGAL_CONTACT } from "../content/legal";

export default function LegalAbusePage() {
  return (
    <LegalPageLayout
      title="Report abuse"
      intro="If you are dealing with harassment, illegal content, impersonation, or non-consensual use, use the in-app tools first, then contact the publisher."
    >
      <section className="space-y-2">
        <h2 className="section-heading">First steps</h2>
        <ul className="list-inside list-disc space-y-1 text-slate-300">
          <li>block the user in the Friends tab;</li>
          <li>keep useful details: username, time, and type of content received;</li>
          <li>if needed, quit the desktop app and change your password.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="section-heading">How to report</h2>
        <p>
          Email{" "}
          <a className="text-brand-300 underline" href={`mailto:${LEGAL_CONTACT.abuseEmail}?subject=Screen%20Ping%20report`}>
            {LEGAL_CONTACT.abuseEmail}
          </a>{" "}
          with as much detail as possible: the account involved, date/time, a description, and screenshots if you have them.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="section-heading">Possible actions</h2>
        <p>
          Depending on the report, the publisher may block an account, suspend access, delete associated
          data, or cooperate with legal requests.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="section-heading">Deletion and privacy</h2>
        <p>
          To request account or personal-data deletion, use the dedicated section in Settings or contact{" "}
          <a className="text-brand-300 underline" href={`mailto:${LEGAL_CONTACT.privacyEmail}`}>{LEGAL_CONTACT.privacyEmail}</a>.
        </p>
      </section>
    </LegalPageLayout>
  );
}
