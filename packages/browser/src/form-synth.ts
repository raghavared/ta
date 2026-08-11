import { Faker, en } from '@faker-js/faker';

export type FieldKind =
  | 'email'
  | 'password'
  | 'phone'
  | 'date'
  | 'url'
  | 'number'
  | 'name'
  | 'search'
  | 'address'
  | 'text';

export interface FieldMeta {
  type?: string;
  name?: string;
  placeholder?: string;
  label?: string;
  autocomplete?: string;
}

/** Deterministic field classifier — no LLM for the common cases. */
export function classifyField(meta: FieldMeta): FieldKind {
  const type = (meta.type ?? '').toLowerCase();
  if (type === 'email') return 'email';
  if (type === 'password') return 'password';
  if (type === 'tel') return 'phone';
  if (type === 'date' || type === 'datetime-local') return 'date';
  if (type === 'url') return 'url';
  if (type === 'number') return 'number';
  if (type === 'search') return 'search';
  const hints = `${meta.autocomplete ?? ''} ${meta.name ?? ''} ${meta.placeholder ?? ''} ${meta.label ?? ''}`.toLowerCase();
  if (/e-?mail/.test(hints)) return 'email';
  if (/pass(word)?/.test(hints)) return 'password';
  if (/phone|mobile|tel\b/.test(hints)) return 'phone';
  if (/date|dob|birthday/.test(hints)) return 'date';
  if (/\burl|website|link/.test(hints)) return 'url';
  if (/amount|qty|quantity|count|price/.test(hints)) return 'number';
  if (/(first|last|full|user)\s*name|^name$/.test(hints)) return 'name';
  if (/search|query|filter/.test(hints)) return 'search';
  if (/address|city|street|zip|postal/.test(hints)) return 'address';
  return 'text';
}

export class FormSynth {
  private faker: Faker;

  constructor(seed: number) {
    this.faker = new Faker({ locale: [en] });
    this.faker.seed(seed);
  }

  valueFor(kind: FieldKind): string {
    switch (kind) {
      case 'email':
        return this.faker.internet.email().toLowerCase();
      case 'password':
        return 'Ta-Test-Pass-1!';
      case 'phone':
        return '5551234567';
      case 'date':
        return '2026-09-15';
      case 'url':
        return 'https://example.com';
      case 'number':
        return String(this.faker.number.int({ min: 1, max: 20 }));
      case 'name':
        return this.faker.person.fullName();
      case 'search':
        return this.faker.word.noun();
      case 'address':
        return this.faker.location.streetAddress();
      case 'text':
        return this.faker.lorem.words(3);
    }
  }
}
