import type { PDFDocument } from '@cantoo/pdf-lib';
import { getOpenPdf } from './documents';

export type FieldValue = string | boolean | string[];

export interface FormField {
  name: string;
  /** Readable label: the last part of the field's name, with separators turned into spaces. */
  label: string;
  kind: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list';
  options: string[];
  multiline: boolean;
  multiSelect: boolean;
  readOnly: boolean;
  value: FieldValue;
}

export interface FormInfo {
  fields: FormField[];
  /** XFA forms (made with Adobe LiveCycle) are a different technology that browsers cannot fill. */
  xfa: boolean;
}

function labelFor(name: string): string {
  const last = name.split('.').pop() ?? name;
  return last.replace(/\[\d+\]$/, '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || name;
}

/** Lists the fillable fields of an open PDF, with their current values. Signature and button fields are left out. */
export async function readForm(sourceId: string): Promise<FormInfo> {
  const lib = await import('@cantoo/pdf-lib');
  const form = getOpenPdf(sourceId).edit.getForm();
  const fields: FormField[] = [];
  for (const field of form.getFields()) {
    const name = field.getName();
    const base = { name, label: labelFor(name), readOnly: field.isReadOnly(), options: [] as string[], multiline: false, multiSelect: false };
    if (field instanceof lib.PDFTextField) {
      fields.push({ ...base, kind: 'text', multiline: field.isMultiline(), value: field.getText() ?? '' });
    } else if (field instanceof lib.PDFCheckBox) {
      fields.push({ ...base, kind: 'checkbox', value: field.isChecked() });
    } else if (field instanceof lib.PDFRadioGroup) {
      fields.push({ ...base, kind: 'radio', options: field.getOptions(), value: field.getSelected() ?? '' });
    } else if (field instanceof lib.PDFDropdown) {
      fields.push({ ...base, kind: 'dropdown', options: field.getOptions(), value: field.getSelected()[0] ?? '' });
    } else if (field instanceof lib.PDFOptionList) {
      fields.push({ ...base, kind: 'list', options: field.getOptions(), multiSelect: field.isMultiselect(), value: field.getSelected() });
    }
  }
  return { fields, xfa: form.hasXFA() };
}

export class FormFillError extends Error {
  constructor(readonly field: string, detail: string) {
    super(detail);
    this.name = 'FormFillError';
  }
}

/**
 * A copy of the PDF with the values filled in and the form flattened: the answers become part of
 * the page, so they show the same in every viewer and survive merging with other files.
 */
export async function filledCopy(sourceId: string, values: Record<string, FieldValue>): Promise<PDFDocument> {
  const lib = await import('@cantoo/pdf-lib');
  // The open document is already decrypted, so its saved bytes load without a password.
  const copy = await lib.PDFDocument.load(await getOpenPdf(sourceId).edit.save(), { updateMetadata: false });
  const form = copy.getForm();
  for (const [name, value] of Object.entries(values)) {
    try {
      const field = form.getField(name);
      if (field instanceof lib.PDFTextField && typeof value === 'string') {
        field.setText(value);
      } else if (field instanceof lib.PDFCheckBox) {
        if (value) field.check();
        else field.uncheck();
      } else if (field instanceof lib.PDFRadioGroup && typeof value === 'string' && value) {
        field.select(value);
      } else if (field instanceof lib.PDFDropdown && typeof value === 'string') {
        if (value) field.select(value);
        else field.clear();
      } else if (field instanceof lib.PDFOptionList && Array.isArray(value)) {
        if (value.length) field.select(value);
        else field.clear();
      }
    } catch (e) {
      throw new FormFillError(name, String(e));
    }
  }
  try {
    form.flatten();
  } catch (e) {
    // Most often text the standard PDF font cannot draw, such as non-Latin scripts.
    throw new FormFillError('', String(e));
  }
  return copy;
}
