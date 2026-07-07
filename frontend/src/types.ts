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
}
