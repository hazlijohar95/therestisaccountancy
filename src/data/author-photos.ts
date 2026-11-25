/* The authors' portraits, for the pages that show them. */
import type { ImageMetadata } from 'astro';
import abuPhoto from '../assets/hosts/abu-studio.jpg';
import hazliPhoto from '../assets/hosts/hazli-studio.jpg';
import type { AuthorHandle } from './authors.ts';

export interface Photo {
  readonly src: ImageMetadata;
  readonly alt: string;
}

export const photos: Partial<Record<AuthorHandle, Photo>> = {
  hazli: { src: hazliPhoto, alt: 'Hazli Johar at the microphone' },
  abu: { src: abuPhoto, alt: 'Abu Musa on set' },
};
