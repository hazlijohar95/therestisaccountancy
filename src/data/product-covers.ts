/* Each product's cover, made with the brand's image system. Kept apart from products.ts so the list stays plain data. */
import type { ImageMetadata } from 'astro';
import finance from '@therestisaccountancy/brand/covers/finance.webp';
import fees from '../assets/products/fees.webp';
import planner from '../assets/products/planner.webp';

export const productCovers: Partial<Record<string, ImageMetadata>> = { rate: finance, planner, fees };
