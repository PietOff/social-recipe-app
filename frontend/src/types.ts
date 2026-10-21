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
