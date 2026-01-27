export interface Ingredient {
    item: string;
    amount?: string;
    unit?: string;
}

export interface Recipe {
    title: string;
    description: string;
    ingredients: Ingredient[];
    instructions: string[];
    prep_time?: string;
    cook_time?: string;
    servings?: string;
    image_url?: string;
    category?: 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack' | 'Dessert' | string;
}
