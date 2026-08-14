import { Recipe, Ingredient } from '../types';

/**
 * PDF / print export.
 *
 * Instead of calling `window.print()` on the live app (dark theme, glass
 * panels, global "nuclear reset" print CSS - fragile and broken in several
 * mobile browsers), we build a clean, self-contained printable document and
 * print it from a hidden same-origin iframe. The browser's print dialog then
 * offers "Save as PDF" everywhere, and the output is identical across views.
 */

export interface ExportOptions {
    /** Cookbook mode: cover page + table of contents + recipes grouped by category. */
    cookbook?: boolean;
    /** Title used on the cover page / document title. */
    title?: string;
}

/** Canonical meal ordering used to arrange cookbook chapters logically. */
const MEAL_ORDER = ['Breakfast', 'Brunch', 'Lunch', 'Dinner', 'Appetizer', 'Snack', 'Dessert', 'Drink'];

const FALLBACK_CATEGORY = 'More Recipes';

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function recipeTags(recipe: Recipe): string[] {
    if (recipe.tags && recipe.tags.length > 0) return recipe.tags;
    return recipe.category ? [recipe.category] : [];
}

/** Picks the chapter a recipe belongs to: first meal-type tag, else first tag. */
export function primaryCategory(recipe: Recipe): string {
    const tags = recipeTags(recipe);
    for (const meal of MEAL_ORDER) {
        if (tags.some(t => t.toLowerCase() === meal.toLowerCase())) return meal;
    }
    return tags[0] || FALLBACK_CATEGORY;
}

/** Groups recipes into chapters, meal types first, remaining categories A-Z. */
export function groupByCategory(recipes: Recipe[]): [string, Recipe[]][] {
    const groups = new Map<string, Recipe[]>();
    for (const recipe of recipes) {
        const cat = primaryCategory(recipe);
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat)!.push(recipe);
    }

    const mealRank = (cat: string) => {
        const i = MEAL_ORDER.findIndex(m => m.toLowerCase() === cat.toLowerCase());
        return i === -1 ? MEAL_ORDER.length : i;
    };

    return [...groups.entries()]
        .sort(([a], [b]) => {
            if (a === FALLBACK_CATEGORY) return 1;
            if (b === FALLBACK_CATEGORY) return -1;
            return mealRank(a) - mealRank(b) || a.localeCompare(b);
        })
        .map(([cat, list]) => [
            cat,
            [...list].sort((a, b) => (a.title || '').localeCompare(b.title || '')),
        ]);
}

function ingredientLine(ing: Ingredient): string {
    let amount = ing.amount || '';
    let unit = ing.unit || '';
    // "400g" + unit "g" would render as "400g g"
    if (unit && amount.toLowerCase().endsWith(unit.toLowerCase())) unit = '';
    const qty = [amount, unit].filter(Boolean).join(' ');
    const item = ing.item || '';
    return `<li>${qty ? `<b>${escapeHtml(qty)}</b> ` : ''}${escapeHtml(item)}</li>`;
}

function ingredientsHtml(recipe: Recipe): string {
    const ingredients = recipe.ingredients || [];
    const grouped = ingredients.reduce((acc, ing) => {
        const group = ing.group || 'Main';
        (acc[group] = acc[group] || []).push(ing);
        return acc;
    }, {} as Record<string, Ingredient[]>);

    const keys = Object.keys(grouped);
    const showHeaders = keys.length > 1 || (keys.length === 1 && keys[0] !== 'Main');

    return keys.map(group => `
        ${showHeaders ? `<h4>${escapeHtml(group)}</h4>` : ''}
        <ul>${grouped[group].map(ingredientLine).join('')}</ul>
    `).join('');
}

function metaHtml(recipe: Recipe): string {
    const parts: string[] = [];
    if (recipe.prep_time) parts.push(`<span><b>Prep</b> ${escapeHtml(recipe.prep_time)}</span>`);
    if (recipe.cook_time) parts.push(`<span><b>Cook</b> ${escapeHtml(recipe.cook_time)}</span>`);
    if (recipe.servings) parts.push(`<span><b>Serves</b> ${escapeHtml(recipe.servings)}</span>`);
    return parts.length ? `<div class="meta">${parts.join('')}</div>` : '';
}

