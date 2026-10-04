/** A book as the pages show it. Generated once into `types.rs`, shared by every component. */
export interface Book {
  id: string;
  title: string;
  author: string;
  year: number;
}

/** What one reader thought of a book. */
export interface Review {
  reader: string;
  stars: number;
  text: string;
}
