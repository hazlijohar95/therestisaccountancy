/* The club's name and description. Kept apart from the page copy so server code can use it without the page's images. */
export const site = {
  name: 'The Rest Is Accountancy',
  title: "The Rest Is Accountancy · A members' club for accountants",
  description: "A members' club for accountants who run a practice, or mean to. Pricing, clients, advisory and AI: the part the syllabus left out, worked through together.",
  tagline: 'Club, membership and community for accountants.',
  /** The host who signs the emails that come from a person. Replies reach club@, which forwards to the hosts. */
  host: 'Hazli',
} as const;
