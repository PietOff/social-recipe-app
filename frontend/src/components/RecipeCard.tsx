import React from 'react';
import { Recipe } from '../types';
import styles from './RecipeCard.module.css';

interface RecipeCardProps {
    recipe: Recipe;
    onSave?: (recipe: Recipe) => void;
    isSaved?: boolean;
}

export default function RecipeCard({ recipe, onSave, isSaved }: RecipeCardProps) {
    return (
        <div className={`glass-panel ${styles.card} animate-fade-in`}>
            {recipe.image_url && (
                <div className={styles.imageContainer}>
                    <img src={recipe.image_url} alt={recipe.title} className={styles.image} referrerPolicy="no-referrer" />
                    {recipe.category && (
                        <span className={styles.categoryBadge} style={{
                            position: 'absolute',
                            top: '10px',
                            left: '10px',
                            background: 'rgba(0,0,0,0.6)',
                            color: 'white',
                            padding: '4px 12px',
                            borderRadius: '20px',
                            fontSize: '0.8rem',
                            backdropFilter: 'blur(4px)'
                        }}>
                            {recipe.category}
                        </span>
                    )}
                </div>
            )}

            <div className={styles.header}>
                <h2 className={styles.title}>{recipe.title}</h2>
                {onSave && (
                    <button
                        onClick={() => onSave(recipe)}
                        className={`${styles.saveButton} ${isSaved ? styles.saved : ''}`}
                    >
                        {isSaved ? '❤️ Saved' : '🤍 Save'}
                    </button>
                )}
            </div>

            <p className={styles.description}>{recipe.description}</p>

            <div className={styles.metaGrid}>
                {recipe.prep_time && (
                    <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>Prep</span>
                        <span className={styles.metaValue}>{recipe.prep_time}</span>
                    </div>
                )}
                {recipe.cook_time && (
                    <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>Cook</span>
                        <span className={styles.metaValue}>{recipe.cook_time}</span>
                    </div>
                )}
                {recipe.servings && (
                    <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>Servings</span>
                        <span className={styles.metaValue}>{recipe.servings}</span>
                    </div>
                )}
            </div>

            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Ingredients</h3>
                {/* Ingredients grouped by section */}
                <div className={styles.ingredientsList}>
                    {(() => {
                        const grouped = recipe.ingredients.reduce((acc, ing) => {
                            const group = ing.group || 'Main';
                            if (!acc[group]) acc[group] = [];
                            acc[group].push(ing);
                            return acc;
                        }, {} as Record<string, typeof recipe.ingredients>);

                        const groupKeys = Object.keys(grouped);
                        const showHeaders = groupKeys.length > 1;

                        return groupKeys.map((group) => (
                            <div key={group} style={{ gridColumn: '1 / -1', marginBottom: '1rem' }}>
                                {/* Show header if we have multiple groups, OR if the single group is NOT 'Main' (e.g. 'Batter' only) */}
                                {(showHeaders || group !== 'Main') && (
                                    <h4 style={{
                                        margin: '0.5rem 0',
                                        color: '#FF6B6B',
                                        borderBottom: '1px solid #eee',
                                        paddingBottom: '4px',
                                        textTransform: 'capitalize'
                                    }}>
                                        {group}
                                    </h4>
                                )}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.8rem' }}>
                                    {grouped[group].map((ing, i) => {
                                        // Logic to clean up "400g g" -> "400g"
                                        let displayAmount = ing.amount || '';
                                        let displayUnit = ing.unit || '';

                                        // specific cleanup for common LLM issues
                                        if (displayAmount.toLowerCase().endsWith(displayUnit.toLowerCase())) {
                                            displayUnit = '';
                                        }
                                        if (displayUnit && displayAmount.toLowerCase().endsWith(displayUnit.toLowerCase())) {
                                            displayUnit = '';
                                        }

                                        // Capitalize item
                                        const itemCapitalized = ing.item.charAt(0).toUpperCase() + ing.item.slice(1);

                                        return (
                                            <li key={i} className={styles.ingredient}>
                                                <span className={styles.amount}>
                                                    {displayAmount} {displayUnit}
                                                </span>
                                                <span className={styles.item}>{itemCapitalized}</span>
                                            </li>
                                        );
                                    })}
                                </div>
                            </div>
                        ));
                    })()}
                </div>
            </div>

            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Instructions</h3>
                <div className={styles.steps}>
                    {recipe.instructions.map((step, idx) => (
                        <div key={idx} className={styles.step}>
                            <div className={styles.stepNumber}>{idx + 1}</div>
                            <p className={styles.stepText}>{step}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
