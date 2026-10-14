function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

// Read lazily so unit tests can import modules without the full env.
export const tables = {
  get patients() {
    return required("PATIENTS_TABLE");
  },
  get encounters() {
    return required("ENCOUNTERS_TABLE");
  },
  get steps() {
    return required("STEPS_TABLE");
  },
  get actions() {
    return required("ACTIONS_TABLE");
  },
  get audit() {
    return required("AUDIT_TABLE");
  },
};

export const env = { required };
