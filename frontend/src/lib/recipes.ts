import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Recipe } from '../types';

/** Pulls the numeric video id out of a TikTok URL. */
export function videoIdFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

async function sha1Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Deterministic Firestore document ID, byte-for-byte identical to the backend's
 * `stable_recipe_id`. Because the ID is derived from the content, re-importing
 * a video overwrites its recipe instead of creating a duplicate - which also
 * removes the need for a composite index on (user_id, source_url).
 */
export async function recipeDocId(uid: string, recipe: Partial<Recipe>): Promise<string> {
  const vid = recipe.video_id || videoIdFromUrl(recipe.source_url);
  const key = vid || (await sha1Hex(recipe.source_url || recipe.title || '')).slice(0, 20);
  return `${uid}_${key}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200);
}

/** Stable identity for a recipe in local state, preferring content keys over the
 *  title (two recipes can share a title; that used to make them clobber each other). */
export function recipeKey(recipe: Partial<Recipe>): string {
  return recipe.id || recipe.video_id || recipe.source_url || recipe.title || '';
}

export function isSameRecipe(a: Partial<Recipe>, b: Partial<Recipe>): boolean {
  const av = a.video_id || videoIdFromUrl(a.source_url);
  const bv = b.video_id || videoIdFromUrl(b.source_url);
  if (a.id && b.id) return a.id === b.id;
  if (av && bv) return av === bv;
  if (a.source_url && b.source_url) return a.source_url === b.source_url;
  return !!a.title && a.title === b.title;
}

/**
 * Thumbnail source for a recipe.
 *
 * Stored `image_url` values point at signed TikTok CDN URLs that expire (old
 * ones now return 403), so prefer the backend resolver whenever we know the
 * video id. Falls back to the stored URL for recipes saved before `video_id`
 * was recorded.
 */
export function thumbnailSrc(recipe: Partial<Recipe>): string | undefined {
  const vid = recipe.video_id || videoIdFromUrl(recipe.source_url);
  if (vid) return `/api/thumbnail?video_id=${encodeURIComponent(vid)}`;
  return recipe.image_url || recipe.image || undefined;
}

export function toFirestoreDoc(uid: string, recipe: Recipe) {
  return {
    user_id: uid,
    title: recipe.title || '',
    description: recipe.description || '',
    ingredients: recipe.ingredients || [],
    instructions: recipe.instructions || [],
    tags: recipe.tags || [],
    image_url: recipe.image_url || null,
    prep_time: recipe.prep_time || null,
    cook_time: recipe.cook_time || null,
    servings: recipe.servings || null,
    source_url: recipe.source_url || null,
    video_id: recipe.video_id || videoIdFromUrl(recipe.source_url) || null,
    created_at: Date.now(),
  };
}

/** Upserts a recipe under its deterministic ID. Returns the recipe with `id` set. */
export async function saveRecipeToCloud(uid: string, recipe: Recipe): Promise<Recipe> {
  const id = await recipeDocId(uid, recipe);
  await setDoc(doc(db, 'recipes', id), toFirestoreDoc(uid, recipe));
  return { ...recipe, id };
}

export async function recipeExistsInCloud(uid: string, recipe: Partial<Recipe>): Promise<boolean> {
  const id = await recipeDocId(uid, recipe);
  return (await getDoc(doc(db, 'recipes', id))).exists();
}
