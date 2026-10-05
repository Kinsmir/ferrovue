export interface Book {
  id: string;
  title: string;
  author: string;
  year: number;
}

export interface Review {
  reader: string;
  stars: number;
  text: string;
}
