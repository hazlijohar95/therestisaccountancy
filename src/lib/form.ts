/**
 * The fields of a form that was just posted to this page, so a refused submission can be shown back to the person who
 * typed it. Astro's form actions read a clone of the request, so the original body is still unread here.
 */
export const postedFields = async (request: Request): Promise<(name: string) => string> => {
  if (request.method !== 'POST') return () => '';
  try {
    const form = await request.formData();
    return (name) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
  } catch {
    return () => '';
  }
};

/** Every value of a field that was just posted, such as a group of checkboxes. Read the request once: call this or postedFields. */
export const postedValues = async (request: Request): Promise<{ one: (name: string) => string; all: (name: string) => string[] }> => {
  const form = request.method === 'POST' ? await request.formData().catch(() => null) : null;
  const strings = (name: string) => (form?.getAll(name) ?? []).filter((value): value is string => typeof value === 'string');
  return { one: (name) => strings(name)[0] ?? '', all: strings };
};
