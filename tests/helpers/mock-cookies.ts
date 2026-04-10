export interface StoredCookie {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

export interface MockCookieStore {
  get: (name: string) => { name: string; value: string } | undefined;
  set: (
    name: string,
    value: string,
    options?: Record<string, unknown>,
  ) => void;
  delete: (name: string) => void;
  has: (name: string) => boolean;
  snapshot: () => StoredCookie[];
}

export function createMockCookieStore(
  initial: StoredCookie[] = [],
): MockCookieStore {
  const cookies = new Map(
    initial.map((entry) => [entry.name, { value: entry.value, options: entry.options }]),
  );

  return {
    get(name) {
      const entry = cookies.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set(name, value, options) {
      cookies.set(name, { value, options });
    },
    delete(name) {
      cookies.delete(name);
    },
    has(name) {
      return cookies.has(name);
    },
    snapshot() {
      return [...cookies.entries()].map(([name, entry]) => ({
        name,
        value: entry.value,
        options: entry.options,
      }));
    },
  };
}
