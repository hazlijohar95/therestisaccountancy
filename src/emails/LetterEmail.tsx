import { Body, Button, Container, Head, Hr, Html, Link, Preview, Section, Text } from '@react-email/components';
import { site } from '../data/site.ts';
import type { Line } from '../server/letters.ts';

const ink = '#000000';
const paper = '#ffffff';
const muted = '#555555';
const sans = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const serif = "Georgia, 'Times New Roman', serif";

const styles = {
  body: { margin: 0, padding: '32px 0', backgroundColor: paper, color: ink, fontFamily: sans },
  container: { maxWidth: '560px', margin: '0 auto', padding: '0 24px' },
  mark: { margin: '0 0 24px', paddingBottom: '16px', borderBottom: `2px solid ${ink}`, fontFamily: serif, fontSize: '22px', lineHeight: '1.2' },
  text: { margin: '0 0 16px', fontSize: '16px', lineHeight: '1.55' },
  button: { display: 'inline-block', margin: '0 0 16px', padding: '12px 20px', backgroundColor: ink, color: paper, fontSize: '15px', fontWeight: 600, textDecoration: 'none' },
  link: { color: ink, textDecoration: 'underline', wordBreak: 'break-all' as const },
  rule: { margin: '24px 0 16px', borderColor: ink },
  footer: { margin: 0, color: muted, fontSize: '13px', lineHeight: '1.5' },
};

/**
 * Every email the club sends, in one layout. Lines are typed text, which React escapes and never links, or links the
 * club built: with a label they become a button, without one they show the address itself.
 */
export function LetterEmail({ subject, lines, unsubscribe }: { subject: string; lines: readonly Line[]; unsubscribe?: string | undefined }) {
  const preview = lines.find((line, i): line is string => typeof line === 'string' && i > 0) ?? subject;
  return (
    <Html lang="en-GB">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.mark}>{site.name}</Text>
          {lines.map((line, i) =>
            typeof line === 'string' ? (
              <Text key={i} style={styles.text}>{line}</Text>
            ) : line.label ? (
              <Section key={i}>
                <Button href={line.href} style={styles.button}>{line.label}</Button>
              </Section>
            ) : (
              <Text key={i} style={styles.text}>
                <Link href={line.href} style={styles.link}>{line.href}</Link>
              </Text>
            ),
          )}
          <Hr style={styles.rule} />
          <Text style={styles.footer}>
            {site.name} · <Link href="https://better-accountant.com" style={styles.link}>better-accountant.com</Link>
            {unsubscribe && (
              <>
                {' · '}
                <Link href={unsubscribe} style={styles.link}>Stop these emails</Link>
              </>
            )}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
