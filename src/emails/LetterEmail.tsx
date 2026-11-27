import { Body, Button, Column, Container, Font, Head, Html, Img, Link, Preview, Row, Section, Text } from '@react-email/components';
import { site } from '../data/site.ts';
import type { Letter, Line } from '../server/letters.ts';
import { inSettings } from '../server/mailings.ts';

/*
 * The layout follows React Email's "Protocol" demo template (MIT, github.com/resend/react-email, apps/demo/emails/
 * 03-Protocol): a dark 640px column, a large headline, muted body text and a quiet footer. The type and wordmark are
 * the club's own, served from /email/ on the site.
 */
const HOME = `https://${site.domain}`;

const color = { page: '#212121', panel: '#131313', fg: '#FFFFFF', fg2: '#C4C4C4', fg3: '#818181', stroke: '#2B2B2B' };
const sans = "'Instrument Sans', Arial, sans-serif";
const serif = "'Geist Serif', Georgia, serif";

const styles = {
  body: { margin: 0, padding: 0, backgroundColor: color.page, fontFamily: sans },
  container: { maxWidth: '640px', margin: '0 auto', backgroundColor: color.panel },
  header: { padding: '24px 24px' },
  hero: { padding: '56px 24px 40px' },
  headline: { margin: 0, maxWidth: '490px', color: color.fg, fontFamily: serif, fontSize: '44px', lineHeight: '1.05', letterSpacing: '-1px', fontWeight: 400 },
  content: { padding: '0 24px 56px' },
  text: { margin: '0 0 16px', maxWidth: '520px', color: color.fg2, fontSize: '15px', lineHeight: '1.6' },
  button: { display: 'inline-block', margin: '8px 0 24px', padding: '14px 22px', backgroundColor: color.fg, color: color.panel, fontSize: '15px', fontWeight: 600, textDecoration: 'none' },
  link: { color: color.fg, textDecoration: 'underline', wordBreak: 'break-all' as const },
  footer: { padding: '40px 24px 48px', borderTop: `1px solid ${color.stroke}` },
  tagline: { margin: '0 0 24px', maxWidth: '320px', color: color.fg2, fontSize: '13px', lineHeight: '1.5' },
  small: { margin: '0 0 8px', color: color.fg3, fontSize: '11px', lineHeight: '1.5', letterSpacing: '0.3px' },
  quiet: { color: color.fg3, textDecoration: 'underline' },
  steps: { margin: '8px 0 24px', maxWidth: '520px' },
  step: { borderTop: `1px solid ${color.stroke}` },
  stepNo: { width: '56px', padding: '18px 0', verticalAlign: 'top' as const, color: color.fg3, fontFamily: serif, fontSize: '28px', lineHeight: '1' },
  stepBody: { padding: '18px 0', verticalAlign: 'top' as const },
  stepTitle: { color: color.fg, fontSize: '17px', fontWeight: 600, lineHeight: '1.3', textDecoration: 'none' },
  stepDetail: { margin: '4px 0 0', color: color.fg2, fontSize: '14px', lineHeight: '1.5' },
};

/** Narrow screens: tighter gutters and a smaller headline. Clients that ignore it keep the desktop sizes. */
const mobile = `@media (max-width: 600px) {
  .gutter { padding-left: 16px !important; padding-right: 16px !important; }
  .headline { font-size: 32px !important; }
}`;

/**
/** Every email the club sends, in one layout. The subject is the headline; the lines are the body (see Line). */
export function LetterEmail({ subject, lines, unsubscribe }: { subject: string; lines: readonly Line[]; unsubscribe?: Letter['unsubscribe'] }) {
  const preview = lines.find((line, i): line is string => typeof line === 'string' && i > 0) ?? subject;
  return (
    <Html lang="en-GB">
      <Head>
        <Font fontFamily="Geist Serif" fallbackFontFamily="Georgia" webFont={{ url: `${HOME}/email/geist-serif-normal.woff2`, format: 'woff2' }} fontWeight={400} fontStyle="normal" />
        <Font fontFamily="Instrument Sans" fallbackFontFamily="Arial" webFont={{ url: `${HOME}/email/instrument-sans-normal-latin.woff2`, format: 'woff2' }} fontWeight={400} fontStyle="normal" />
        <style>{mobile}</style>
      </Head>
      <Body style={styles.body}>
        <Preview>{preview}</Preview>
        <Container style={styles.container}>
          <Section style={styles.header} className="gutter">
            <Link href={HOME}>
              <Img src={`${HOME}/email/wordmark.png`} alt={site.name} width="160" height="37" style={{ display: 'block' }} />
            </Link>
          </Section>
          <Section style={styles.hero} className="gutter">
            <Text style={styles.headline} className="headline">{subject}</Text>
          </Section>
          <Section style={styles.content} className="gutter">
            {lines.map((line, i) =>
              typeof line === 'string' ? (
                <Text key={i} style={styles.text}>{line}</Text>
              ) : 'steps' in line ? (
                <Section key={i} style={styles.steps}>
                  {line.steps.map((step, n) => (
                    <Row key={step.href} style={styles.step}>
                      <Column style={styles.stepNo}>{String(n + 1).padStart(2, '0')}</Column>
                      <Column style={styles.stepBody}>
                        <Link href={step.href} style={styles.stepTitle}>{step.title}</Link>
                        <Text style={styles.stepDetail}>{step.detail}</Text>
                      </Column>
                    </Row>
                  ))}
                </Section>
              ) : line.label ? (
                <Button key={i} href={line.href} style={styles.button}>{line.label}</Button>
              ) : line.text ? (
                <Text key={i} style={styles.text}>
                  <Link href={line.href} style={styles.link}>{line.text}</Link>
                </Text>
              ) : (
                <Text key={i} style={styles.text}>
                  <Link href={line.href} style={styles.link}>{line.href}</Link>
                </Text>
              ),
            )}
          </Section>
          <Section style={styles.footer} className="gutter">
            <Text style={styles.tagline}>{site.tagline}</Text>
            <Text style={styles.small}>
              <Link href={HOME} style={styles.quiet}>{site.domain}</Link>
            </Text>
            {unsubscribe && (
              <Text style={styles.small}>
                <Link href={unsubscribe.url} style={styles.quiet}>Stop these emails</Link>
                {inSettings(unsubscribe.list) && (
                  <>
                    , or <Link href={`${HOME}/members/account#email`} style={styles.quiet}>choose which you get</Link>
                  </>
                )}
                .
              </Text>
            )}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
