import LegalPageLayout from "../components/LegalPageLayout";
import { LEGAL_CONTACT } from "../content/legal";

export default function LegalTermsPage() {
  return (
    <LegalPageLayout
      title="Terms of Use"
      intro="These rules govern the use of Screen Ping. By using the service, you agree to follow them."
    >
      <section className="space-y-2">
        <h2 className="section-heading">Allowed use</h2>
        <p>
          Screen Ping lets users who have added each other as friends send multimedia content to their
          contacts&apos; desktop app.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="section-heading">Prohibited use</h2>
        <ul className="list-inside list-disc space-y-1 text-slate-300">
          <li>harass, threaten, spam, or bypass another user&apos;s consent;</li>
          <li>send illegal, violent, hateful, non-consensual sexual content, or content that harms minors;</li>
          <li>impersonate someone else or infringe copyright and related rights;</li>
          <li>attempt to disrupt the service, bypass limits, blocks, or security mechanisms.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="section-heading">Your responsibility</h2>
        <p>
          You are solely responsible for the content you import, store, or send, and for the
          consequences of how you use the service. You confirm that you have the rights and permissions required.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="section-heading">Moderation and suspension</h2>
        <p>
          The publisher may suspend, limit, or delete an account or access to the service in case of abusive
          behavior, a credible report, a legal obligation, or a risk to the platform&apos;s security.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="section-heading">Availability and limits</h2>
        <p>
          The service is provided as is, with technical limits, possible interruptions, and no guarantee of
          continuous availability. The publisher takes reasonable security measures but does not guarantee
          there will never be an incident or misuse by third parties.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="section-heading">Age and capacity</h2>
        <p>
          You must have the legal capacity to accept these terms and to use the service in your country.
          If a minimum age applies in your jurisdiction, you must respect it.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="section-heading">Contact and reports</h2>
        <p>
          Reports and legal requests can be sent to{" "}
          <a className="text-brand-300 underline" href={`mailto:${LEGAL_CONTACT.abuseEmail}`}>{LEGAL_CONTACT.abuseEmail}</a>.
        </p>
      </section>
    </LegalPageLayout>
  );
}
