export interface Ingredient {
    item: string;
    amount?: string;
    unit?: string;
    group?: string;
}

export interface Recipe {
    id?: string;
    title: string;
    description: string;
    ingredients: Ingredient[];
    instructions: string[];
    prep_time?: string;
    cook_time?: string;
    servings?: string;
    image_url?: string;
    image?: string;
    tags?: string[];
    category?: string; // legacy single-category field, kept for migration
    keywords?: string[];
    source_url?: string;
    video_id?: string;
    /** Epoch ms of the first save; used to sort the cookbook. */
    created_at?: number;
    /** Language the recipe text was written in. Missing on older recipes. */
    language?: RecipeLang;
    /** Cached translations of the text, per language, made on first view. */
    translations?: Partial<Record<RecipeLang, RecipeText>>;
    /** Estimated nutrition per serving; see lib/nutrition.ts. */
    nutrition?: Nutrition;
}

export interface Nutrition {
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
    /** Servings the estimate assumed, when the recipe did not say. */
    servings?: number | null;
    /** Fingerprint of the ingredients it was made from; a mismatch means the
     *  recipe was edited and the estimate is stale. */
    basis: string;
}

export type RecipeLang = 'en' | 'nl';

/** The parts of a recipe that are written in a language. */
export interface RecipeText {
    title: string;
    description: string;
    ingredients: Ingredient[];
    instructions: string[];
    prep_time?: string | null;
    cook_time?: string | null;
    servings?: string | null;
}