function recipeArticle(recipe: Recipe, category?: string): string {
    const tags = recipeTags(recipe);
    const instructions = recipe.instructions || [];
    return `
    <article class="recipe">
        ${category ? `<div class="kicker">${escapeHtml(category)}</div>` : ''}
        <h2>${escapeHtml(recipe.title || 'Untitled recipe')}</h2>
        ${recipe.description ? `<p class="desc">${escapeHtml(recipe.description)}</p>` : ''}
        ${metaHtml(recipe)}
        ${tags.length ? `<div class="tags">${tags.map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="split">
            <section>
                <h3>Ingredients</h3>
                ${ingredientsHtml(recipe)}
            </section>
            <section>
                <h3>Instructions</h3>
                <ol>${instructions.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
            </section>
        </div>
        ${recipe.source_url ? `<div class="source">Source: ${escapeHtml(recipe.source_url)}</div>` : ''}
    </article>`;
}

const PRINT_CSS = `
    @page { size: A4 portrait; margin: 15mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Georgia, serif;
        color: #1c1c1c;
        background: #fff;
        font-size: 10.5pt;
        line-height: 1.5;
    }
    .page-break { break-before: page; page-break-before: always; }

    /* Cover */
    .cover { text-align: center; padding-top: 70mm; }
    .cover h1 { font-size: 34pt; line-height: 1.15; color: #d1451e; }
    .cover .sub { margin-top: 10pt; font-size: 12pt; color: #666; }

    /* Table of contents */
    .toc h2 { font-size: 20pt; margin-bottom: 12pt; color: #d1451e; }
    .toc h3 { font-size: 13pt; margin: 12pt 0 4pt; border-bottom: 1.5px solid #d1451e; padding-bottom: 2pt; }
    .toc ul { list-style: none; }
    .toc li { padding: 1.5pt 0; font-size: 10pt; }

    /* Chapter dividers */
    .chapter { text-align: center; padding-top: 90mm; }
    .chapter h2 { font-size: 26pt; color: #d1451e; }
    .chapter .count { margin-top: 6pt; color: #888; font-size: 11pt; }

    /* Recipe */
    .recipe .kicker { text-transform: uppercase; letter-spacing: 1.5px; font-size: 8.5pt; color: #d1451e; margin-bottom: 4pt; }
    .recipe h2 { font-size: 19pt; line-height: 1.2; margin-bottom: 5pt; }
    .recipe .desc { color: #444; margin-bottom: 8pt; }
    .recipe .meta { display: flex; gap: 14pt; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; padding: 5pt 0; margin-bottom: 7pt; font-size: 9.5pt; }
    .recipe .meta b { color: #d1451e; margin-right: 3pt; font-weight: 600; }
    .recipe .tags { display: flex; flex-wrap: wrap; gap: 4pt; margin-bottom: 9pt; }
    .recipe .tags span { border: 1px solid #ccc; border-radius: 10pt; padding: 1pt 7pt; font-size: 8pt; color: #555; }
    .recipe .split { display: grid; grid-template-columns: 1fr 1.5fr; gap: 8mm; }
    .recipe h3 { font-size: 12pt; border-bottom: 1.5px solid #1c1c1c; padding-bottom: 2pt; margin-bottom: 5pt; }
    .recipe h4 { font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.5px; color: #d1451e; margin: 6pt 0 2pt; }
    .recipe ul, .recipe ol { padding-left: 13pt; }
    .recipe li { margin-bottom: 2.5pt; font-size: 9.5pt; }
    .recipe ol li { margin-bottom: 5pt; }
    .recipe .source { margin-top: 10pt; font-size: 8pt; color: #999; word-break: break-all; }
`;

/** Builds the full standalone HTML document for a set of recipes. */
export function buildPrintDocument(recipes: Recipe[], opts: ExportOptions = {}): string {
    const title = opts.title || (recipes.length === 1 ? recipes[0].title : 'My Cookbook');
    const parts: string[] = [];

    if (opts.cookbook && recipes.length > 1) {
        const chapters = groupByCategory(recipes);
        const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

        parts.push(`
        <div class="cover">
            <h1>${escapeHtml(title)}</h1>
            <div class="sub">${recipes.length} recipes &middot; ${escapeHtml(date)}</div>
        </div>`);

        parts.push(`
        <div class="toc page-break">
            <h2>Contents</h2>
            ${chapters.map(([cat, list]) => `
                <h3>${escapeHtml(cat)}</h3>
                <ul>${list.map(r => `<li>${escapeHtml(r.title || 'Untitled recipe')}</li>`).join('')}</ul>
            `).join('')}
        </div>`);

        for (const [cat, list] of chapters) {
            parts.push(`
            <div class="chapter page-break">
                <h2>${escapeHtml(cat)}</h2>
                <div class="count">${list.length} recipe${list.length !== 1 ? 's' : ''}</div>
            </div>`);
            for (const recipe of list) {
                parts.push(`<div class="page-break">${recipeArticle(recipe, cat)}</div>`);
            }
        }
    } else {
        recipes.forEach((recipe, i) => {
            parts.push(i === 0
                ? recipeArticle(recipe)
                : `<div class="page-break">${recipeArticle(recipe)}</div>`);
        });
    }

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>${parts.join('\n')}</body>
</html>`;
}

/**
 * Renders the printable document into a hidden iframe and opens the print
 * dialog (where every modern browser offers "Save as PDF").
 */
export function exportRecipesToPdf(recipes: Recipe[], opts: ExportOptions = {}): void {
    if (recipes.length === 0) return;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    Object.assign(iframe.style, {
        position: 'fixed', right: '0', bottom: '0',
        width: '0', height: '0', border: '0', visibility: 'hidden',
    });

    iframe.onload = () => {
        // A beat for layout before the print engine snapshots the document.
        setTimeout(() => {
            try {
                iframe.contentWindow?.focus();
                iframe.contentWindow?.print();
            } catch (e) {
                console.error('Print failed', e);
                iframe.remove();
                return;
            }
            // Safari doesn't reliably fire afterprint on iframes, so keep the
            // frame alive long enough for the dialog, then clean up.
            setTimeout(() => iframe.remove(), 60_000);
        }, 150);
    };

    document.body.appendChild(iframe);
    iframe.srcdoc = buildPrintDocument(recipes, opts);
}
