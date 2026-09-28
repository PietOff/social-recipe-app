import React, { useState } from 'react';
import { Ingredient, Recipe } from '../types';
import { labelText, labelValueFromText, useLang } from '../lib/i18n';
import pageStyles from '../app/page.module.css';
import styles from './extras.module.css';

interface Props {
  recipe: Recipe;
  onSave: (updated: Recipe) => Promise<void> | void;
  onCancel: () => void;
}

interface Row extends Ingredient {
  /** Stable React key: rows can be added and removed in the middle. */
  rowId: number;
}

let nextRowId = 1;
const toRows = (ingredients: Ingredient[]): Row[] =>
  ingredients.map(ing => ({ ...ing, rowId: nextRowId++ }));

/**
 * Edits a recipe in place: for when the AI got an amount, a step or the title
 * wrong. Tags are shown in the UI language and stored back in English.
 */
export default function RecipeEditor({ recipe, onSave, onCancel }: Props) {
  const { t, lang } = useLang();
  const [title, setTitle] = useState(recipe.title || '');
  const [description, setDescription] = useState(recipe.description || '');
  const [prep, setPrep] = useState(recipe.prep_time || '');
  const [cook, setCook] = useState(recipe.cook_time || '');
  const [servings, setServings] = useState(recipe.servings || '');
  const [tags, setTags] = useState((recipe.tags || []).map(tag => labelText(tag, lang)).join(', '));
  const [rows, setRows] = useState<Row[]>(() => toRows(recipe.ingredients || []));
  const [steps, setSteps] = useState((recipe.instructions || []).join('\n'));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const updateRow = (rowId: number, patch: Partial<Ingredient>) =>
    setRows(prev => prev.map(r => (r.rowId === rowId ? { ...r, ...patch } : r)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setProblem(t.errTitleRequired);
      return;
    }
    const lastGroup = rows.length ? rows[rows.length - 1].group : undefined;
    const updated: Recipe = {
      ...recipe,
      title: title.trim(),
      description: description.trim(),
      prep_time: prep.trim() || undefined,
      cook_time: cook.trim() || undefined,
      servings: servings.trim() || undefined,
      tags: tags.split(',').map(tag => labelValueFromText(tag, lang)).filter(Boolean),
      ingredients: rows
        .filter(r => (r.item || '').trim())
        .map(({ rowId, ...ing }) => ({
          ...ing,
          item: (ing.item || '').trim(),
          amount: (ing.amount || '').trim(),
          unit: (ing.unit || '').trim(),
          group: ing.group || lastGroup,
        })),
      instructions: steps.split('\n').map(s => s.trim()).filter(Boolean),
    };
    setSaving(true);
    setProblem(null);
    try {
      await onSave(updated);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <h2 style={{ margin: 0 }}>{t.editRecipe}</h2>

      <label className={styles.field}>
        {t.fieldTitle}
        <input value={title} onChange={e => setTitle(e.target.value)} required />
      </label>

      <label className={styles.field}>
        {t.fieldDescription}
        <textarea value={description} onChange={e => setDescription(e.target.value)} style={{ minHeight: '4.5rem' }} />
      </label>

      <div className={styles.threeCols}>
        <label className={styles.field}>
          {t.fieldPrep}
          <input value={prep} onChange={e => setPrep(e.target.value)} />
        </label>
        <label className={styles.field}>
          {t.fieldCook}
          <input value={cook} onChange={e => setCook(e.target.value)} />
        </label>
        <label className={styles.field}>
          {t.fieldServings}
          <input value={servings} onChange={e => setServings(e.target.value)} />
        </label>
      </div>

      <label className={styles.field}>
        {t.fieldTags}
        <input value={tags} onChange={e => setTags(e.target.value)} />
      </label>

      <div className={styles.field}>
        {t.ingredients}
        <div className={styles.rows}>
          {rows.map(row => (
            <div key={row.rowId} className={styles.row}>
              <input
                value={row.amount || ''}
                onChange={e => updateRow(row.rowId, { amount: e.target.value })}
                placeholder={t.fieldAmount}
                aria-label={t.fieldAmount}
              />
              <input
                value={row.unit || ''}
                onChange={e => updateRow(row.rowId, { unit: e.target.value })}
                placeholder={t.fieldUnit}
                aria-label={t.fieldUnit}
              />
              <input
                value={row.item || ''}
                onChange={e => updateRow(row.rowId, { item: e.target.value })}
                placeholder={t.fieldItem}
                aria-label={t.fieldItem}
              />
              <button
                type="button"
                className={styles.removeRow}
                onClick={() => setRows(prev => prev.filter(r => r.rowId !== row.rowId))}
                aria-label={t.removeIngredient}
                title={t.removeIngredient}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className={styles.linkButton}
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setRows(prev => [...prev, ...toRows([{ item: '', amount: '', unit: '', group: prev[prev.length - 1]?.group }])])}
        >
          {t.addIngredient}
        </button>
      </div>

      <label className={styles.field}>
        {t.fieldSteps}
        <textarea value={steps} onChange={e => setSteps(e.target.value)} style={{ minHeight: '10rem' }} />
      </label>

      {problem && <p className={styles.formError} role="alert">{problem}</p>}

      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onCancel} disabled={saving}>
          {t.cancel}
        </button>
        <button type="submit" className={pageStyles.button} disabled={saving}>
          {saving ? t.savingChanges : t.saveChanges}
        </button>
      </div>
    </form>
  );
}
